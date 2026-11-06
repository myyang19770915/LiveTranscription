"""Meeting series and in-meeting progress detection (meeting-series).

A team's recurring meetings form a series chosen before the meeting. The meeting page lists the series'
unfinished action items; with detection on, newly finalized segments go to the minutes model with those
items, and what it finds becomes suggestions a person applies or dismisses. Model output is untrusted: an
update must name a listed item, change its status, and cite segments sent in that very check.
"""
import asyncio
import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints

import actions
import auth
import db
import minutes
import team_access

NAME_MAX = 60
CHECK_TIMEOUT = 60          # seconds; a check runs during the meeting and must not hang
WINDOW = 40                 # at most this many new segments per check (the most recent ones)
CONTEXT = 2                 # earlier segments sent along for context, never cited
NOTE_MAX = 200
SUGGESTED = ("doing", "done", "cancelled")
LABELS = {"todo": "未開始", "doing": "進行中", "done": "已完成", "cancelled": "已取消"}
HANDLED = "這則提示已處理"
CHECK_FAILED = "進度偵測暫時失敗，稍後重試"

PROMPT = """你在會議進行中協助追蹤待辦。下面有這個系列會議之前留下、還沒完成的待辦，以及這場會議剛說的段落。
判斷段落是否明確提到某個待辦的進度，規則：
1. 只根據段落內容，不要推測；沒把握就不要列。
2. status 只能是 doing（已開始、進行中）、done（已完成、已交付）或 cancelled（不做了、取消），而且要和目前狀態不同。
3. 每則更新都必須在 evidence 列出提到進度的段落編號，只能用「新段落」的編號。
4. note 用繁體中文一句話說明根據什麼判斷；cancelled 一定要寫原因。
5. 只輸出 JSON：{"updates": [{"item": 待辦編號, "status": "done", "note": "…", "evidence": [段落編號]}]}；沒有就輸出 {"updates": []}。"""

router = APIRouter()
logger = logging.getLogger("uvicorn.error")
_checks: dict[str, asyncio.Lock] = {}

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX)]


class SeriesIn(BaseModel):
    name: Name


class CheckIn(BaseModel):
    after: int = Field(default=0, ge=0)


# --- Series ----------------------------------------------------------------------------------------

async def require_team(conn, user: auth.User, team_id: int) -> None:
    if not await team_access.is_member(conn, user.username, team_id):
        raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)


@router.get("/api/teams/{team_id}/series")
async def list_series(team_id: int, user: auth.CurrentUser):
    async with db.connect() as conn:
        await require_team(conn, user, team_id)
        rows = await (await conn.execute("SELECT id, name FROM meeting_series WHERE team_id = %s ORDER BY name_key", (team_id,))).fetchall()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


@router.post("/api/teams/{team_id}/series")
async def create_series(team_id: int, body: SeriesIn, user: auth.CurrentUser):
    """A name the team already has (in any letter case) returns that series with 200 instead of a new one."""
    async with db.connect() as conn:
        await require_team(conn, user, team_id)
        row = await (await conn.execute(
            "INSERT INTO meeting_series (team_id, name, name_key, created_by) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (team_id, name_key) DO NOTHING RETURNING id, name", (team_id, body.name, body.name.casefold(), user.username))).fetchone()
        if row:
            return JSONResponse({"id": row["id"], "name": row["name"]}, status_code=201)
        row = await (await conn.execute("SELECT id, name FROM meeting_series WHERE team_id = %s AND name_key = %s",
                                        (team_id, body.name.casefold()))).fetchone()
    return {"id": row["id"], "name": row["name"]}


async def unfinished(conn, user: auth.User, series_id: int, exclude=None) -> list[dict]:
    """Confirmed, unfinished action items from the series' meetings (other than exclude), as the board lists them."""
    where = ["i.kind = 'action'", "i.state = 'confirmed'", "i.status = ANY(%(open)s)", "m.series_id = %(series)s"]
    params = {"series": series_id}
    if exclude is not None:
        where.append("m.id <> %(exclude)s")
        params["exclude"] = exclude
    return await actions.action_rows(conn, user, where, params)


