"""Action tracking: confirmed action items carry a status (未開始, 進行中, 已完成, 已取消) that any member of
the item's team changes; every change is kept in item_updates. The board lists the confirmed action items
of all the user's teams. Overdue is judged on the server's calendar (MEETING_TIMEZONE).

Items created on the board (board-created-actions) belong to no meeting: they carry their own team and,
optionally, a series. The board reaches every action item through /api/actions/{id}, whose access is decided
by the item's team; the minutes page keeps its meeting routes.
"""
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse, JSONResponse
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
ITEM_NOT_FOUND = "找不到這個待辦"
MEETING_ITEM_NOT_DELETABLE = "會議產生的待辦請改用已取消"
REMIND_FORBIDDEN = "只有負責人或系統管理員可以切換提醒"

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
        check_status(row, body)
        return await apply_status(conn, meeting, row, body.status, body.note, user)


def check_status(row: dict, body: StatusIn) -> None:
    """The rules of a status change, the same from the minutes page and the board."""
    if body.status == row["status"]:
        raise HTTPException(status_code=422, detail=UNCHANGED)
    if body.status == "cancelled" and not body.note:
        raise HTTPException(status_code=422, detail=REASON_REQUIRED)


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
        return await history_rows(conn, item_id)


async def history_rows(conn, item_id: int) -> list[dict]:
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
        where.append("i.team_id = %(team)s")
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
        # Each person with the teams they share with the user: the detail panel offers only the item's team's members.
        people = await (await conn.execute(
            "SELECT tm.username, coalesce(nullif(u.display_name, ''), tm.username) AS display_name, array_agg(tm.team_id ORDER BY tm.team_id) AS teams, "
            "a.updated_at AS avatar_at FROM team_members tm JOIN team_members mine ON mine.team_id = tm.team_id AND mine.username = %s "
            "LEFT JOIN users u ON u.username = tm.username LEFT JOIN user_avatars a ON a.username = tm.username "
            "GROUP BY tm.username, u.display_name, a.updated_at ORDER BY tm.username", (user.username,))).fetchall()
    # today: the server's calendar (MEETING_TIMEZONE), so "due soon" and "recently done" agree with overdue days.
    return {"items": items, "today": minutes.local_today().isoformat(), "teams": [{"id": t["id"], "name": t["name"]} for t in teams],
            "people": [{"username": p["username"], "displayName": p["display_name"], "teams": p["teams"],
                        "avatarUrl": team_access.avatar_url(p["username"], p["avatar_at"])} for p in people]}


async def action_rows(conn, user: auth.User, where: list[str], params: dict) -> list[dict]:
    """Action items of the user's teams matching where (SQL on i = minute_items, m = meetings), as the board
    shows them, most overdue first, then by due date (none last). params needs no today/open/user."""
    params = {**params, "user": user.username, "today": minutes.local_today(), "open": list(minutes.OPEN_STATUSES)}
    rows = await (await conn.execute(
        "SELECT i.*, m.title AS meeting_title, m.started_at, t.name AS team_name, ms.name AS series_name, "
        "coalesce(nullif(o.display_name, ''), i.owner) AS owner_name, "
        "CASE WHEN i.status = ANY(%(open)s) AND i.due_date < %(today)s THEN %(today)s - i.due_date ELSE 0 END AS overdue "
        "FROM minute_items i LEFT JOIN meetings m ON m.id = i.meeting_id JOIN teams t ON t.id = i.team_id "
        "JOIN team_members tm ON tm.team_id = i.team_id AND tm.username = %(user)s "
        "LEFT JOIN users o ON o.username = i.owner LEFT JOIN meeting_series ms ON ms.id = coalesce(m.series_id, i.series_id) "
        "WHERE " + " AND ".join(where) + " ORDER BY overdue DESC, i.due_date ASC NULLS LAST, i.id LIMIT " + str(BOARD_LIMIT),
        params)).fetchall()
    return [{"id": r["id"], "meetingId": str(r["meeting_id"]) if r["meeting_id"] else None, "meetingTitle": r["meeting_title"],
             "startedAt": r["started_at"].isoformat() if r["started_at"] else None, "teamId": r["team_id"], "team": r["team_name"],
             "origin": r["origin"], "seriesId": r["series_id"],
             "content": r["content"], "owner": r["owner"], "ownerName": r["owner_name"], "ownerHint": r["owner_hint"],
             "dueDate": r["due_date"].isoformat() if r["due_date"] else None, "dueText": r["due_text"],
             "status": r["status"], "statusNote": r["status_note"], "overdueDays": r["overdue"], "version": r["version"],
             "statusAt": r["status_at"].isoformat() if r["status_at"] else None, "series": r["series_name"], "remind": r["remind"]}
            for r in rows]


# --- Items by id (board-created-actions) ---------------------------------------------------------------

class NewAction(BaseModel):
    teamId: int
    content: minutes.Content
    owner: str | None = None
    dueDate: date | None = None
    seriesId: int | None = None


class ActionChange(BaseModel):
    version: int
    content: minutes.Content | None = None
    owner: str | None = None
    dueDate: date | None = None


