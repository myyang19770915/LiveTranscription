"""問答 (meeting-qa): ask about the user's teams' meetings in plain language.

Index: every transcript segment (its text and translation only: neighbours and the meeting topic were measured to rank the
right segment lower, see bench/qa_eval.py) and every proposed or confirmed minutes item gets an embedding from the embed service (llama.cpp, OpenAI-compatible /v1/embeddings), computed in the background and
recomputed when its text changes (md5 of the text, built in SQL) or the model changes.

Answer: keyword retrieval (latin words and Chinese two-character terms, weighted by rarity; a passage needs two terms
or a latin one) and embedding retrieval
(cosine distance) are merged with reciprocal rank fusion; the top candidates go to the minutes model, which must cite
them as [n]. Citations to numbers not given are removed, and an answer without any valid citation is "not found".
"""
import asyncio
import json
import logging
import math
import os
import re
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

import auth
import db
import minutes
import search
import team_access

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

EMBED_URL = os.getenv("EMBED_URL", "").rstrip("/")
EMBED_MODEL = os.getenv("EMBED_MODEL_FILE", "") or "default"
EMBED_TIMEOUT = 60
BATCH = 32
INDEX_EVERY = 15          # seconds between indexing rounds
RETRY_AFTER = 60          # seconds after the embed service failed
DOC_MAX = 1000            # characters of a passage: within a 2048-token slot of the embed service even at 2 tokens a character
CANDIDATES = 30           # per retrieval method
TOP = 8                   # merged candidates given to the model
RRF_K = 60
MAX_TERMS = 16
QUESTION_MAX = 300
ANSWER_TIMEOUT = 90
QUESTION_EMBED_TIMEOUT = 5   # one sentence: a service that does not answer by then is treated as down (keyword only)

NOT_CONFIGURED = "問答需要紀要模型，目前未設定"
EMPTY_QUESTION = "請輸入問題"
LABELS = minutes.LABELS

# Query and document prefixes the models were trained with, by model file name.
PREFIXES = (
    ("qwen3-embedding", "Instruct: Given a question about a business meeting, retrieve transcript passages or minutes that answer it\nQuery: ", ""),
    ("embeddinggemma", "task: search result | query: ", "title: none | text: "),
)


def prefixes(model: str = None) -> tuple[str, str]:
    name = (model or EMBED_MODEL).lower()
    return next(((q, d) for key, q, d in PREFIXES if key in name), ("", ""))


# ---------------------------------------------------------------- index

# The text embedded for each passage, and its md5; built in SQL so finding what changed is one query.
PASSAGES_SQL = f"""
WITH seg AS (
    SELECT s.meeting_id, s.seq, left(concat_ws(E'\\n', s.source,
               CASE WHEN s.target <> '' AND s.target <> s.source THEN s.target END), {DOC_MAX}) AS doc
    FROM segments s
), item AS (
    SELECT i.id, left(CASE i.kind {' '.join(f"WHEN '{k}' THEN '{v}'" for k, v in LABELS.items())} ELSE '紀要' END
               || '：' || i.content, {DOC_MAX}) AS doc
    FROM minute_items i WHERE i.state IN ('proposed', 'confirmed')
)
"""


def vector_literal(values) -> str:
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


