"""Teams, membership, and the team check on meeting data.

Only system administrators (ADMIN_USERS) manage teams; being one grants no access to any team's
meetings. Meeting data is checked against the current membership on every request, and a
non-member gets the same 404 as for a meeting that does not exist.
"""
import asyncio
import os
import uuid
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field, StringConstraints

import auth
import db
import meeting_audio

router = APIRouter()
NOT_FOUND = "找不到會議"
TEAM_NOT_FOUND = "找不到團隊"
# Local dates for date filters and the ASR training export.
MEETING_TIMEZONE = os.getenv("MEETING_TIMEZONE", "Asia/Taipei")
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
                  '<main><h1>沒有權限</h1><p>管理頁面只開放給系統管理員。</p><p><a href="/" style="color:var(--mint)">回到語橋 Live</a></p></main></html>')


@router.get("/admin")
async def admin_page(user: auth.CurrentUser):
    if not user.admin:
        return HTMLResponse(FORBIDDEN_PAGE, status_code=403)
    return FileResponse(auth.STATIC_DIR / "admin.html", headers={"Cache-Control": "no-cache"})


@router.get("/admin/settings")
async def settings_page(user: auth.CurrentUser):
    """Settings for the whole system (system-settings): the page is static, its figures come from the admin APIs."""
    if not user.admin:
        return HTMLResponse(FORBIDDEN_PAGE, status_code=403)
    return FileResponse(auth.STATIC_DIR / "settings.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/admin/teams")