async def item_row(conn, user: auth.User, item_id: int) -> dict:
    """The action item as the board lists it, or 404 when it is not an action of one of the user's teams."""
    rows = await action_rows(conn, user, ["i.id = %(id)s", "i.kind = 'action'", "i.state = 'confirmed'"], {"id": item_id})
    if not rows:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)
    return rows[0]


async def locked_action(conn, user: auth.User, item_id: int) -> tuple[dict, dict]:
    """(home, row): the locked confirmed action item of one of the user's teams, and its meeting, or for a
    board item a stand-in {id: None, team_id} that minutes.item_context understands."""
    row = await (await conn.execute("SELECT * FROM minute_items WHERE id = %s AND kind = 'action' AND state = 'confirmed' FOR UPDATE",
                                    (item_id,))).fetchone()
    if row is None or not await team_access.is_member(conn, user.username, row["team_id"]):
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)
    return await home_of(conn, row), row


async def home_of(conn, row: dict) -> dict:
    if row["meeting_id"] is None:
        return {"id": None, "team_id": row["team_id"]}
    return await (await conn.execute("SELECT * FROM meetings WHERE id = %s", (row["meeting_id"],))).fetchone()


async def stale_action(conn, user: auth.User, row: dict) -> JSONResponse:
    return JSONResponse({"detail": minutes.CHANGED_BY_OTHERS, "item": await item_row(conn, user, row["id"])}, status_code=409)


@router.post("/api/actions", status_code=201)
async def create_action(body: NewAction, user: auth.CurrentUser):
    """A board item: confirmed, 未開始, in no meeting; the series (optional) must be the team's."""
    async with db.connect() as conn:
        if not await team_access.is_member(conn, user.username, body.teamId):
            raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)
        members, _ = await minutes.item_context(conn, {"id": None, "team_id": body.teamId})
        owner = minutes.require_owner(body.owner, members)
        if body.seriesId is not None:
            await team_access.series_name(conn, body.seriesId, body.teamId)
        row = await (await conn.execute(
            "INSERT INTO minute_items (team_id, series_id, kind, content, owner, due_date, origin, state, updated_by, confirmed_by, confirmed_at) "
            "VALUES (%s, %s, 'action', %s, %s, %s, 'manual', 'confirmed', %s, %s, now()) RETURNING id",
            (body.teamId, body.seriesId, body.content, owner, body.dueDate, user.username, user.username))).fetchone()
        return await item_row(conn, user, row["id"])


@router.patch("/api/actions/{item_id}")
async def change_action(item_id: int, body: ActionChange, user: auth.CurrentUser):
    async with db.connect() as conn:
        home, row = await locked_action(conn, user, item_id)
        if row["version"] != body.version:
            return await stale_action(conn, user, row)
        given = body.model_fields_set
        members, _ = await minutes.item_context(conn, home)
        values = {"content": body.content if "content" in given and body.content else row["content"],
                  "owner": minutes.require_owner(body.owner, members) if "owner" in given else row["owner"],
                  "due_date": body.dueDate if "dueDate" in given else row["due_date"]}
        # A new owner gets reminders again (action-reminders): switching them off was the previous owner's choice.
        await minutes.updated(conn, home, item_id,
                              "content = %s, owner = %s, due_date = %s, owner_hint = %s, edited = edited OR %s, remind = remind OR %s",
                              (values["content"], values["owner"], values["due_date"], "" if "owner" in given else row["owner_hint"],
                               minutes.changed_by_hand(row, values), values["owner"] != row["owner"]), user)
        return await item_row(conn, user, item_id)


@router.post("/api/actions/{item_id}/status")
async def change_action_status(item_id: int, body: StatusIn, user: auth.CurrentUser):
    async with db.connect() as conn:
        home, row = await locked_action(conn, user, item_id)
        if row["version"] != body.version:
            return await stale_action(conn, user, row)
        check_status(row, body)
        await apply_status(conn, home, row, body.status, body.note, user)
        return await item_row(conn, user, item_id)


class RemindIn(BaseModel):
    on: bool


@router.post("/api/actions/{item_id}/remind")
async def switch_reminders(item_id: int, body: RemindIn, user: auth.CurrentUser):
    """Due-date e-mail reminders on or off for one item (action-reminders): its owner or an administrator only."""
    async with db.connect() as conn:
        _, row = await locked_action(conn, user, item_id)
        if not (user.admin or row["owner"] == user.username):
            raise HTTPException(status_code=403, detail=REMIND_FORBIDDEN)
        await conn.execute("UPDATE minute_items SET remind = %s WHERE id = %s", (body.on, item_id))
        return await item_row(conn, user, item_id)


@router.get("/api/actions/{item_id}/updates")
async def action_history(item_id: int, user: auth.CurrentUser):
    async with db.connect() as conn:
        await item_row(conn, user, item_id)
        return await history_rows(conn, item_id)


@router.delete("/api/actions/{item_id}", status_code=204)
async def delete_action(item_id: int, user: auth.CurrentUser):
    """Only a board item can be deleted (its history goes with it); one from a meeting is cancelled instead."""
    async with db.connect() as conn:
        _, row = await locked_action(conn, user, item_id)
        if row["meeting_id"] is not None:
            raise HTTPException(status_code=409, detail=MEETING_ITEM_NOT_DELETABLE)
        await conn.execute("DELETE FROM minute_items WHERE id = %s", (item_id,))
    return Response(status_code=204)