async def embed(texts: list[str], timeout: float = EMBED_TIMEOUT) -> list[list[float]]:
    """Embeddings of texts from the embed service, in order; tests replace this."""
    if not EMBED_URL:
        raise RuntimeError("EMBED_URL is not set")
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{EMBED_URL}/v1/embeddings", json={"input": texts, "model": EMBED_MODEL})
        response.raise_for_status()
        data = sorted(response.json()["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in data]


# Passages the embed service refused on their own (key and text hash): skipped until their text changes or the app restarts,
# so one passage it cannot take does not hold up all the others.
refused: set[tuple] = set()
PROBE = "索引"   # embedded once a round to learn the size of the service's vectors


def passage_key(row: dict) -> tuple:
    return ("s", str(row["meeting_id"]), row["seq"], row["hash"]) if row["item_id"] is None else ("i", row["item_id"], row["hash"])


async def embed_each(rows: list[dict], doc_prefix: str) -> list:
    """After a whole batch was refused: one passage at a time; None for a passage refused on its own."""
    vectors = []
    for r in rows:
        try:
            vectors.append((await embed([doc_prefix + r["doc"]]))[0])
        except httpx.HTTPStatusError as exc:
            refused.add(passage_key(r))
            logger.warning("問答索引：embed 服務拒絕一筆資料（%s），先略過：%s", exc.response.status_code, r["doc"][:40])
            vectors.append(None)
    return vectors


async def index_pending(batch: int = BATCH) -> int:
    """Embed up to batch passages that are missing, changed or of another model; returns how many were taken."""
    _, doc_prefix = prefixes()
    dims = len((await embed([doc_prefix + PROBE]))[0])
    async with db.connect() as conn:
        # Rows of another model, or of an item that was rejected, are of no use any more. Vectors of another size under
        # this model's name mean the service now runs another model (embed restarted without the app): they cannot be
        # compared, so they are dropped and rebuilt.
        await conn.execute("DELETE FROM passage_vectors WHERE model <> %s OR vector_dims(embedding) <> %s", (EMBED_MODEL, dims))
        await conn.execute("DELETE FROM passage_vectors v USING minute_items i WHERE v.item_id = i.id AND i.state NOT IN ('proposed', 'confirmed')")
        await conn.commit()
        rows = await (await conn.execute(PASSAGES_SQL + """
            SELECT seg.meeting_id, seg.seq, NULL::bigint AS item_id, seg.doc, md5(seg.doc) AS hash FROM seg
            LEFT JOIN passage_vectors v ON v.item_id IS NULL AND v.meeting_id = seg.meeting_id AND v.seq = seg.seq AND v.model = %(model)s
            WHERE v.id IS NULL OR v.content_hash <> md5(seg.doc)
            UNION ALL
            SELECT NULL, NULL, item.id, item.doc, md5(item.doc) FROM item
            LEFT JOIN passage_vectors v ON v.item_id = item.id AND v.model = %(model)s
            WHERE v.id IS NULL OR v.content_hash <> md5(item.doc)
            LIMIT %(batch)s""", {"model": EMBED_MODEL, "batch": batch + len(refused)})).fetchall()
    rows = [r for r in rows if passage_key(r) not in refused][:batch]
    if not rows:
        return 0
    try:
        vectors = await embed([doc_prefix + r["doc"] for r in rows])
    except httpx.HTTPStatusError:   # the service answered but refused the batch: find the passage it cannot take
        vectors = await embed_each(rows, doc_prefix)
    async with db.connect() as conn:
        for r, v in zip(rows, vectors):
            if v is None:
                continue
            params = {"meeting": r["meeting_id"], "seq": r["seq"], "item": r["item_id"], "model": EMBED_MODEL, "hash": r["hash"], "v": vector_literal(v)}
            # Inserted only if the passage still exists: it may have been deleted while it was being embedded.
            if r["item_id"] is None:
                await conn.execute(
                    "INSERT INTO passage_vectors (meeting_id, seq, model, content_hash, embedding) "
                    "SELECT %(meeting)s, %(seq)s, %(model)s, %(hash)s, %(v)s::vector WHERE EXISTS "
                    "(SELECT 1 FROM segments WHERE meeting_id = %(meeting)s AND seq = %(seq)s) "
                    "ON CONFLICT (meeting_id, seq, model) WHERE item_id IS NULL "
                    "DO UPDATE SET content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, embedded_at = now()", params)
            else:
                await conn.execute(
                    "INSERT INTO passage_vectors (item_id, model, content_hash, embedding) "
                    "SELECT %(item)s, %(model)s, %(hash)s, %(v)s::vector WHERE EXISTS (SELECT 1 FROM minute_items WHERE id = %(item)s) "
                    "ON CONFLICT (item_id, model) WHERE item_id IS NOT NULL "
                    "DO UPDATE SET content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, embedded_at = now()", params)
    return len(rows)


async def indexer() -> None:
    """Background indexing for the app's lifetime: rounds every INDEX_EVERY seconds, RETRY_AFTER after a failure."""
    failing = False
    while True:
        try:
            while await index_pending() == BATCH:
                pass
            if failing:
                logger.info("問答索引：embed 服務已恢復")
            failing, delay = False, INDEX_EVERY
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # the service may be starting or down; the rest of the app is unaffected
            if not failing:
                logger.warning("問答索引：無法取得 embedding（%s），%s 秒後重試", exc, RETRY_AFTER)
            failing, delay = True, RETRY_AFTER
        await asyncio.sleep(delay)


async def embed_reachable() -> bool:
    if not EMBED_URL:
        return False
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            return (await client.get(f"{EMBED_URL}/health")).status_code == 200
    except httpx.HTTPError:
        return False


# ---------------------------------------------------------------- retrieval

# Characters that make a two-character term carry no meaning of its own (particles, pronouns, question words).
STOP_CHARS = set("的了是嗎呢吧啊呀麼什怎哪誰我你妳他她它們這那和與及或就也都在有")
# English function words: as substrings they match almost anything ("is" in "this") and only add noise.
STOP_WORDS = set("""a an the is are was were be been being am to of in on at for from by with and or not no what when where why how which who whom
whose did do does done we our us you your they their them it its this that these those will would can could should shall may might
about last next much many more there here as after before now then than so if any some all has have had get got""".split())
LATIN = re.compile(r"[A-Za-z0-9][A-Za-z0-9.+#_-]*[A-Za-z0-9+#]|[A-Za-z0-9]{2,}")
HAN = re.compile(r"[㐀-鿿豈-﫿]+")


def query_terms(question: str) -> list[str]:
    """Latin words (2+ characters, lower case, no function words) and Chinese two-character terms of the question, at most MAX_TERMS."""
    terms: list[str] = []
    for word in LATIN.findall(question):
        if len(word) >= 2 and word.lower() not in STOP_WORDS and word.lower() not in terms:
            terms.append(word.lower())
    for run in HAN.findall(question):
        for n in range(len(run) - 1):
            pair = run[n:n + 2]
            if not STOP_CHARS & set(pair) and pair not in terms:
                terms.append(pair)
    return terms[:MAX_TERMS]


def matched(columns: list[str], n: int) -> str:
    return "(" + " OR ".join(f"{c} ILIKE %(t{n})s ESCAPE '\\'" for c in columns) + ")"


async def keyword_candidates(conn, meetings_sql: str, items_sql: str, params: dict, terms: list[str]) -> list[tuple]:
    """Passages containing two of the terms or a latin one, ranked by the summed rarity of the terms they contain (idf:
    log(1 + passages / passages with the term)), newer first on ties; a rare word such as a name counts more than a common one."""
    if not terms:
        return []
    p = params | {f"t{n}": team_access.like_pattern(t) for n, t in enumerate(terms)} | {"limit": CANDIDATES}
    seg_cols, item_cols = ["s.source", "s.target"], ["i.content"]
    counts = ", ".join(f"count(*) FILTER (WHERE {matched(['x.a', 'x.b'], n)}) AS d{n}" for n in range(len(terms)))
    row = await (await conn.execute(
        f"SELECT count(*) AS total, {counts} FROM ("
        f"SELECT s.source AS a, s.target AS b FROM segments s JOIN meetings m ON m.id = s.meeting_id JOIN team_members tm ON tm.team_id = m.team_id WHERE {meetings_sql} "
        f"UNION ALL SELECT i.content, '' FROM minute_items i LEFT JOIN meetings m ON m.id = i.meeting_id JOIN team_members tm ON tm.team_id = i.team_id "
        f"WHERE {items_sql} AND i.state IN ('proposed', 'confirmed')) x", p)).fetchone()
    weights = {f"w{n}": math.log(1 + row["total"] / row[f"d{n}"]) if row[f"d{n}"] else 0.0 for n in range(len(terms))}
    p |= weights
    # A passage counts when it contains two of the terms (one if the question has only one), or a latin one: a name,
    # part number or version. One shared everyday word ("不夠", "問題") is not enough and only adds noise.
    need = min(2, len(terms))
    latin = [n for n, t in enumerate(terms) if not HAN.match(t)]
    def gate(cols: list[str]) -> str:
        hits = " + ".join(f"({matched(cols, n)})::int" for n in range(len(terms)))
        return f"(({hits}) >= {need}" + "".join(f" OR {matched(cols, n)}" for n in latin) + ")"
    any_seg, any_item = gate(seg_cols), gate(item_cols)
    seg_score = " + ".join(f"({matched(seg_cols, n)})::int * %(w{n})s" for n in range(len(terms)))
    item_score = " + ".join(f"({matched(item_cols, n)})::int * %(w{n})s" for n in range(len(terms)))
    rows = await (await conn.execute(
        f"(SELECT 's' AS t, s.meeting_id, s.seq, NULL::bigint AS item_id, {seg_score} AS score, m.started_at AS at "
        f"FROM segments s JOIN meetings m ON m.id = s.meeting_id JOIN team_members tm ON tm.team_id = m.team_id "
        f"WHERE {meetings_sql} AND ({any_seg}) ORDER BY score DESC, at DESC, s.seq LIMIT %(limit)s) "
        f"UNION ALL (SELECT 'i', NULL, NULL, i.id, {item_score}, coalesce(m.started_at, i.confirmed_at) AS at "
        f"FROM minute_items i LEFT JOIN meetings m ON m.id = i.meeting_id JOIN team_members tm ON tm.team_id = i.team_id "
        f"WHERE {items_sql} AND i.state IN ('proposed', 'confirmed') AND ({any_item}) ORDER BY 5 DESC, at DESC NULLS LAST, i.id LIMIT %(limit)s)", p)).fetchall()
    rows.sort(key=lambda r: (-r["score"], -(r["at"].timestamp() if r["at"] else 0)))
    return [key_of(r) for r in rows[:CANDIDATES]]


async def vector_candidates(conn, meetings_sql: str, items_sql: str, params: dict, vector: list[float]) -> list[tuple]:
    """The passages nearest to the question by cosine distance, among embeddings of the current model."""
    p = params | {"q": vector_literal(vector), "model": EMBED_MODEL, "dims": len(vector), "limit": CANDIDATES}
    rows = await (await conn.execute(
        "(SELECT 's' AS t, v.meeting_id, v.seq, NULL::bigint AS item_id, v.embedding <=> %(q)s::vector AS distance "
        "FROM passage_vectors v JOIN meetings m ON m.id = v.meeting_id JOIN team_members tm ON tm.team_id = m.team_id "
        f"WHERE v.model = %(model)s AND vector_dims(v.embedding) = %(dims)s AND v.item_id IS NULL AND {meetings_sql} ORDER BY distance LIMIT %(limit)s) "
        "UNION ALL (SELECT 'i', NULL, NULL, i.id, v.embedding <=> %(q)s::vector "
        "FROM passage_vectors v JOIN minute_items i ON i.id = v.item_id LEFT JOIN meetings m ON m.id = i.meeting_id "
        "JOIN team_members tm ON tm.team_id = i.team_id "
        f"WHERE v.model = %(model)s AND vector_dims(v.embedding) = %(dims)s AND {items_sql} AND i.state IN ('proposed', 'confirmed') "
        "ORDER BY 5 LIMIT %(limit)s)", p)).fetchall()
    rows.sort(key=lambda r: r["distance"])
    return [key_of(r) for r in rows[:CANDIDATES]]


def key_of(row: dict) -> tuple:
    return ("s", str(row["meeting_id"]), row["seq"]) if row["t"] == "s" else ("i", row["item_id"])


def fuse(*rankings: list[tuple], k: int = RRF_K) -> list[tuple]:
    """Reciprocal rank fusion: score = sum of 1 / (k + rank) over the rankings that contain the key."""
    scores: dict[tuple, float] = {}
    for ranking in rankings:
        for rank, key in enumerate(ranking, 1):
            scores[key] = scores.get(key, 0.0) + 1 / (k + rank)
    return sorted(scores, key=lambda key: -scores[key])


async def retrieve(conn, user: auth.User, question: str, team=None, series=None, start=None, end=None) -> dict:
    """Candidates for the question within the user's teams and the filters: {'keys', 'keyword', 'vector', 'degraded'}."""
    meetings_sql, items_sql, params = await search.scope(conn, user, team, series, start, end)
    keyword = await keyword_candidates(conn, meetings_sql, items_sql, params, query_terms(question))
    vector, degraded = [], False
    try:
        query_prefix, _ = prefixes()
        question_vector = (await embed([query_prefix + question], timeout=QUESTION_EMBED_TIMEOUT))[0]
        async with conn.transaction():   # a savepoint: should the vector query fail, the connection stays usable
            vector = await vector_candidates(conn, meetings_sql, items_sql, params, question_vector)
    except Exception as exc:  # the embed service is down or not configured, or the vector query failed: keyword retrieval only
        logger.warning("問答：無法取得問題的 embedding（%s），只用關鍵字", exc)
        degraded = True
    return {"keys": fuse(keyword, vector)[:TOP], "keyword": keyword, "vector": vector, "degraded": degraded}


# ---------------------------------------------------------------- answer

SYSTEM_PROMPT = """你是會議紀錄問答助理，只能根據使用者提供的編號資料回答問題。
規則：
1. 用繁體中文（台灣用語）回答，先講結論，簡潔清楚。
2. 每一句句尾都要標出依據的資料編號，例如「報價維持八五折 [2]。」；有多個依據寫成 [1][3]。
3. 只使用資料裡明確出現的內容，不要推測或補上資料沒有的日期、數字、人名。
4. 逐字稿資料中標「＞」的那一段是該筆資料的出處，其餘是前後文。
5. 資料不足以回答時，回覆 {"answer": "", "notFound": true}。
6. 只輸出 JSON：{"answer": "回答內容", "notFound": false}"""


async def sources_of(conn, keys: list[tuple]) -> list[dict]:
    """Details of the candidates, in the order of keys; a passage deleted meanwhile is left out."""
    segs = [(k[1], k[2]) for k in keys if k[0] == "s"]
    items = [k[1] for k in keys if k[0] == "i"]
    found: dict[tuple, dict] = {}
    if segs:
        rows = await (await conn.execute(
            "SELECT s.meeting_id, s.seq, s.start_ms, s.source, s.target, m.title, m.started_at, "
            "(SELECT p.source FROM segments p WHERE p.meeting_id = s.meeting_id AND p.seq < s.seq ORDER BY p.seq DESC LIMIT 1) AS prev, "
            "(SELECT n.source FROM segments n WHERE n.meeting_id = s.meeting_id AND n.seq > s.seq ORDER BY n.seq LIMIT 1) AS next "
            "FROM segments s JOIN meetings m ON m.id = s.meeting_id "
            "JOIN unnest(%s::uuid[], %s::int[]) AS k(meeting_id, seq) ON k.meeting_id = s.meeting_id AND k.seq = s.seq",
            ([m for m, _ in segs], [s for _, s in segs]))).fetchall()
        for r in rows:
            found[("s", str(r["meeting_id"]), r["seq"])] = {
                "type": "segment", "meetingId": str(r["meeting_id"]), "title": minutes.display_title(r), "startedAt": r["started_at"].isoformat(),
                "seq": r["seq"], "startMs": r["start_ms"], "text": r["source"], "target": r["target"] if r["target"] != r["source"] else "",
                "prev": r["prev"], "next": r["next"], "href": f"/meetings/{r['meeting_id']}#seg-{r['seq']}", "_at": r["started_at"]}
    if items:
        rows = await (await conn.execute(
            "SELECT i.id, i.meeting_id, i.kind, i.content, i.owner, i.due_date, i.state, i.status, i.evidence, m.title, m.started_at, t.name AS team, "
            "coalesce(nullif(u.display_name, ''), i.owner) AS owner_name FROM minute_items i LEFT JOIN meetings m ON m.id = i.meeting_id "
            "JOIN teams t ON t.id = i.team_id LEFT JOIN users u ON u.username = i.owner WHERE i.id = ANY(%s)", (items,))).fetchall()
        for r in rows:
            found[("i", r["id"])] = {
                "type": "item", "itemId": r["id"], "kind": r["kind"], "meetingId": str(r["meeting_id"]) if r["meeting_id"] else None,
                "title": minutes.display_title(r) if r["meeting_id"] else f"看板待辦（{r['team']}）",
                "startedAt": r["started_at"].isoformat() if r["started_at"] else None, "text": r["content"],
                "owner": r["owner_name"], "due": r["due_date"].isoformat() if r["due_date"] else None,
                "state": r["state"], "status": r["status"] if r["kind"] == "action" and r["state"] == "confirmed" else None,
                "evidence": sorted(r["evidence"] or []),   # the item's evidence segments, shown in the side panel
                "href": f"/meetings/{r['meeting_id']}/minutes#item-{r['id']}" if r["meeting_id"] else f"/actions?item={r['id']}",
                "_at": r["started_at"]}
    return [found[k] for k in keys if k in found]


STATUS_LABEL = {"todo": "未開始", "doing": "進行中", "done": "已完成", "cancelled": "已取消"}


def evidence_block(n: int, s: dict) -> str:
    when = minutes.local_start({"started_at": s["_at"]}) if s["_at"] else None
    day = f"{when:%Y-%m-%d}（星期{minutes.WEEKDAYS[when.weekday()]}）" if when else ""
    if s["type"] == "segment":
        lines = [f"[{n}] 會議「{s['title']}」{day} {minutes.clock(s['startMs'])} 逐字稿"]
        if s["prev"]:
            lines.append(f"  {s['prev']}")
        lines.append(f"  ＞ {s['text']}" + (f"（譯文：{s['target']}）" if s["target"] else ""))
        if s["next"]:
            lines.append(f"  {s['next']}")
        return "\n".join(lines)
    details = [f"負責人：{s['owner']}" if s["owner"] else "", f"到期：{s['due']}" if s["due"] else "",
               f"狀態：{STATUS_LABEL[s['status']]}" if s["status"] else "", "尚未確認" if s["state"] == "proposed" else ""]
    extra = "，".join(d for d in details if d)
    where = f"會議「{s['title']}」{day}" if s["meetingId"] else s["title"]
    return f"[{n}] {where} 紀要・{LABELS.get(s['kind'], '紀要')}：{s['text']}" + (f"（{extra}）" if extra else "")


def build_messages(question: str, sources: list[dict]) -> list[dict]:
    evidence = "\n\n".join(evidence_block(n, s) for n, s in enumerate(sources, 1))
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": f"問題：{question}\n\n資料：\n{evidence}"}]


CITATION = re.compile(r"\s*\[(\d+)\]")
# A sentence: up to its end mark (。！？!?), the closing quotes or brackets right after it (「…。」), and the citations
# right after those; or what is left of a line without an end mark.
SENTENCE = re.compile(r"[^。！？!?\n]*[。！？!?]+[」』）)\"'”’]*(?:\s*\[\d+\])*|[^。！？!?\n]+")


def cited_sentences(answer: str) -> str:
    """The answer without its sentences that carry no [n] citation (meeting-qa: every sentence has a source).
    Line by line, so a line whose sentences all go leaves no blank line behind."""
    lines = []
    for line in answer.split("\n"):
        kept = "".join(piece for piece in SENTENCE.findall(line) if CITATION.search(piece))
        if kept.strip():
            lines.append(kept)
        elif not line.strip() and lines and lines[-1]:
            lines.append("")   # a blank line the answer had between kept lines (paragraphs)
    return "\n".join(lines).strip()


def check_answer(reply: str, given: int) -> tuple[str | None, list[int]]:
    """The answer with only valid citations, and the cited numbers; (None, []) when it is not found."""
    text = reply.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.S)
    try:
        data = json.loads(fenced.group(1) if fenced else text)
    except json.JSONDecodeError:
        data = {"answer": text}
    if not isinstance(data, dict) or data.get("notFound") is True or not isinstance(data.get("answer"), str):
        return None, []
    answer = data["answer"].translate(str.maketrans("［］０１２３４５６７８９", "[]0123456789"))
    answer = CITATION.sub(lambda m: m.group(0) if 1 <= int(m.group(1)) <= given else "", answer)
    answer = cited_sentences(answer)
    cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", answer)})
    return (answer, cited) if cited and answer else (None, [])


class AskIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    question: str = Field(max_length=QUESTION_MAX * 4)
    team: int | None = None
    series: int | None = None
    start: date | None = Field(None, alias="from")
    end: date | None = Field(None, alias="to")


def public(source: dict, n: int) -> dict:
    return {"n": n} | {k: v for k, v in source.items() if not k.startswith("_")}


@router.get("/ask")
async def ask_page(user: auth.CurrentUser):
    return FileResponse(auth.STATIC_DIR / "ask.html", headers={"Cache-Control": "no-cache"})


@router.post("/api/ask")
async def ask(body: AskIn, user: auth.CurrentUser):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail=EMPTY_QUESTION)
    if len(question) > QUESTION_MAX:
        raise HTTPException(status_code=422, detail=f"問題最多 {QUESTION_MAX} 個字")
    if not minutes.configured():
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
    async with db.connect() as conn:
        found = await retrieve(conn, user, question, body.team, body.series, body.start, body.end)
        sources = await sources_of(conn, found["keys"])
    result = {"question": question, "answer": None, "notFound": True, "sources": [], "degraded": found["degraded"]}
    if not sources:
        return result
    try:
        reply = await minutes.call_model(build_messages(question, sources), timeout=ANSWER_TIMEOUT)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("問答：模型呼叫失敗：%s", exc)
        raise HTTPException(status_code=502, detail="模型暫時無法回答，請稍後再試")
    answer, cited = check_answer(reply, len(sources))
    if answer is None:
        return result
    return result | {"answer": answer, "notFound": False, "sources": [public(sources[n - 1], n) for n in cited]}