@router.get("/api/series/{series_id}/actions")
async def series_actions(series_id: int, user: auth.CurrentUser, exclude: str | None = None):
    async with db.connect() as conn:
        row = await (await conn.execute("SELECT team_id FROM meeting_series WHERE id = %s", (series_id,))).fetchone()
        if row is None or not await team_access.is_member(conn, user.username, row["team_id"]):
            raise HTTPException(status_code=404, detail="找不到這個系列")
        try:
            skip = uuid.UUID(exclude) if exclude else None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="exclude 不是會議編號") from exc
        return await unfinished(conn, user, series_id, skip)


# --- Progress detection ----------------------------------------------------------------------------

def build_messages(meeting: dict, items: list[dict], context: list[dict], fresh: list[dict]) -> list[dict]:
    def item_line(i):
        owner = i["ownerName"] or "未指派"
        due = i["dueDate"] or "沒有到期日"
        return f"[#{i['id']}] {i['content']}（負責人：{owner}；到期：{due}；目前：{LABELS[i['status']]}）"
    parts = [f"會議：{minutes.display_title(meeting)}（{minutes.local_start(meeting):%Y-%m-%d}）", "", "待辦：",
             *map(item_line, items)]
    if context:
        parts += ["", "前文（只供理解，不可引用）：", *(f"[{s['seq']}] {s['source']}" for s in context)]
    parts += ["", "新段落：", *(f"[{s['seq']}] {s['source']}" for s in fresh)]
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": "\n".join(parts)}]


def clean_updates(answer: dict, items: dict[int, str], seqs: set[int]) -> list[dict]:
    """Validated updates from the model: items maps listed item ids to their status; seqs are this check's segments."""
    found, seen = [], set()
    for raw in answer.get("updates") or []:
        if not isinstance(raw, dict):
            continue
        try:
            item = int(raw.get("item"))
        except (TypeError, ValueError):
            continue
        status = raw.get("status")
        if item not in items or status not in SUGGESTED or status == items[item] or (item, status) in seen:
            continue
        evidence = sorted({n for n in (raw.get("evidence") or []) if isinstance(n, int) and n in seqs})
        note = str(raw.get("note") or "").strip()[:NOTE_MAX]
        if not evidence or (status == "cancelled" and not note):
            continue
        seen.add((item, status))
        found.append({"item": item, "status": status, "note": note, "evidence": evidence})
    return found


async def suggestions(conn, meeting_id, pending_only: bool = True, only: int | None = None) -> list[dict]:
    """The meeting's suggestions (pending ones, all, or just `only`) with the item's current status and the cited segments."""
    rows = await (await conn.execute(
        "SELECT p.*, i.content, i.status AS item_status, i.meeting_id AS item_meeting FROM progress_suggestions p "
        "JOIN minute_items i ON i.id = p.item_id WHERE p.meeting_id = %s" + (" AND p.state = 'pending'" if pending_only else "")
        + (" AND p.id = %s" if only is not None else "") + " ORDER BY p.id",
        (meeting_id, *(() if only is None else (only,))))).fetchall()
    cited = sorted({n for r in rows for n in r["evidence"]})
    segments = {r["seq"]: r for r in await (await conn.execute(
        "SELECT seq, start_ms, source FROM segments WHERE meeting_id = %s AND seq = ANY(%s)", (meeting_id, cited))).fetchall()} if cited else {}
    return [{"id": r["id"], "itemId": r["item_id"], "itemMeetingId": str(r["item_meeting"]), "content": r["content"],
             "fromStatus": r["item_status"], "toStatus": r["to_status"], "note": r["note"], "state": r["state"],
             "evidence": [{"seq": n, "startMs": segments[n]["start_ms"], "source": segments[n]["source"]} for n in r["evidence"] if n in segments]}
            for r in rows]


