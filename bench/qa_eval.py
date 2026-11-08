"""Retrieval evaluation for 問答 (meeting-qa).

Loads the synthetic meetings and questions of bench/qa_eval_data.json into a separate database (yuqiao_qa_eval, removed
afterwards), indexes them with the running embed service, and reports recall@5, recall@8 (what the model is given),
recall@10 and MRR for keyword, embedding and hybrid (RRF) retrieval, by question type. With --answer it also asks the
minutes model and reports how many answerable questions cite a correct source and how many unanswerable ones are not
found. Run it inside the app container, once per embedding model (restart embed with EMBED_MODEL_REPO/FILE first):

    docker cp bench/qa_eval.py asr_confucius4-r2t2-app-1:/tmp/ && docker cp bench/qa_eval_data.json asr_confucius4-r2t2-app-1:/tmp/
    docker exec -w /app -e EMBED_MODEL_FILE=bge-m3-q8_0.gguf asr_confucius4-r2t2-app-1 python /tmp/qa_eval.py /tmp/qa_eval_data.json [--answer]
"""
import argparse
import asyncio
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.getenv("APP_DIR", "/app"))
import psycopg  # noqa: E402

import auth  # noqa: E402
import db  # noqa: E402
import minutes  # noqa: E402
import qa  # noqa: E402
import search  # noqa: E402

EVAL_DB = "yuqiao_qa_eval"
USER = auth.User("qa-eval", "評測", False)
METHODS = ("keyword", "vector", "hybrid")
CUTS = (5, qa.TOP, 10)


