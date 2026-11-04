"""After the meeting: stored segments, playback, corrections with history, and ASR training export.

Every route checks team membership through team_access.require_member (non-members get 404). A
segment's asr_text and live_target are written once; corrections go through edit/translation/confirm,
each guarded by the segment's version and appended to segment_history, which is never rewritten.
"""
import asyncio
import json
import os
import tempfile
import zipfile
from datetime import date

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

import auth
import db
import meeting_audio
import team_access

router = APIRouter()
MAX_TEXT = 10_000


@router.get("/meetings")
async def meetings_page():
    return FileResponse(auth.STATIC_DIR / "meetings.html", headers={"Cache-Control": "no-cache"})


@router.get("/meetings/{meeting_id}")
async def review_page(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        await team_access.require_member(conn, user, meeting_id)
    return FileResponse(auth.STATIC_DIR / "review.html", headers={"Cache-Control": "no-cache"})


class SegmentIn(BaseModel):
    seq: int = Field(ge=1)
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    source: str = Field(max_length=MAX_TEXT)
    target: str = Field(max_length=MAX_TEXT)
    detected: str = Field(default="", max_length=16)


class SegmentsIn(BaseModel):
    glossary: str = Field(default="", max_length=4000)
    learned: str = Field(default="", max_length=8000)
    sourceLanguage: str = Field(default="", max_length=16)
    targetLanguage: str = Field(default="", max_length=16)
    segments: list[SegmentIn] = Field(max_length=5000)


@router.put("/api/meetings/{meeting_id}/segments")
async def save_segments(meeting_id: str, body: SegmentsIn, user: auth.CurrentUser):
    """Upsert by seq from the meeting page. New segments keep their ASR text and live translation for
    good; later saves only carry refinements, and never touch a segment a reviewer has handled."""
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        await conn.execute("UPDATE meetings SET glossary = %s, learned_terms = %s, source_language = %s, target_language = %s WHERE id = %s",
                           (body.glossary, body.learned, body.sourceLanguage, body.targetLanguage, meeting["id"]))
        async with conn.cursor() as cursor:
            await cursor.executemany(
                "INSERT INTO segments (meeting_id, seq, start_ms, end_ms, asr_text, source, live_target, target, detected) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (meeting_id, seq) DO UPDATE SET target = excluded.target, version = segments.version + 1 "
                "WHERE segments.target <> excluded.target AND segments.state = 'unreviewed' AND NOT EXISTS "
                "(SELECT 1 FROM segment_history h WHERE h.meeting_id = segments.meeting_id AND h.seq = segments.seq)",
                [(meeting["id"], s.seq, s.startMs, max(s.startMs, s.endMs), s.source, s.source, s.target, s.target, s.detected)
                 for s in body.segments])
    return {"saved": len(body.segments)}


# --- Playback -------------------------------------------------------------------------------------

MAX_CLIP_MS = 10 * 60 * 1000


@router.get("/api/meetings/{meeting_id}/audio")
async def audio_range(meeting_id: str, user: auth.CurrentUser, start: int = Query(ge=0), end: int = Query(ge=0)):
    """WAV for [start, end) ms of the recording, clamped to it; only for members of the meeting's team."""
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
    path = team_access.meeting_dir(meeting) / "audio.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="這場會議沒有錄音")
    end = min(end, start + MAX_CLIP_MS)
    data = await asyncio.to_thread(meeting_audio.read_range, path, start, end)
    return Response(data, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


# --- Corrections ----------------------------------------------------------------------------------

CHANGED_BY_OTHERS = "這段已被其他人修改，已重新載入"


class EditIn(BaseModel):
    version: int
    source: str = Field(min_length=1, max_length=MAX_TEXT)


class TranslationIn(BaseModel):
    version: int
    target: str = Field(min_length=1, max_length=MAX_TEXT)
    refine: bool = False


class ConfirmIn(BaseModel):
    version: int


async def locked_segment(conn, user: auth.User, meeting_id: str, seq: int) -> dict:
    meeting = await team_access.require_member(conn, user, meeting_id)
    row = await (await conn.execute("SELECT * FROM segments WHERE meeting_id = %s AND seq = %s FOR UPDATE", (meeting["id"], seq))).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="找不到這個段落")
    return row


def stale(row: dict) -> JSONResponse:
    """409 with the segment as it is now, so the page can reload it."""
    return JSONResponse({"detail": CHANGED_BY_OTHERS, "segment": team_access.segment_payload(row)}, status_code=409)


async def record(conn, row: dict, kind: str, user: auth.User, source: str, target: str, state: str, refine: bool = False) -> dict:
    """Apply one change, bump the version and append it to the history; returns the new segment."""
    updated = await (await conn.execute(
        "UPDATE segments SET source = %s, target = %s, state = %s, version = version + 1 "
        "WHERE meeting_id = %s AND seq = %s RETURNING *", (source, target, state, row["meeting_id"], row["seq"]))).fetchone()
    await conn.execute(
        "INSERT INTO segment_history (meeting_id, seq, kind, username, source_before, source_after, target_before, target_after, refine) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (row["meeting_id"], row["seq"], kind, user.username, row["source"], source, row["target"], target, refine))
    return team_access.segment_payload(updated)


@router.post("/api/meetings/{meeting_id}/segments/{seq}/edit")
async def edit_segment(meeting_id: str, seq: int, body: EditIn, user: auth.CurrentUser):
    """Store a corrected transcript; the page then retranslates it (POST .../translation)."""
    source = body.source.strip()
    if not source:
        raise HTTPException(status_code=422, detail="原文不能是空的")
    async with db.connect() as conn:
        row = await locked_segment(conn, user, meeting_id, seq)
        if row["version"] != body.version:
            return stale(row)
        if source == row["source"]:
            return team_access.segment_payload(row)
        return await record(conn, row, "edit", user, source, row["target"], "edited")


@router.post("/api/meetings/{meeting_id}/segments/{seq}/translation")
async def store_translation(meeting_id: str, seq: int, body: TranslationIn, user: auth.CurrentUser):
    """Store a retranslation made by the review page with the live refinement strategy."""
    async with db.connect() as conn:
        row = await locked_segment(conn, user, meeting_id, seq)
        if row["version"] != body.version:
            return stale(row)
        return await record(conn, row, "retranslate", user, row["source"], body.target.strip(), row["state"], body.refine)


@router.post("/api/meetings/{meeting_id}/segments/{seq}/confirm")
async def confirm_segment(meeting_id: str, seq: int, body: ConfirmIn, user: auth.CurrentUser):
    async with db.connect() as conn:
        row = await locked_segment(conn, user, meeting_id, seq)
        if row["version"] != body.version:
            return stale(row)
        state = "edited" if row["state"] == "edited" else "confirmed"
        return await record(conn, row, "confirm", user, row["source"], row["target"], state)


@router.get("/api/meetings/{meeting_id}/segments/{seq}/history")
async def segment_history(meeting_id: str, seq: int, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        rows = await (await conn.execute(
            "SELECT h.*, coalesce(nullif(u.display_name, ''), h.username) AS display_name FROM segment_history h "
            "LEFT JOIN users u USING (username) WHERE h.meeting_id = %s AND h.seq = %s ORDER BY h.id", (meeting["id"], seq))).fetchall()
    return [{"kind": r["kind"], "username": r["username"], "displayName": r["display_name"], "at": r["at"].isoformat(),
             "sourceBefore": r["source_before"], "sourceAfter": r["source_after"], "targetBefore": r["target_before"],
             "targetAfter": r["target_after"], "refine": r["refine"]} for r in rows]


# --- ASR training export --------------------------------------------------------------------------

MEETING_TIMEZONE = os.getenv("MEETING_TIMEZONE", "Asia/Taipei")


@router.get("/api/teams/{team_id}/asr-export")
async def asr_export(team_id: int, user: auth.CurrentUser, start: date = Query(alias="from"), end: date = Query(alias="to")):
    """Zip of every confirmed or edited segment of the team's meetings started in [from, to] (local dates):
    one WAV clip per segment (its own span, no playback padding) and manifest.jsonl."""
    async with db.connect() as conn:
        if not await team_access.is_member(conn, user.username, team_id):
            raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)
        rows = await (await conn.execute(
            "SELECT s.*, m.team_id, m.engine, m.language, m.source_language, "
            "(SELECT h.username FROM segment_history h WHERE h.meeting_id = s.meeting_id AND h.seq = s.seq ORDER BY h.id DESC LIMIT 1) AS reviewed_by "
            "FROM segments s JOIN meetings m ON m.id = s.meeting_id "
            "WHERE m.team_id = %s AND (m.started_at AT TIME ZONE %s)::date BETWEEN %s AND %s AND s.state <> 'unreviewed' "
            "ORDER BY m.started_at, s.seq", (team_id, MEETING_TIMEZONE, start, end))).fetchall()
    archive = await asyncio.to_thread(build_export, rows)
    name = f"asr-export-team{team_id}-{start:%Y%m%d}-{end:%Y%m%d}.zip"
    return FileResponse(archive, media_type="application/zip", filename=name, background=BackgroundTask(os.unlink, archive))


def build_export(rows: list[dict]) -> str:
    handle, path = tempfile.mkstemp(suffix=".zip")
    os.close(handle)
    lines = []
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for row in rows:
            wav = team_access.meeting_dir({"team_id": row["team_id"], "id": row["meeting_id"]}) / "audio.wav"
            if not wav.exists():
                continue
            clip = f"clips/{row['meeting_id']}_{row['seq']:04d}.wav"
            archive.writestr(clip, meeting_audio.read_range(wav, row["start_ms"], row["end_ms"]))
            lines.append(json.dumps({
                "audio": clip, "text": row["source"], "asr_text": row["asr_text"],
                "language": row["detected"] or row["source_language"] or row["language"], "engine": row["engine"],
                "meeting_id": str(row["meeting_id"]), "seq": row["seq"], "start_ms": row["start_ms"], "end_ms": row["end_ms"],
                "edited": row["source"] != row["asr_text"], "reviewed_by": row["reviewed_by"]}, ensure_ascii=False))
        archive.writestr("manifest.jsonl", "".join(line + "\n" for line in lines))
    return path