@router.get("/api/ask/status")
async def ask_status(user: auth.CurrentUser, team: int | None = None):
    """Index progress over the user's teams (or one team): passages with an embedding of the current model, out of all."""
    async with db.connect() as conn:
        meetings_sql, items_sql, params = await search.scope(conn, user, team, None, None, None)
        row = await (await conn.execute(
            "SELECT (SELECT count(*) FROM segments s JOIN meetings m ON m.id = s.meeting_id JOIN team_members tm ON tm.team_id = m.team_id "
            f"WHERE {meetings_sql}) AS segments, "
            "(SELECT count(*) FROM segments s JOIN meetings m ON m.id = s.meeting_id JOIN team_members tm ON tm.team_id = m.team_id "
            f"JOIN passage_vectors v ON v.item_id IS NULL AND v.meeting_id = s.meeting_id AND v.seq = s.seq AND v.model = %(model)s WHERE {meetings_sql}) AS seg_done, "
            "(SELECT count(*) FROM minute_items i LEFT JOIN meetings m ON m.id = i.meeting_id JOIN team_members tm ON tm.team_id = i.team_id "
            f"WHERE {items_sql} AND i.state IN ('proposed', 'confirmed')) AS items, "
            "(SELECT count(*) FROM minute_items i LEFT JOIN meetings m ON m.id = i.meeting_id JOIN team_members tm ON tm.team_id = i.team_id "
            f"JOIN passage_vectors v ON v.item_id = i.id AND v.model = %(model)s WHERE {items_sql} AND i.state IN ('proposed', 'confirmed')) AS item_done",
            params | {"model": EMBED_MODEL})).fetchone()
    return {"indexed": row["seg_done"] + row["item_done"], "total": row["segments"] + row["items"], "model": EMBED_MODEL,
            "embedReachable": await embed_reachable(), "configured": minutes.configured()}