def recreate(main_url: str, drop_only: bool = False) -> None:
    with psycopg.connect(main_url, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {EVAL_DB} WITH (FORCE)")
        if not drop_only:
            conn.execute(f"CREATE DATABASE {EVAL_DB}")


def load(url: str, data: dict) -> dict:
    """The meetings and items in one team of the evaluation user; returns ref -> key as qa.key_of builds them."""
    refs = {}
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO users (username, display_name) VALUES (%s, %s)", (USER.username, USER.display_name))
        team = conn.execute("INSERT INTO teams (name, name_key) VALUES ('評測部', '評測部') RETURNING id").fetchone()[0]
        conn.execute("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, %s, %s)", (team, USER.username, USER.username))
        for name, m in data["meetings"].items():
            meeting = conn.execute(
                "INSERT INTO meetings (team_id, created_by, started_at, language, engine, title) "
                "VALUES (%s, %s, %s::date + time '10:00' AT TIME ZONE 'Asia/Taipei', 'zh', 'local', %s) RETURNING id",
                (team, USER.username, m["date"], m["title"])).fetchone()[0]
            for seq, text in enumerate(m["segments"], 1):
                conn.execute("INSERT INTO segments (meeting_id, seq, start_ms, end_ms, asr_text, source, live_target, target) "
                             "VALUES (%s, %s, %s, %s, %s, %s, '', '')", (meeting, seq, seq * 6000, seq * 6000 + 5000, text, text))
                refs[f"{name}{seq}"] = ("s", str(meeting), seq)
            for n, item in enumerate(m["items"]):
                item_id = conn.execute("INSERT INTO minute_items (meeting_id, kind, content, origin, state) VALUES (%s, %s, %s, 'ai', 'confirmed') "
                                       "RETURNING id", (meeting, item["kind"], item["content"])).fetchone()[0]
                refs[f"{name}:{n}"] = ("i", item_id)
    return refs


async def index() -> tuple[int, float]:
    started, total = time.perf_counter(), 0
    while stored := await qa.index_pending(qa.BATCH):
        total += stored
    return total, time.perf_counter() - started


def passage_text(data: dict, ref: str) -> str:
    """The text of a ref such as "A5" or "A:0", for --detail."""
    name, rest = ref[0], ref[1:]
    meeting = data["meetings"].get(name, {})
    if rest.startswith(":"):
        return meeting["items"][int(rest[1:])]["content"][:40]
    return meeting["segments"][int(rest) - 1][:40] if rest.isdigit() else ""


def first_rank(ranking: list[tuple], gold: set) -> int | None:
    return next((n for n, key in enumerate(ranking, 1) if key in gold), None)


async def rankings(question: str) -> tuple[dict, float]:
    """The rankings of each method, and the time to embed the question and search."""
    async with db.connect() as conn:
        meetings_sql, items_sql, params = await search.scope(conn, USER, None, None, None, None)
        keyword = await qa.keyword_candidates(conn, meetings_sql, items_sql, params, qa.query_terms(question))
        started = time.perf_counter()
        query_prefix, _ = qa.prefixes()
        vector = await qa.vector_candidates(conn, meetings_sql, items_sql, params, (await qa.embed([query_prefix + question]))[0])
        took = time.perf_counter() - started
    return {"keyword": keyword, "vector": vector, "hybrid": qa.fuse(keyword, vector)}, took


def table(rows: list[dict], types: list[str]) -> None:
    print(f"\n{'type':<13}{'n':>3}  " + "  ".join(f"{m:>31}" for m in METHODS))
    print(f"{'':<16}  " + "  ".join(f"{'R@5':>7}{'R@' + str(qa.TOP):>8}{'R@10':>8}{'MRR':>8}" for _ in METHODS))
    for t in types + ["all"]:
        subset = [r for r in rows if r["type"] == t or (t == "all" and r["type"] != "unanswerable")]
        if not subset:
            continue
        cells = []
        for m in METHODS:
            ranks = [r["ranks"][m] for r in subset]
            cells.append("".join(f"{sum(1 for x in ranks if x and x <= cut) / len(ranks):>{7 if i == 0 else 8}.0%}" for i, cut in enumerate(CUTS))
                         + f"{statistics.mean(1 / x if x else 0 for x in ranks):>8.2f}")
        print(f"{t:<13}{len(subset):>3}  " + "  ".join(cells))


async def answer(question: str) -> tuple[str | None, list[tuple], float]:
    async with db.connect() as conn:
        found = await qa.retrieve(conn, USER, question)
        sources = await qa.sources_of(conn, found["keys"])
    if not sources:
        return None, [], 0.0
    started = time.perf_counter()
    reply = await minutes.call_model(qa.build_messages(question, sources), timeout=qa.ANSWER_TIMEOUT)
    took = time.perf_counter() - started
    text, cited = qa.check_answer(reply, len(sources))
    keys = [("s", s["meetingId"], s["seq"]) if s["type"] == "segment" else ("i", s["itemId"]) for s in (sources[n - 1] for n in cited)]
    return text, keys, took


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("data")
    parser.add_argument("--answer", action="store_true", help="also ask the minutes model")
    parser.add_argument("--detail", choices=METHODS, help="list what this method ranks above the first right source")
    args = parser.parse_args()
    data = json.load(open(args.data, encoding="utf-8"))
    main_url = os.environ["DATABASE_URL"]
    url = main_url.rsplit("/", 1)[0] + "/" + EVAL_DB
    recreate(main_url)
    try:
        db.DATABASE_URL = url
        await db.check()
        refs = load(url, data)
        stored, took = await index()
        print(f"model {qa.EMBED_MODEL}: indexed {stored} passages in {took:.1f} s ({stored / took:.1f}/s)")
        rows, latencies = [], []
        for q in data["questions"]:
            ranked, latency = await rankings(q["q"])
            latencies.append(latency)
            gold = {refs[r] for r in q["refs"]}
            rows.append({"type": q["type"], "q": q["q"], "set": q.get("set", "tuning"), "ranks": {m: first_rank(ranked[m], gold) for m in METHODS}})
            rank = rows[-1]["ranks"].get(args.detail) if args.detail else None
            if rank and rank > 1:
                texts = {key: ref for ref, key in refs.items()}
                above = [f"{texts.get(k, '?')} {passage_text(data, texts.get(k, ''))}" for k in ranked[args.detail][:rank - 1]]
                print(f"[{args.detail} rank {rank}] {q['q']}  right: {', '.join(q['refs'])}\n    above: " + "\n           ".join(above))
        types = list(dict.fromkeys(q["type"] for q in data["questions"] if q["type"] != "unanswerable"))
        for name, title in (("tuning", "questions the settings were chosen on"), ("holdout", "holdout: not used to choose the settings")):
            subset = [r for r in rows if r["set"] == name]
            if subset:
                print(f"\n== {title}")
                table(subset, types)
        print(f"\nquestion embedding + vector search: median {statistics.median(latencies) * 1000:.0f} ms")
        missed = [r for r in rows if r["type"] != "unanswerable" and not (r["ranks"]["hybrid"] and r["ranks"]["hybrid"] <= qa.TOP)]
        for r in missed:
            print(f"  hybrid misses top {qa.TOP}: {r['q']}  (keyword {r['ranks']['keyword']}, vector {r['ranks']['vector']}, hybrid {r['ranks']['hybrid']})")
        if args.answer:
            if not minutes.configured():
                sys.exit("--answer needs the minutes model (MINUTES_* or TRANSLATE_REFINE_*)")
            print("\nanswers:")
            cited_ok = not_found_ok = 0
            took_all = []
            for q in data["questions"]:
                text, cited, took = await answer(q["q"])
                took_all.append(took)
                gold = {refs[r] for r in q["refs"]}
                ok = text is None if not gold else bool(set(cited) & gold)
                if gold:
                    cited_ok += ok
                else:
                    not_found_ok += ok
                print(f"  {'ok ' if ok else 'BAD'} [{q['type']}] {q['q']} -> {text or '（找不到）'}")
            answerable = sum(1 for q in data["questions"] if q["refs"])
            print(f"\nanswerable questions citing a correct source: {cited_ok}/{answerable}")
            print(f"unanswerable questions answered not found: {not_found_ok}/{len(data['questions']) - answerable}")
            print(f"model median {statistics.median(t for t in took_all if t):.1f} s")
    finally:
        recreate(main_url, drop_only=True)


if __name__ == "__main__":
    asyncio.run(main())
