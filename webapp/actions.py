"""Action tracking: confirmed action items carry a status (未開始, 進行中, 已完成, 已取消) that any member of
the meeting's team changes; every change is kept in item_updates. The board lists the confirmed action items
of all the user's teams. Overdue is judged on the server's calendar (MEETING_TIMEZONE).
"""
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StringConstraints

import auth
import db
import minutes
import team_access

STATUSES = ("todo", "doing", "done", "cancelled")
Status = Literal["todo", "doing", "done", "cancelled"]
NOT_AN_ACTION = "只有已確認的待辦可以更新狀態"
UNCHANGED = "狀態沒有改變"
REASON_REQUIRED = "取消待辦請填寫原因"
BOARD_LIMIT = 500

router = APIRouter()


class StatusIn(BaseModel):
    version: int
    status: Status
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


@router.post("/api/meetings/{meeting_id}/minutes/items/{item_id}/status")
async def change_status(meeting_id: str, item_id: int, body: StatusIn, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting, row = await minutes.locked_item(conn, user, meeting_id, item_id)
        if row["version"] != body.version:
            return await minutes.stale(conn, meeting, row)
        if row["kind"] != "action" or row["state"] != "confirmed":
            raise HTTPException(status_code=409, detail=NOT_AN_ACTION)
        if body.status == row["status"]:
            raise HTTPException(status_code=422, detail=UNCHANGED)
        if body.status == "cancelled" and not body.note:
            raise HTTPException(status_code=422, detail=REASON_REQUIRED)
        return await apply_status(conn, meeting, row, body.status, body.note, user)


async def apply_status(conn, meeting: dict, row: dict, status: str, note: str, user: auth.User,
                       heard_in=None, evidence: list[int] = ()) -> dict:
    """Record the change in the history and update the locked item; heard_in/evidence: the meeting and
    segments where the progress was said (meeting-series). Returns the item as the minutes page shows it."""
    await conn.execute("INSERT INTO item_updates (item_id, from_status, to_status, note, meeting_id, evidence, changed_by) "
                       "VALUES (%s, %s, %s, %s, %s, %s, %s)", (row["id"], row["status"], status, note, heard_in, list(evidence), user.username))
    return await minutes.updated(conn, meeting, row["id"], "status = %s, status_note = %s, status_by = %s, status_at = now()",
                                 (status, note, user.username), user)


@router.get("/api/meetings/{meeting_id}/minutes/items/{item_id}/updates")
async def status_history(meeting_id: str, item_id: int, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        if not await (await conn.execute("SELECT 1 FROM minute_items WHERE id = %s AND meeting_id = %s", (item_id, meeting["id"]))).fetchone():
            raise HTTPException(status_code=404, detail="找不到這個條目")
        rows = await (await conn.execute(
            "SELECT u.*, coalesce(nullif(p.display_name, ''), u.changed_by) AS display_name FROM item_updates u "
            "LEFT JOIN users p ON p.username = u.changed_by WHERE u.item_id = %s ORDER BY u.id DESC", (item_id,))).fetchall()
    return [{"from": r["from_status"], "to": r["to_status"], "note": r["note"], "by": r["display_name"], "at": r["changed_at"].isoformat(),
             "meetingId": str(r["meeting_id"]) if r["meeting_id"] else None, "evidence": r["evidence"]} for r in rows]


@router.get("/actions")
async def board_page(user: auth.CurrentUser):
    return FileResponse(auth.STATIC_DIR / "actions.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/actions")
async def board(user: auth.CurrentUser, team: int | None = None, owner: str = Query("", max_length=256),
                status: str = Query(",".join(STATUSES[:3]), max_length=100),
                due: Literal["", "overdue", "week", "none"] = "", q: str = Query("", max_length=minutes.CONTENT_MAX)):
    """Confirmed action items of the user's teams, most overdue first, then by due date (none last)."""
    wanted = [s for s in status.split(",") if s]
    if not wanted or any(s not in STATUSES for s in wanted):
        raise HTTPException(status_code=422, detail="不支援的狀態")
    today = minutes.local_today()
    where = ["i.kind = 'action'", "i.state = 'confirmed'", "i.status = ANY(%(statuses)s)"]
    params = {"statuses": wanted, "today": today, "open": list(minutes.OPEN_STATUSES)}
    if team is not None:
        where.append("m.team_id = %(team)s")
        params["team"] = team
    owner = owner.strip().lower()
    if owner == "none":
        where.append("i.owner IS NULL")
    elif owner:
        where.append("i.owner = %(owner)s")
        params["owner"] = user.username if owner == "me" else owner
    if due == "overdue":
        where.append("i.status = ANY(%(open)s) AND i.due_date < %(today)s")
    elif due == "week":
        where.append("i.status = ANY(%(open)s) AND i.due_date BETWEEN %(today)s AND %(week)s")
        params["week"] = today + timedelta(days=7)
    elif due == "none":
        where.append("i.due_date IS NULL")
    if q.strip():
        where.append("i.content ILIKE %(q)s ESCAPE '\\'")
        params["q"] = team_access.like_pattern(q.strip())
    async with db.connect() as conn:
        if team is not None and not await team_access.is_member(conn, user.username, team):
            raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)
        items = await action_rows(conn, user, where, params)
        teams = await (await conn.execute(
            "SELECT t.id, t.name FROM teams t JOIN team_members tm ON tm.team_id = t.id AND tm.username = %s ORDER BY t.name",
            (user.username,))).fetchall()
        people = await (await conn.execute(
            "SELECT DISTINCT tm.username, coalesce(nullif(u.display_name, ''), tm.username) AS display_name FROM team_members tm "
            "JOIN team_members mine ON mine.team_id = tm.team_id AND mine.username = %s LEFT JOIN users u ON u.username = tm.username "
            "ORDER BY tm.username", (user.username,))).fetchall()
    return {"items": items, "teams": [{"id": t["id"], "name": t["name"]} for t in teams],
            "people": [{"username": p["username"], "displayName": p["display_name"]} for p in people]}


async def action_rows(conn, user: auth.User, where: list[str], params: dict) -> list[dict]:
    """Action items of the user's teams matching where (SQL on i = minute_items, m = meetings), as the board
    shows them, most overdue first, then by due date (none last). params needs no today/open/user."""
    params = {**params, "user": user.username, "today": minutes.local_today(), "open": list(minutes.OPEN_STATUSES)}
    rows = await (await conn.execute(
        "SELECT i.*, m.title AS meeting_title, m.started_at, m.team_id, t.name AS team_name, "
        "coalesce(nullif(o.display_name, ''), i.owner) AS owner_name, "
        "CASE WHEN i.status = ANY(%(open)s) AND i.due_date < %(today)s THEN %(today)s - i.due_date ELSE 0 END AS overdue "
        "FROM minute_items i JOIN meetings m ON m.id = i.meeting_id JOIN teams t ON t.id = m.team_id "
        "JOIN team_members tm ON tm.team_id = m.team_id AND tm.username = %(user)s "
        "LEFT JOIN users o ON o.username = i.owner "
        "WHERE " + " AND ".join(where) + " ORDER BY overdue DESC, i.due_date ASC NULLS LAST, i.id LIMIT " + str(BOARD_LIMIT),
        params)).fetchall()
    return [{"id": r["id"], "meetingId": str(r["meeting_id"]), "meetingTitle": r["meeting_title"],
             "startedAt": r["started_at"].isoformat(), "teamId": r["team_id"], "team": r["team_name"],
             "content": r["content"], "owner": r["owner"], "ownerName": r["owner_name"], "ownerHint": r["owner_hint"],
             "dueDate": r["due_date"].isoformat() if r["due_date"] else None, "dueText": r["due_text"],
             "status": r["status"], "statusNote": r["status_note"], "overdueDays": r["overdue"], "version": r["version"]}
            for r in rows]
