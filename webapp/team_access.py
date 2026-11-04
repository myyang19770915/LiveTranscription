"""Teams, membership, and the team check on meeting data.

Only system administrators (ADMIN_USERS) manage teams; being one grants no access to any team's
meetings. Meeting data is checked against the current membership on every request, and a
non-member gets the same 404 as for a meeting that does not exist.
"""
import os
import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field

import auth
import db

router = APIRouter()
NOT_FOUND = "找不到會議"
TEAM_NOT_FOUND = "找不到團隊"
# Meeting files land in output/teams/<team id>/<meeting id>/ (compose mounts the project's output/ folder).
OUTPUT_DIR = Path(os.getenv("MEETING_OUTPUT_DIR", "/output"))
MAX_MEETING_BYTES = 1 << 30


async def require_admin(user: auth.CurrentUser) -> auth.User:
    if not user.admin:
        raise HTTPException(status_code=403, detail="需要系統管理員權限")
    return user


Admin = Annotated[auth.User, Depends(require_admin)]


def name_key(name: str) -> str:
    return name.strip().casefold()


class TeamName(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class MemberName(BaseModel):
    username: str = Field(min_length=1, max_length=256, pattern=r"^\s*\S+\s*$")


async def team_exists(conn, team_id: int) -> bool:
    return await (await conn.execute("SELECT 1 FROM teams WHERE id = %s", (team_id,))).fetchone() is not None


FORBIDDEN_PAGE = ('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>沒有權限 — 語橋 Live</title>'
                  '<link rel="stylesheet" href="/assets/styles.css?v=20260927c"><link rel="stylesheet" href="/assets/themes.css?v=20260928b">'
                  '<main><h1>沒有權限</h1><p>團隊管理只開放給系統管理員。</p><p><a href="/" style="color:var(--mint)">回到語橋 Live</a></p></main></html>')


@router.get("/admin")
async def admin_page(user: auth.CurrentUser):
    if not user.admin:
        return HTMLResponse(FORBIDDEN_PAGE, status_code=403)
    return FileResponse(auth.STATIC_DIR / "admin.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/admin/teams")
async def list_teams(_admin: Admin):
    async with db.connect() as conn:
        teams = await (await conn.execute("SELECT id, name FROM teams ORDER BY name")).fetchall()
        members = await (await conn.execute(
            "SELECT m.team_id, m.username, coalesce(u.display_name, '') AS display_name, u.username IS NOT NULL AS signed_in "
            "FROM team_members m LEFT JOIN users u USING (username) ORDER BY m.username")).fetchall()
    return [{"id": team["id"], "name": team["name"],
             "members": [{"username": m["username"], "displayName": m["display_name"], "signedIn": m["signed_in"]}
                         for m in members if m["team_id"] == team["id"]]} for team in teams]


@router.post("/api/admin/teams", status_code=201)
async def create_team(body: TeamName, _admin: Admin):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="請輸入團隊名稱")
    try:
        async with db.connect() as conn:
            row = await (await conn.execute("INSERT INTO teams (name, name_key) VALUES (%s, %s) RETURNING id, name",
                                            (name, name_key(name)))).fetchone()
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="已有同名團隊") from exc
    return {"id": row["id"], "name": row["name"]}


@router.patch("/api/admin/teams/{team_id}")
async def rename_team(team_id: int, body: TeamName, _admin: Admin):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="請輸入團隊名稱")
    try:
        async with db.connect() as conn:
            row = await (await conn.execute("UPDATE teams SET name = %s, name_key = %s WHERE id = %s RETURNING id, name",
                                            (name, name_key(name), team_id))).fetchone()
    except UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="已有同名團隊") from exc
    if row is None:
        raise HTTPException(status_code=404, detail=TEAM_NOT_FOUND)
    return {"id": row["id"], "name": row["name"]}


