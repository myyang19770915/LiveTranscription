"""Meeting minutes: a model proposes a summary and decisions, action items, open questions and risks
from the reviewed transcript; team members confirm, correct or reject each item before it counts.

The whole meeting goes to the minutes model in one request (MINUTES_* or, when unset, the cloud
refinement model TRANSLATE_REFINE_*). Model output is untrusted: every item must cite segments that
exist, owners must be team members, dates must be real dates. Regenerating replaces only AI items
nobody has handled yet.
"""
import asyncio
import json
import logging
import os
import unicodedata
from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, StringConstraints

import auth
import db
import diarize
import mailer
import team_access

MINUTES_URL = (os.getenv("MINUTES_URL", "") or os.getenv("TRANSLATE_REFINE_URL", "")).rstrip("/")
MINUTES_MODEL = os.getenv("MINUTES_MODEL", "") or os.getenv("TRANSLATE_REFINE_MODEL", "")
MINUTES_KEY = os.getenv("MINUTES_KEY", "") or os.getenv("TRANSLATE_REFINE_KEY", "")
MODEL_TIMEOUT = 300
# Reasoning models (deepseek) spend output tokens on thinking first; leave room as the refinement pass does.
MAX_TOKENS = 4096 + 4096
CONTENT_MAX = 500
KINDS = ("decision", "action", "question", "risk")
LABELS = {"decision": "決議", "action": "待辦", "question": "待確認問題", "risk": "風險"}
WEEKDAYS = "一二三四五六日"

NOT_CONFIGURED = "紀要模型未設定"
NO_SEGMENTS = "這場會議沒有段落，無法產生紀要"
RUNNING = "紀要正在產生中"
INTERRUPTED = "產生中斷，請重新產生"
CHANGED_BY_OTHERS = "這個條目已被其他人修改，已重新載入"
OWNER_NOT_MEMBER = "負責人必須是團隊成員"

router = APIRouter()
logger = logging.getLogger("uvicorn.error")
_tasks: set[asyncio.Task] = set()


def configured() -> bool:
    return bool(MINUTES_URL and MINUTES_MODEL)


# --- Prompt and model ------------------------------------------------------------------------------

SYSTEM_PROMPT = """你是會議紀錄助理。根據使用者提供的會議逐字稿段落，整理出會議摘要與四類條目：
- decision（決議）：會議中明確做出的決定
- action（待辦）：有人要去做的事；盡量寫出負責人與到期日
- question（待確認問題）：會中提出但沒有結論、需要後續確認的問題
- risk（風險）：會中提到的風險、阻礙或疑慮

規則：
1. 只根據段落內容，不要推測或補充段落沒有的事；沒有把握就不要列。
2. 每個條目都要在 evidence 列出支持它的段落編號（方括號裡的數字），至少一個。
3. owner 只能填「團隊成員」清單中的帳號或顯示名稱；逐字稿提到但不在清單中的人，照原文寫出名字。沒有負責人就留空字串。
4. 段落開頭的「名字：」是由聲音辨識出的說話者，可能有誤；判斷「我來處理」這類句子的負責人時可以參考，但以內容為準。
5. 到期日：due_text 寫逐字稿的原話（例如「下週五」「月底前」），due_date 依會議日期換算為 YYYY-MM-DD；無法換算就留空字串。
6. content 用繁體中文、一句話寫清楚，不加編號。summary 用繁體中文 3 到 6 句。
7. 只輸出 JSON，格式：
{"summary": "…", "items": [{"kind": "decision|action|question|risk", "content": "…", "owner": "", "due_text": "", "due_date": "", "evidence": [1, 2]}]}"""


def local_start(meeting: dict) -> datetime:
    return meeting["started_at"].astimezone(ZoneInfo(team_access.MEETING_TIMEZONE))


def display_title(meeting: dict) -> str:
    return meeting["title"] or f"{local_start(meeting):%m/%d %H:%M} 的會議"