@router.post("/api/meetings/{meeting_id}/progress/check")
async def check_progress(meeting_id: str, body: CheckIn, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        if not minutes.configured():
            raise HTTPException(status_code=400, detail=minutes.NOT_CONFIGURED)
        pending = await suggestions(conn, meeting["id"])
    key = str(meeting["id"])
    lock = _checks.setdefault(key, asyncio.Lock())
    if lock.locked():
        return {"suggestions": pending, "checkedThrough": body.after, "busy": True}
    try:
        async with lock:
            return await run_check(meeting, body.after, user, pending)
    finally:
        if not lock.locked():
            _checks.pop(key, None)


async def run_check(meeting: dict, after: int, user: auth.User, pending: list[dict]) -> dict:
    """One detection pass under the meeting's lock: new segments and the series' unfinished items to the model."""
    async with db.connect() as conn:
        items = await unfinished(conn, user, meeting["series_id"], meeting["id"]) if meeting["series_id"] else []
        fresh = await (await conn.execute(
            "SELECT seq, source FROM (SELECT seq, source FROM segments WHERE meeting_id = %s AND seq > %s ORDER BY seq DESC LIMIT %s) s "
            "ORDER BY seq", (meeting["id"], after, WINDOW))).fetchall()
        through = fresh[-1]["seq"] if fresh else after
        if not items or not fresh:
            return {"suggestions": pending, "checkedThrough": through, "busy": False}
        context = list(reversed(await (await conn.execute(
            "SELECT seq, source FROM segments WHERE meeting_id = %s AND seq < %s ORDER BY seq DESC LIMIT %s",
            (meeting["id"], fresh[0]["seq"], CONTEXT))).fetchall()))
    try:
        answer = await minutes.call_model(build_messages(meeting, items, context, fresh), timeout=CHECK_TIMEOUT)
        updates = clean_updates(minutes.parse_answer(answer), {i["id"]: i["status"] for i in items}, {s["seq"] for s in fresh})
    except Exception as exc:  # the meeting goes on; the same segments are sent again next time
        logger.warning("Progress check failed for meeting %s: %s", meeting["id"], exc)
        return {"suggestions": pending, "checkedThrough": after, "busy": False, "error": CHECK_FAILED}
    async with db.connect() as conn:
        for update in updates:
            await conn.execute(
                "INSERT INTO progress_suggestions (meeting_id, item_id, to_status, note, evidence) VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT (meeting_id, item_id, to_status) DO NOTHING",
                (meeting["id"], update["item"], update["status"], update["note"], update["evidence"]))
        return {"suggestions": await suggestions(conn, meeting["id"]), "checkedThrough": through, "busy": False}


@router.get("/api/meetings/{meeting_id}/progress")
async def list_progress(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        return await suggestions(conn, meeting["id"], pending_only=False)


@router.post("/api/meetings/{meeting_id}/progress/{suggestion_id}/{action}")
async def decide(meeting_id: str, suggestion_id: int, action: Literal["accept", "dismiss"], user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        suggestion = await (await conn.execute("SELECT * FROM progress_suggestions WHERE id = %s AND meeting_id = %s FOR UPDATE",
                                               (suggestion_id, meeting["id"]))).fetchone()
        if suggestion is None:
            raise HTTPException(status_code=404, detail="找不到這則提示")
        if suggestion["state"] != "pending":
            raise HTTPException(status_code=409, detail=HANDLED)
        item = None
        if action == "accept":
            row = await (await conn.execute("SELECT * FROM minute_items WHERE id = %s FOR UPDATE", (suggestion["item_id"],))).fetchone()
            home = await (await conn.execute("SELECT * FROM meetings WHERE id = %s", (row["meeting_id"],))).fetchone()
            if row["kind"] != "action" or row["state"] != "confirmed" or home["team_id"] != meeting["team_id"]:
                raise HTTPException(status_code=409, detail=actions.NOT_AN_ACTION)
            if row["status"] == suggestion["to_status"]:
                members, times = await minutes.item_context(conn, home)
                item = minutes.item_payload(row, members, times)
            else:
                item = await actions.apply_status(conn, home, row, suggestion["to_status"], suggestion["note"], user,
                                                  heard_in=meeting["id"], evidence=suggestion["evidence"])
        await conn.execute("UPDATE progress_suggestions SET state = %s, decided_by = %s, decided_at = now() WHERE id = %s",
                           ("accepted" if action == "accept" else "dismissed", user.username, suggestion_id))
        if action == "accept":
            # Once one is applied, the item's other pending suggestions in this meeting are out of date.
            await conn.execute("UPDATE progress_suggestions SET state = 'dismissed', decided_by = %s, decided_at = now() "
                               "WHERE meeting_id = %s AND item_id = %s AND state = 'pending'", (user.username, meeting["id"], suggestion["item_id"]))
        decided = (await suggestions(conn, meeting["id"], pending_only=False, only=suggestion_id))[0]
    return {"suggestion": decided, "item": item}