async def list_teams(_admin: Admin):
    async with db.connect() as conn:
        teams = await (await conn.execute("SELECT id, name FROM teams ORDER BY name")).fetchall()
        members = await (await conn.execute(
            "SELECT m.team_id, m.username, coalesce(u.display_name, '') AS display_name, u.username IS NOT NULL AS signed_in, "
            "a.updated_at AS avatar_at FROM team_members m LEFT JOIN users u USING (username) "
            "LEFT JOIN user_avatars a USING (username) ORDER BY m.username")).fetchall()
    return [{"id": team["id"], "name": team["name"],
             "members": [{"username": m["username"], "displayName": m["display_name"], "signedIn": m["signed_in"],
                          "avatarUrl": avatar_url(m["username"], m["avatar_at"])}
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


TITLE_MAX = 100
# Surrounding spaces are removed before the length is checked.
Title = Annotated[str, StringConstraints(strip_whitespace=True, max_length=TITLE_MAX)]


class NewMeeting(BaseModel):
    team_id: int
    language: str = Field(min_length=1, max_length=16)
    engine: str = Field(default="local", pattern="^(local|hybrid|mai)$")
    title: Title = ""
    series_id: int | None = None


class MeetingChange(BaseModel):
    """Either or both; series_id null takes the meeting out of its series."""
    title: Title | None = None
    series_id: int | None = None


SERIES_OF_OTHER_TEAM = "系列不屬於這個團隊"


async def series_name(conn, series_id: int | None, team_id: int) -> str | None:
    """The series' name when it belongs to the team; 422 for a series of another team (or none at all)."""
    if series_id is None:
        return None
    row = await (await conn.execute("SELECT name FROM meeting_series WHERE id = %s AND team_id = %s", (series_id, team_id))).fetchone()
    if row is None:
        raise HTTPException(status_code=422, detail=SERIES_OF_OTHER_TEAM)
    return row["name"]


@router.post("/api/meetings", status_code=201)
async def create_meeting(body: NewMeeting, user: auth.CurrentUser):
    async with db.connect() as conn:
        if not await is_member(conn, user.username, body.team_id):
            raise HTTPException(status_code=404, detail=TEAM_NOT_FOUND)
        await series_name(conn, body.series_id, body.team_id)
        row = await (await conn.execute(
            "INSERT INTO meetings (team_id, created_by, language, engine, title, series_id) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (body.team_id, user.username, body.language, body.engine, body.title.strip(), body.series_id))).fetchone()
    return {"id": str(row["id"])}


def like_pattern(keyword: str) -> str:
    """Substring pattern for ILIKE ... ESCAPE '\\': the keyword's own % _ \\ match literally."""
    return "%" + keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/api/meetings")
async def list_meetings(user: auth.CurrentUser, team: int | None = None, start: date | None = Query(None, alias="from"),
                        end: date | None = Query(None, alias="to"), creator: str = Query("", max_length=256),
                        q: str = Query("", max_length=TITLE_MAX)):
    """The user's teams' meetings, newest first; every filter applies before the 500-meeting limit."""
    where, params = [], {"user": user.username, "tz": MEETING_TIMEZONE}
    if team is not None:
        where.append("m.team_id = %(team)s")
        params["team"] = team
    if start:
        where.append("(m.started_at AT TIME ZONE %(tz)s)::date >= %(start)s")
        params["start"] = start
    if end:
        where.append("(m.started_at AT TIME ZONE %(tz)s)::date <= %(end)s")
        params["end"] = end
    if creator.strip():
        where.append("m.created_by = %(creator)s")
        params["creator"] = creator.strip().lower()
    if q.strip():
        where.append("m.title ILIKE %(q)s ESCAPE '\\'")
        params["q"] = like_pattern(q.strip())
    async with db.connect() as conn:
        if team is not None and not await is_member(conn, user.username, team):
            raise HTTPException(status_code=404, detail=TEAM_NOT_FOUND)
        rows = await (await conn.execute(
            "SELECT m.id, m.team_id, t.name AS team_name, m.started_at, m.created_by, m.language, m.engine, m.audio_bytes, m.title, "
            "m.series_id, ms.name AS series_name, "
            "count(s.seq) AS segments, count(s.seq) FILTER (WHERE s.state <> 'unreviewed') AS reviewed "
            "FROM meetings m JOIN teams t ON t.id = m.team_id "
            "JOIN team_members tm ON tm.team_id = m.team_id AND tm.username = %(user)s "
            "LEFT JOIN segments s ON s.meeting_id = m.id LEFT JOIN meeting_series ms ON ms.id = m.series_id "
            + "".join(f"{'WHERE' if i == 0 else 'AND'} {condition} " for i, condition in enumerate(where))
            + "GROUP BY m.id, t.name, ms.name ORDER BY m.started_at DESC LIMIT 500", params)).fetchall()
    return [{"id": str(row["id"]), "teamId": row["team_id"], "team": row["team_name"], "startedAt": row["started_at"].isoformat(),
             "title": row["title"], "seriesId": row["series_id"], "series": row["series_name"],
             "createdBy": row["created_by"], "language": row["language"], "engine": row["engine"],
             "durationMs": duration, "segments": row["segments"], "reviewed": row["reviewed"]}
            for row, duration in zip(rows, await asyncio.to_thread(lambda: [recorded_ms(row, repair=False) for row in rows]))]


@router.get("/api/meetings/creators")
async def meeting_creators(user: auth.CurrentUser):
    """Who created meetings in the user's own teams (for the list's creator filter)."""
    async with db.connect() as conn:
        rows = await (await conn.execute(
            "SELECT DISTINCT m.created_by, coalesce(nullif(u.display_name, ''), m.created_by) AS display_name FROM meetings m "
            "JOIN team_members tm ON tm.team_id = m.team_id AND tm.username = %s LEFT JOIN users u ON u.username = m.created_by "
            "ORDER BY m.created_by", (user.username,))).fetchall()
    return [{"username": r["created_by"], "displayName": r["display_name"]} for r in rows]


@router.patch("/api/meetings/{meeting_id}")
async def change_meeting(meeting_id: str, body: MeetingChange, user: auth.CurrentUser):
    """Any member of the meeting's team may change or clear its topic and its series."""
    async with db.connect() as conn:
        meeting = await require_member(conn, user, meeting_id)
        given = body.model_fields_set
        title = (body.title or "").strip() if "title" in given else meeting["title"]
        series_id = body.series_id if "series_id" in given else meeting["series_id"]
        name = await series_name(conn, series_id, meeting["team_id"])
        await conn.execute("UPDATE meetings SET title = %s, series_id = %s WHERE id = %s", (title, series_id, meeting["id"]))
    return {"id": str(meeting["id"]), "title": title, "seriesId": series_id, "series": name}


@router.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await require_member(conn, user, meeting_id)
        files = await (await conn.execute("SELECT kind, path, bytes FROM meeting_files WHERE meeting_id = %s ORDER BY kind",
                                          (meeting["id"],))).fetchall()
        team = await (await conn.execute("SELECT name FROM teams WHERE id = %s", (meeting["team_id"],))).fetchone()
        series = await series_name(conn, meeting["series_id"], meeting["team_id"])
        segments = await (await conn.execute(
            "SELECT seq, start_ms, end_ms, asr_text, source, live_target, target, detected, state, version, speaker, timed "
            "FROM segments WHERE meeting_id = %s ORDER BY seq", (meeting["id"],))).fetchall()
    duration = await asyncio.to_thread(recorded_ms, meeting)
    return {"id": str(meeting["id"]), "teamId": meeting["team_id"], "team": team["name"], "startedAt": meeting["started_at"].isoformat(),
            "title": meeting["title"], "seriesId": meeting["series_id"], "series": series,
            "createdBy": meeting["created_by"], "language": meeting["language"], "engine": meeting["engine"],
            "sourceLanguage": meeting["source_language"], "targetLanguage": meeting["target_language"],
            "glossary": meeting["glossary"], "learned": meeting["learned_terms"],
            "durationMs": duration, "hasRecording": duration > 0,
            "files": [{"kind": f["kind"], "name": f["path"].rsplit("/", 1)[-1], "bytes": f["bytes"]} for f in files],
            "segments": [segment_payload(row) for row in segments]}


def recorded_ms(meeting: dict, repair: bool = True) -> int:
    """Recording length; after an unclean stop audio_bytes was never written, so the file decides.

    repair=False only reads the file size (for lists); the review page repairs the header it will play."""
    if meeting["audio_bytes"]:
        return meeting["audio_bytes"] // meeting_audio.BYTES_PER_MS
    path = meeting_dir(meeting) / "audio.wav"
    if not path.exists():
        return 0
    if repair:
        return meeting_audio.duration_ms(path)
    return max(0, path.stat().st_size - meeting_audio.HEADER_BYTES) // meeting_audio.BYTES_PER_MS


def segment_payload(row: dict) -> dict:
    return {"seq": row["seq"], "startMs": row["start_ms"], "endMs": row["end_ms"], "asrText": row["asr_text"], "source": row["source"],
            "liveTarget": row["live_target"], "target": row["target"], "detected": row["detected"], "state": row["state"],
            "version": row["version"], "speaker": row.get("speaker"),
            "timed": bool(row.get("timed"))}   # times corrected from the recording (segment-audio-times)


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


# Member profile photos (member-avatars). The browser crops and scales to 160x160 before upload; the server only
# checks the type against the leading bytes and the size. SVG is never accepted (it can carry script).
AVATAR_MAX_BYTES = 256 * 1024
AVATAR_SIGNATURES = {"image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
                     "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
                     "image/webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"}


avatar_url = auth.avatar_url


async def store_avatar(username: str, request: Request, by: str) -> dict:
    """Check and store the uploaded photo for username (administrator API and /api/me/avatar alike)."""
    username = username.strip().lower()
    media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > AVATAR_MAX_BYTES:
            raise HTTPException(status_code=413, detail="照片太大，請選 256 KB 以內的圖片")
    if not body:
        raise HTTPException(status_code=422, detail="沒有收到圖片")
    if media_type not in AVATAR_SIGNATURES or not AVATAR_SIGNATURES[media_type](bytes(body[:12])):
        raise HTTPException(status_code=415, detail="只接受 PNG、JPEG 或 WebP 圖片")
    async with db.connect() as conn:
        row = await (await conn.execute(
            "INSERT INTO user_avatars (username, image, content_type, updated_by) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (username) DO UPDATE SET image = excluded.image, content_type = excluded.content_type, "
            "updated_at = now(), updated_by = excluded.updated_by RETURNING updated_at",
            (username, bytes(body), media_type, by))).fetchone()
    return {"username": username, "avatarUrl": avatar_url(username, row["updated_at"])}


async def delete_avatar(username: str) -> Response:
    async with db.connect() as conn:
        result = await conn.execute("DELETE FROM user_avatars WHERE username = %s", (username.strip().lower(),))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="這位成員沒有照片")
    return Response(status_code=204)


@router.put("/api/admin/users/{username}/avatar")
async def set_avatar(username: str, request: Request, admin: Admin):
    return await store_avatar(username, request, admin.username)


@router.delete("/api/admin/users/{username}/avatar", status_code=204)
async def remove_avatar(username: str, _admin: Admin):
    return await delete_avatar(username)


# Everyone changes their own photo (avatar-self-service); the account is always the signed-in one.
@router.put("/api/me/avatar")
async def set_my_avatar(request: Request, user: auth.CurrentUser):
    return await store_avatar(user.username, request, user.username)


@router.delete("/api/me/avatar", status_code=204)
async def remove_my_avatar(user: auth.CurrentUser):
    return await delete_avatar(user.username)


@router.get("/api/users/{username}/avatar")
async def get_avatar(username: str, _user: auth.CurrentUser):
    async with db.connect() as conn:
        row = await (await conn.execute("SELECT image, content_type FROM user_avatars WHERE username = %s",
                                        (username.strip().lower(),))).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="沒有照片")
    return Response(bytes(row["image"]), media_type=row["content_type"],
                    headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})