def build_messages(meeting: dict, segments: list[dict], members: list[dict]) -> list[dict]:
    """The whole meeting in one request: numbered segments in order, never split."""
    start = local_start(meeting)
    roster = "\n".join(f"- {m['username']}（{m['display_name']}）" if m["display_name"] and m["display_name"] != m["username"]
                       else f"- {m['username']}" for m in members) or "（無）"
    lines = "\n".join(f"[{s['seq']}] {s['speaker']}：{s['source']}" if s.get("speaker") else f"[{s['seq']}] {s['source']}"
                      for s in segments)
    user = (f"會議日期：{start:%Y-%m-%d}（星期{WEEKDAYS[start.weekday()]}）\n"
            f"會議主題：{meeting['title'] or '（未填）'}\n"
            f"團隊成員：\n{roster}\n\n逐字稿段落：\n{lines}")
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]


async def call_model(messages: list[dict], timeout: float = MODEL_TIMEOUT) -> str:
    """One chat completion from the minutes model; tests replace this."""
    payload = {"model": MINUTES_MODEL, "messages": messages, "temperature": 0, "max_tokens": MAX_TOKENS,
               "response_format": {"type": "json_object"}}
    headers = {"Authorization": f"Bearer {MINUTES_KEY}"} if MINUTES_KEY else {}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{MINUTES_URL}/chat/completions", json=payload, headers=headers)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"] or ""