@router.post("/api/admin/teams/{team_id}/members", status_code=201)
async def add_member(team_id: int, body: MemberName, admin: Admin):
    username = body.username.strip().lower()
    async with db.connect() as conn:
        if not await team_exists(conn, team_id):
            raise HTTPException(status_code=404, detail=TEAM_NOT_FOUND)
        await conn.execute("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                           (team_id, username, admin.username))
    return {"teamId": team_id, "username": username}


async def is_member(conn, username: str, team_id: int) -> bool:
    row = await (await conn.execute("SELECT 1 FROM team_members WHERE team_id = %s AND username = %s", (team_id, username))).fetchone()
    return row is not None


async def require_member(conn, user: auth.User, meeting_id: str) -> dict:
    """The meeting, when the user belongs to its team right now; otherwise the same 404 as a missing meeting."""
    try:
        meeting_uuid = uuid.UUID(str(meeting_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=NOT_FOUND) from exc
    row = await (await conn.execute(
        "SELECT m.* FROM meetings m JOIN team_members t ON t.team_id = m.team_id AND t.username = %s WHERE m.id = %s",
        (user.username, meeting_uuid))).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return row


class NewMeeting(BaseModel):
    team_id: int
    language: str = Field(min_length=1, max_length=16)
    engine: str = Field(default="local", pattern="^(local|hybrid|mai)$")


@router.post("/api/meetings", status_code=201)
async def create_meeting(body: NewMeeting, user: auth.CurrentUser):
    async with db.connect() as conn:
        if not await is_member(conn, user.username, body.team_id):
            raise HTTPException(status_code=404, detail=TEAM_NOT_FOUND)
        row = await (await conn.execute(
            "INSERT INTO meetings (team_id, created_by, language, engine) VALUES (%s, %s, %s, %s) RETURNING id",
            (body.team_id, user.username, body.language, body.engine))).fetchone()
    return {"id": str(row["id"])}


@router.get("/api/meetings")
async def list_meetings(user: auth.CurrentUser):
    async with db.connect() as conn:
        rows = await (await conn.execute(
            "SELECT m.id, m.team_id, t.name AS team_name, m.started_at, m.created_by, m.language, m.engine "
            "FROM meetings m JOIN teams t ON t.id = m.team_id "
            "JOIN team_members tm ON tm.team_id = m.team_id AND tm.username = %s ORDER BY m.started_at DESC LIMIT 500",
            (user.username,))).fetchall()
    return [{"id": str(row["id"]), "teamId": row["team_id"], "team": row["team_name"], "startedAt": row["started_at"].isoformat(),
             "createdBy": row["created_by"], "language": row["language"], "engine": row["engine"]} for row in rows]


@router.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await require_member(conn, user, meeting_id)
        files = await (await conn.execute("SELECT kind, path, bytes FROM meeting_files WHERE meeting_id = %s ORDER BY kind",
                                          (meeting["id"],))).fetchall()
    return {"id": str(meeting["id"]), "teamId": meeting["team_id"], "startedAt": meeting["started_at"].isoformat(),
            "createdBy": meeting["created_by"], "language": meeting["language"], "engine": meeting["engine"],
            "files": [{"kind": f["kind"], "name": f["path"].rsplit("/", 1)[-1], "bytes": f["bytes"]} for f in files]}


RECORDING_TYPES = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a"}


def meeting_dir(meeting: dict) -> Path:
    return OUTPUT_DIR / "teams" / str(meeting["team_id"]) / str(meeting["id"])


@router.put("/api/meetings/{meeting_id}/files/{kind}")
async def save_meeting_file(meeting_id: str, kind: Literal["recording", "transcript"], request: Request, user: auth.CurrentUser):
    """Store a meeting's browser recording or transcript text; the server picks the file name."""
    if kind == "recording":
        media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if media_type not in RECORDING_TYPES:
            raise HTTPException(status_code=415, detail="unsupported recording type")
        name = f"recording.{RECORDING_TYPES[media_type]}"
    else:
        name = "transcript.txt"
    async with db.connect() as conn:
        meeting = await require_member(conn, user, meeting_id)
    folder = meeting_dir(meeting)
    folder.mkdir(parents=True, exist_ok=True)
    partial, size = folder / f".{name}.part", 0
    try:
        with partial.open("wb") as file:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_MEETING_BYTES:
                    raise HTTPException(status_code=413, detail="meeting file too large")
                file.write(chunk)
        partial.replace(folder / name)
    finally:
        partial.unlink(missing_ok=True)
    relative = (folder / name).relative_to(OUTPUT_DIR).as_posix()
    async with db.connect() as conn:
        await conn.execute(
            "INSERT INTO meeting_files (meeting_id, kind, path, bytes) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (meeting_id, kind) DO UPDATE SET path = excluded.path, bytes = excluded.bytes, saved_at = now()",
            (meeting["id"], kind, relative, size))
    return {"saved": f"output/{relative}", "bytes": size}


@router.delete("/api/admin/teams/{team_id}/members/{username}", status_code=204)
async def remove_member(team_id: int, username: str, _admin: Admin):
    async with db.connect() as conn:
        result = await conn.execute("DELETE FROM team_members WHERE team_id = %s AND username = %s", (team_id, username.strip().lower()))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="找不到這位成員")
    return Response(status_code=204)