def parse_answer(text: str) -> dict:
    """The JSON object in the model's answer (a ```json fence is tolerated)."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
    data = json.loads(text[text.find("{"):text.rfind("}") + 1] if "{" in text else text)
    if not isinstance(data, dict):
        raise ValueError("model answer is not a JSON object")
    return data


# --- Validation ------------------------------------------------------------------------------------

def content_key(text: str) -> str:
    """Same item if equal after dropping spaces and punctuation, ignoring case."""
    return "".join(c for c in text if not (c.isspace() or unicodedata.category(c).startswith("P"))).casefold()


def match_owner(name, members: list[dict]) -> tuple[str | None, str]:
    """(member username, hint): a name no member has is kept only as a hint."""
    name = str(name or "").strip()
    if not name:
        return None, ""
    wanted = name.casefold()
    for m in members:
        if wanted in (m["username"].casefold(), (m["display_name"] or "").casefold()):
            return m["username"], ""
    return None, name[:60]


def parse_due(value) -> date | None:
    try:
        return date.fromisoformat(str(value or "").strip())
    except ValueError:
        return None


def clean_items(raw_items, seqs: set[int], members: list[dict]) -> tuple[list[dict], int]:
    """Valid, de-duplicated items and how many were dropped for lacking evidence."""
    items, dropped = {}, 0
    for raw in raw_items if isinstance(raw_items, list) else []:
        if not isinstance(raw, dict) or raw.get("kind") not in KINDS:
            continue
        content = str(raw.get("content") or "").strip()[:CONTENT_MAX]
        if not content:
            continue
        cited = raw.get("evidence") if isinstance(raw.get("evidence"), list) else []
        evidence = sorted({int(n) for n in cited if isinstance(n, (int, float, str)) and str(n).strip().lstrip("-").isdigit()
                           and int(n) in seqs})
        if not evidence:
            dropped += 1
            continue
        owner, hint = match_owner(raw.get("owner"), members)
        key = (raw["kind"], content_key(content))
        if key in items:
            items[key]["evidence"] = sorted(set(items[key]["evidence"]) | set(evidence))
            continue
        items[key] = {"kind": raw["kind"], "content": content, "owner": owner, "owner_hint": hint,
                      "due_date": parse_due(raw.get("due_date")), "due_text": str(raw.get("due_text") or "").strip()[:60],
                      "evidence": evidence}
    return list(items.values()), dropped


# --- Generation ------------------------------------------------------------------------------------

async def team_members(conn, team_id: int) -> list[dict]:
    rows = await (await conn.execute(
        "SELECT m.username, coalesce(nullif(u.display_name, ''), m.username) AS display_name FROM team_members m "
        "LEFT JOIN users u USING (username) WHERE m.team_id = %s ORDER BY m.username", (team_id,))).fetchall()
    return [dict(r) for r in rows]


async def run_generation(meeting_id) -> None:
    try:
        async with db.connect() as conn:
            meeting = await (await conn.execute("SELECT * FROM meetings WHERE id = %s", (meeting_id,))).fetchone()
            segments = await (await conn.execute(diarize.SEGMENTS_WITH_SPEAKERS, (meeting_id,))).fetchall()
            members = await team_members(conn, meeting["team_id"])
        data = parse_answer(await call_model(build_messages(meeting, segments, members)))
        items, dropped = clean_items(data.get("items"), {s["seq"] for s in segments}, members)
        summary = str(data.get("summary") or "").strip()
        async with db.connect() as conn:
            # Delete first, then read what stays: an item confirmed meanwhile is either kept (its confirm
            # committed first, so the DELETE skips it) or replaced with the other proposals.
            await conn.execute("DELETE FROM minute_items WHERE meeting_id = %s AND origin = 'ai' AND state = 'proposed'", (meeting_id,))
            kept = await (await conn.execute("SELECT kind, content FROM minute_items WHERE meeting_id = %s", (meeting_id,))).fetchall()
            kept_keys = {(r["kind"], content_key(r["content"])) for r in kept}
            fresh = [i for i in items if (i["kind"], content_key(i["content"])) not in kept_keys]
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    "INSERT INTO minute_items (meeting_id, kind, content, owner, owner_hint, due_date, due_text, evidence, origin) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'ai')",
                    [(meeting_id, i["kind"], i["content"], i["owner"], i["owner_hint"], i["due_date"], i["due_text"], i["evidence"]) for i in fresh])
            await conn.execute(
                "UPDATE minutes SET status = 'done', message = '', dropped = %s, model = %s, finished_at = now(), "
                "summary = CASE WHEN summary_edited THEN summary ELSE %s END, "
                "summary_version = CASE WHEN summary_edited THEN summary_version ELSE summary_version + 1 END WHERE meeting_id = %s",
                (dropped, MINUTES_MODEL, summary, meeting_id))
        logger.info("minutes for %s: %d items, %d dropped", meeting_id, len(fresh), dropped)
    except Exception as exc:  # the job must always leave a final status
        logger.exception("minutes generation failed for %s", meeting_id)
        detail = f"{type(exc).__name__}: {exc}"[:200]
        async with db.connect() as conn:
            await conn.execute("UPDATE minutes SET status = 'failed', message = %s, finished_at = now() WHERE meeting_id = %s",
                               (f"產生失敗（{detail}）", meeting_id))


async def recover_interrupted() -> None:
    """A restart ends any generation that was running; its items are untouched."""
    async with db.connect() as conn:
        await conn.execute("UPDATE minutes SET status = 'failed', message = %s, finished_at = now() WHERE status = 'running'",
                           (INTERRUPTED,))


@router.post("/api/meetings/{meeting_id}/minutes/generate", status_code=202)
async def generate(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        if not configured():
            raise HTTPException(status_code=400, detail=NOT_CONFIGURED)
        if not await (await conn.execute("SELECT 1 FROM segments WHERE meeting_id = %s LIMIT 1", (meeting["id"],))).fetchone():
            raise HTTPException(status_code=422, detail=NO_SEGMENTS)
        await conn.execute("INSERT INTO minutes (meeting_id) VALUES (%s) ON CONFLICT DO NOTHING", (meeting["id"],))
        claimed = await (await conn.execute(
            "UPDATE minutes SET status = 'running', message = '', started_by = %s, started_at = now(), finished_at = NULL "
            "WHERE meeting_id = %s AND status <> 'running' RETURNING meeting_id", (user.username, meeting["id"]))).fetchone()
    if not claimed:
        raise HTTPException(status_code=409, detail=RUNNING)
    task = asyncio.create_task(run_generation(meeting["id"]))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"status": "running"}


# --- Reading, editing, confirming -----------------------------------------------------------------

OPEN_STATUSES = ("todo", "doing")


def local_today() -> date:
    """Today in the meeting time zone: overdue is judged by the server's calendar, not the viewer's."""
    return datetime.now(ZoneInfo(team_access.MEETING_TIMEZONE)).date()


def overdue_days(status: str, due: date | None, today: date) -> int:
    return (today - due).days if status in OPEN_STATUSES and due and due < today else 0


def item_payload(row: dict, members: dict, times: dict, today: date | None = None) -> dict:
    return {"id": row["id"], "kind": row["kind"], "content": row["content"], "owner": row["owner"],
            "ownerName": members.get(row["owner"], row["owner"]) if row["owner"] else None, "ownerHint": row["owner_hint"],
            "dueDate": row["due_date"].isoformat() if row["due_date"] else None, "dueText": row["due_text"],
            "evidence": [{"seq": n, "startMs": times[n]} for n in row["evidence"] if n in times],
            "origin": row["origin"], "state": row["state"], "version": row["version"],
            "status": row["status"], "statusNote": row["status_note"],
            "overdueDays": overdue_days(row["status"], row["due_date"], today or local_today()),
            "confirmedBy": members.get(row["confirmed_by"], row["confirmed_by"]) if row["confirmed_by"] else None}


async def item_context(conn, meeting: dict) -> tuple[dict, dict]:
    """(members, segment times) for items of meeting; a board item passes {id: None, team_id} and has no segments."""
    members = {m["username"]: m["display_name"] for m in await team_members(conn, meeting["team_id"])}
    times = {r["seq"]: r["start_ms"] for r in await (await conn.execute(
        "SELECT seq, start_ms FROM segments WHERE meeting_id = %s", (meeting["id"],))).fetchall()} if meeting["id"] else {}
    return members, times


@router.get("/meetings/{meeting_id}/minutes")
async def minutes_page(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        await team_access.require_member(conn, user, meeting_id)
    return FileResponse(auth.STATIC_DIR / "minutes.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/meetings/{meeting_id}/minutes")
async def get_minutes(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        row = await (await conn.execute("SELECT * FROM minutes WHERE meeting_id = %s", (meeting["id"],))).fetchone()
        rows = await (await conn.execute(
            "SELECT * FROM minute_items WHERE meeting_id = %s ORDER BY array_position(%s, kind), id", (meeting["id"], list(KINDS)))).fetchall()
        members, times = await item_context(conn, meeting)
        team = await (await conn.execute("SELECT name FROM teams WHERE id = %s", (meeting["team_id"],))).fetchone()
        mail = await mailer.mail_state(conn, meeting, members)
    row = row or {"status": "idle", "model": "", "message": "", "dropped": 0, "summary": "", "summary_version": 1, "finished_at": None,
                  "finalized_at": None, "finalized_by": None}
    return {"meeting": {"id": str(meeting["id"]), "title": meeting["title"], "startedAt": meeting["started_at"].isoformat(), "team": team["name"]},
            "status": row["status"], "model": row["model"], "message": row["message"], "dropped": row["dropped"],
            "summary": row["summary"], "summaryVersion": row["summary_version"],
            "finishedAt": row["finished_at"].isoformat() if row["finished_at"] else None,
            "items": [item_payload(r, members, times) for r in rows],
            "members": [{"username": u, "displayName": n} for u, n in members.items()], "modelAvailable": configured(),
            # Finalizing and sending (minutes-mail).
            "finalizedAt": row["finalized_at"].isoformat() if row["finalized_at"] else None,
            "finalizedBy": members.get(row["finalized_by"], row["finalized_by"]) if row["finalized_by"] else None, "mail": mail}


Content = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=CONTENT_MAX)]


class ItemIn(BaseModel):
    kind: Literal["decision", "action", "question", "risk"]
    content: Content
    owner: str | None = None
    dueDate: date | None = None
    dueText: str = Field(default="", max_length=60)
    evidence: list[int] = Field(default_factory=list, max_length=50)


class ItemChange(BaseModel):
    version: int
    kind: Literal["decision", "action", "question", "risk"] | None = None
    content: Content | None = None
    owner: str | None = None
    dueDate: date | None = None
    dueText: str | None = Field(default=None, max_length=60)


class VersionIn(BaseModel):
    version: int


class SummaryIn(BaseModel):
    version: int
    summary: str = Field(max_length=4000)


def require_owner(owner: str | None, members: dict) -> str | None:
    owner = (owner or "").strip().lower() or None
    if owner is not None and owner not in members:
        raise HTTPException(status_code=422, detail=OWNER_NOT_MEMBER)
    return owner


def changed_by_hand(row: dict, values: dict) -> bool:
    """Whether the edit really changes one of the item's fields (outcome-metrics counts such items as edited)."""
    return any(values[key] != row[key] for key in values)


async def locked_item(conn, user: auth.User, meeting_id: str, item_id: int) -> tuple[dict, dict]:
    meeting = await team_access.require_member(conn, user, meeting_id)
    row = await (await conn.execute("SELECT * FROM minute_items WHERE id = %s AND meeting_id = %s FOR UPDATE",
                                    (item_id, meeting["id"]))).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="找不到這個條目")
    return meeting, row


async def updated(conn, meeting: dict, item_id: int, sets: str, params: tuple, user: auth.User) -> dict:
    row = await (await conn.execute(
        f"UPDATE minute_items SET {sets}, version = version + 1, updated_by = %s, updated_at = now() WHERE id = %s RETURNING *",
        (*params, user.username, item_id))).fetchone()
    members, times = await item_context(conn, meeting)
    return item_payload(row, members, times)


async def stale(conn, meeting: dict, row: dict) -> JSONResponse:
    members, times = await item_context(conn, meeting)
    return JSONResponse({"detail": CHANGED_BY_OTHERS, "item": item_payload(row, members, times)}, status_code=409)


@router.post("/api/meetings/{meeting_id}/minutes/items", status_code=201)
async def add_item(meeting_id: str, body: ItemIn, user: auth.CurrentUser):
    """A hand-added item is confirmed by whoever adds it."""
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        members, times = await item_context(conn, meeting)
        owner = require_owner(body.owner, members)
        evidence = sorted({n for n in body.evidence if n in times})
        row = await (await conn.execute(
            "INSERT INTO minute_items (meeting_id, kind, content, owner, due_date, due_text, evidence, origin, state, updated_by, confirmed_by, confirmed_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, 'manual', 'confirmed', %s, %s, now()) RETURNING *",
            (meeting["id"], body.kind, body.content, owner, body.dueDate, body.dueText.strip(), evidence, user.username, user.username))).fetchone()
        return item_payload(row, members, times)


@router.patch("/api/meetings/{meeting_id}/minutes/items/{item_id}")
async def change_item(meeting_id: str, item_id: int, body: ItemChange, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting, row = await locked_item(conn, user, meeting_id, item_id)
        if row["version"] != body.version:
            return await stale(conn, meeting, row)
        given = body.model_fields_set
        members, _ = await item_context(conn, meeting)
        values = {"kind": body.kind if "kind" in given and body.kind else row["kind"],
                  "content": body.content if "content" in given and body.content else row["content"],
                  "owner": require_owner(body.owner, members) if "owner" in given else row["owner"],
                  "due_date": body.dueDate if "dueDate" in given else row["due_date"],
                  "due_text": (body.dueText or "").strip() if "dueText" in given else row["due_text"]}
        # A person chose the owner: the model's unmatched name no longer applies.
        hint = "" if "owner" in given else row["owner_hint"]
        return await updated(conn, meeting, item_id,
                             "kind = %s, content = %s, owner = %s, due_date = %s, due_text = %s, owner_hint = %s, edited = edited OR %s",
                             (values["kind"], values["content"], values["owner"], values["due_date"], values["due_text"], hint,
                              changed_by_hand(row, values)), user)


@router.post("/api/meetings/{meeting_id}/minutes/items/{item_id}/{action}")
async def decide_item(meeting_id: str, item_id: int, action: Literal["confirm", "reject"], body: VersionIn, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting, row = await locked_item(conn, user, meeting_id, item_id)
        if row["version"] != body.version:
            return await stale(conn, meeting, row)
        if action == "confirm":
            return await updated(conn, meeting, item_id, "state = 'confirmed', confirmed_by = %s, confirmed_at = now()", (user.username,), user)
        return await updated(conn, meeting, item_id, "state = 'rejected', confirmed_by = NULL, confirmed_at = NULL", (), user)


@router.patch("/api/meetings/{meeting_id}/minutes/summary")
async def change_summary(meeting_id: str, body: SummaryIn, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        await conn.execute("INSERT INTO minutes (meeting_id) VALUES (%s) ON CONFLICT DO NOTHING", (meeting["id"],))
        row = await (await conn.execute("SELECT summary, summary_version FROM minutes WHERE meeting_id = %s FOR UPDATE", (meeting["id"],))).fetchone()
        if row["summary_version"] != body.version:
            return JSONResponse({"detail": CHANGED_BY_OTHERS, "summary": row["summary"], "summaryVersion": row["summary_version"]}, status_code=409)
        row = await (await conn.execute(
            "UPDATE minutes SET summary = %s, summary_edited = true, summary_version = summary_version + 1 WHERE meeting_id = %s "
            "RETURNING summary, summary_version", (body.summary.strip(), meeting["id"]))).fetchone()
    return {"summary": row["summary"], "summaryVersion": row["summary_version"]}


# --- Export ----------------------------------------------------------------------------------------

def clock(ms: int) -> str:
    seconds = ms // 1000
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def due_label(due: date | None, phrase: str) -> str:
    if due and phrase:
        return f"{due.isoformat()}（{phrase}）"
    return due.isoformat() if due else phrase or "未定"


def markdown(meeting: dict, team: str, summary: str, items: list[dict], members: dict, times: dict) -> str:
    start = local_start(meeting)
    lines = [f"# {display_title(meeting)}", "",
             f"- 日期：{start:%Y/%m/%d %H:%M}（星期{WEEKDAYS[start.weekday()]}）", f"- 團隊：{team}", "", "## 摘要", "", summary or "（無）"]
    for kind in KINDS:
        chosen = [i for i in items if i["kind"] == kind and i["state"] == "confirmed"]
        if not chosen:
            continue
        lines += ["", f"## {LABELS[kind]}", ""]
        for i in chosen:
            parts = [i["content"].rstrip("。．.；;")]   # the separators below end each part
            if kind == "action":
                parts.append(f"負責人：{members.get(i['owner'], i['owner']) if i['owner'] else '未指派'}")
                parts.append(f"到期：{due_label(i['due_date'], i['due_text'])}")
            stamps = [clock(times[n]) for n in i["evidence"] if n in times]
            if stamps:
                parts.append(f"錄音 {'、'.join(stamps)}")
            lines.append("- " + "；".join(parts))
    return "\n".join(lines) + "\n"


@router.get("/api/meetings/{meeting_id}/minutes.md")
async def export_markdown(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        row = await (await conn.execute("SELECT summary FROM minutes WHERE meeting_id = %s", (meeting["id"],))).fetchone()
        items = await (await conn.execute("SELECT * FROM minute_items WHERE meeting_id = %s ORDER BY id", (meeting["id"],))).fetchall()
        members, times = await item_context(conn, meeting)
        team = await (await conn.execute("SELECT name FROM teams WHERE id = %s", (meeting["team_id"],))).fetchone()
    text = markdown(meeting, team["name"], row["summary"] if row else "", items, members, times)
    name = f"{display_title(meeting)}.md".replace("/", "-")
    return Response(text, media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename=\"minutes.md\"; filename*=UTF-8''{quote(name)}"})
