"""Speaker diarization after a meeting (speaker-diarization).

The diarize service (docker/diarize) runs MOSS-Transcribe-Diarize on the meeting recording and returns transcribe-cli's
output: speaker turns with their own text. Each stored segment gets the speaker whose turn text matches it best
(segment times trail speech by the engine's delay, the text does not), else the speaker overlapping its time span.

One diarization runs at a time; queued ones wait in the diarizations table, so a restart loses nothing. A finished
run replaces the meeting's speakers, names and manual choices: its S1, S2 need not be the previous run's.
"""
import asyncio
import contextlib
import logging
import math
import os
import re
from difflib import SequenceMatcher
from typing import NamedTuple

import httpx
from fastapi import APIRouter, HTTPException
from opencc import OpenCC
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

import auth
import db
import meeting_audio
import team_access

router = APIRouter()
logger = logging.getLogger("uvicorn.error")
DIARIZE_URL = os.getenv("DIARIZE_URL", "").rstrip("/")
SERVICE_TIMEOUT = 4 * 3600          # transcribe.cpp takes up to ~1.1x the recording on CPU and accepts ~2.9 h of audio
MIN_RECORDING_BYTES = 10 * 32000    # 10 s of 16 kHz PCM16
# Segment labelling (see the design): turns from WINDOW_BEFORE before a segment to WINDOW_AFTER after it are aligned
# with its text; a match needs MIN_SHARE of its characters (and MIN_CHARS). Otherwise its span, moved LAG_MS earlier
# (segments are stamped when text appears, after the speech), is compared with the turns.
WINDOW_BEFORE_MS, WINDOW_AFTER_MS, MIN_SHARE, MIN_CHARS, LAG_MS = 12_000, 3_000, 0.3, 2, 1_000
# Segment times from the turns (segment-audio-times): a segment is corrected when RETIME_SHARE of its characters are
# found in the turns near it, and then lasts RETIME_MIN_MS at least. Matched runs count outward from the longest one,
# while the turn text between two runs is not longer than the segment's own text between them by more than
# RETIME_GAP characters (or RETIME_GAP_SHARE of the segment): the two recognizers word things differently, and the
# same words in the next sentence must not stretch the segment over it.
RETIME_SHARE, RETIME_MIN_MS, RETIME_GAP, RETIME_GAP_SHARE = 0.5, 200, 4, 0.25
MAX_NAME = 40
NOT_CONFIGURED, RUNNING, NO_RECORDING = "說話者辨識未設定", "說話者辨識已在排隊或進行中", "這場會議沒有錄音"
STILL_RECORDING = "會議還在錄音，結束後會自動辨識說話者"
INTERRUPTED, STUCK = "app 重新啟動，已重新排入", "辨識超過時限沒有結果"
TURN_LINE = re.compile(r"^\s*\[\s*(\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?)\]\s*S(\d+):[ \t]?(.*)$", re.MULTILINE)
TO_TRADITIONAL = OpenCC("s2tw")
_wake: asyncio.Event | None = None   # created by the worker, on its own event loop


class Turn(NamedTuple):
    start_ms: int
    end_ms: int
    label: int
    text: str


def configured() -> bool:
    return bool(DIARIZE_URL)


def parse_output(text: str) -> list[Turn]:
    """transcribe-cli's segment rows `[  6.45 ->    7.31] S1: 文字`; labels renumbered 1..n by first appearance."""
    labels: dict[str, int] = {}
    turns = []
    for start, end, speaker, words in TURN_LINE.findall(text):
        label = labels.setdefault(speaker, len(labels) + 1)
        turns.append(Turn(round(float(start) * 1000), round(float(end) * 1000), label, words.strip()))
    return turns


def normalize(text: str) -> str:
    """Traditional script, lower case, letters and digits only (CJK characters count as letters)."""
    return "".join(ch for ch in TO_TRADITIONAL.convert(text).lower() if ch.isalnum())


def speaker_of(start_ms: int, end_ms: int, source: str, turns: list[Turn]) -> int | None:
    text = normalize(source)
    near = [t for t in turns if t.end_ms >= start_ms - WINDOW_BEFORE_MS and t.start_ms <= end_ms + WINDOW_AFTER_MS]
    if text and near:
        pool, owners = "", []
        for turn in near:
            words = normalize(turn.text)
            pool += words
            owners += [turn.label] * len(words)
        counts: dict[int, int] = {}
        for a, b, size in SequenceMatcher(None, text, pool, autojunk=False).get_matching_blocks():
            for k in range(size):
                counts[owners[b + k]] = counts.get(owners[b + k], 0) + 1
        if sum(counts.values()) >= max(MIN_CHARS, math.ceil(MIN_SHARE * len(text))):
            return max(counts, key=lambda label: (counts[label], -label))
    start, end = start_ms - LAG_MS, end_ms - LAG_MS
    overlap: dict[int, int] = {}
    for turn in turns:
        shared = min(end, turn.end_ms) - max(start, turn.start_ms)
        if shared > 0:
            overlap[turn.label] = overlap.get(turn.label, 0) + shared
    return max(overlap, key=lambda label: (overlap[label], -label)) if overlap else None


def assign(segments: list[dict], turns: list[Turn]) -> dict[int, int | None]:
    """{seq: label or None} for segments with seq, start_ms, end_ms and source."""
    return {s["seq"]: speaker_of(s["start_ms"], s["end_ms"], s["source"], turns) for s in segments}


def retime(segments: list[dict], turns: list[Turn], duration_ms: int | None = None) -> dict[int, tuple[int, int]]:
    """{seq: (start_ms, end_ms)} for the segments (seq, start_ms, end_ms, source) whose text is found in the turns.

    The meeting page's times are estimates (the quality pass divides a chunk among its sentences by their length; the
    live engine stamps text when it appears). A turn has the times of the speech itself, so each of its characters gets
    a time by its position in the turn, and a segment starts at its first matched character and ends at its last.
    Segments that do not match are left out: they keep their times."""
    spoken, at = [], 0   # (turn, its characters, the number of characters said before it)
    for turn in turns:
        words = normalize(turn.text)
        spoken.append((turn, words, at))
        at += len(words)
    result: dict[int, tuple[int, int]] = {}
    last_start, used = 0, -1   # used: the last character a corrected segment took; what was said up to it is not matched
    for segment in sorted(segments, key=lambda s: s["seq"]):   # again, so a phrase said twice is not taken for its first time
        text = normalize(segment["source"])
        if not text:
            continue
        pool, starts, ends, places = "", [], [], []
        for turn, words, before in spoken:
            if not words or turn.end_ms < segment["start_ms"] - WINDOW_BEFORE_MS or turn.start_ms > segment["end_ms"] + WINDOW_AFTER_MS:
                continue
            span = turn.end_ms - turn.start_ms
            for k in range(max(0, used + 1 - before), len(words)):
                pool += words[k]
                starts.append(turn.start_ms + span * k / len(words))
                ends.append(turn.start_ms + span * (k + 1) / len(words))
                places.append(before + k)
        blocks = together([block for block in SequenceMatcher(None, text, pool, autojunk=False).get_matching_blocks() if block.size], len(text))
        if sum(block.size for block in blocks) < max(MIN_CHARS, math.ceil(RETIME_SHARE * len(text))):
            continue
        solid = [block for block in blocks if block.size >= 2] or blocks   # a stray single character must not stretch the span
        first, last = solid[0].b, solid[-1].b + solid[-1].size - 1
        start, end = round(starts[first]), max(round(ends[last]), round(starts[first]) + RETIME_MIN_MS)
        if duration_ms:
            end = min(end, duration_ms)
            start = min(start, max(0, end - RETIME_MIN_MS))
        if start < last_start:
            continue
        result[segment["seq"]] = (start, end)
        last_start, used = start, places[last]
    return result


def together(blocks: list, length: int) -> list:
    """The matched runs that belong to one stretch of speech: the longest, and its neighbours on either side for as long
    as the turn text skipped to reach the next one is about what the segment's own text skips there."""
    if not blocks:
        return []
    allowed = max(RETIME_GAP, math.ceil(RETIME_GAP_SHARE * length))
    centre = max(range(len(blocks)), key=lambda i: (blocks[i].size, -i))
    low = high = centre
    while low > 0 and (blocks[low].b - blocks[low - 1].b - blocks[low - 1].size) - (blocks[low].a - blocks[low - 1].a - blocks[low - 1].size) <= allowed:
        low -= 1
    while high < len(blocks) - 1 and (blocks[high + 1].b - blocks[high].b - blocks[high].size) - (blocks[high + 1].a - blocks[high].a - blocks[high].size) <= allowed:
        high += 1
    return blocks[low:high + 1]


async def retime_segments(conn, meeting_id, turns: list[Turn]) -> int:
    """Correct the meeting's segment times from `turns`; returns how many segments were corrected. Only start_ms, end_ms
    and timed change: not the version (times are not what a reviewer edits), text, state or speaker."""
    segments = await (await conn.execute(
        "SELECT seq, start_ms, end_ms, source FROM segments WHERE meeting_id = %s", (meeting_id,))).fetchall()
    meeting = await (await conn.execute("SELECT audio_bytes FROM meetings WHERE id = %s", (meeting_id,))).fetchone()
    duration = (meeting["audio_bytes"] or 0) // meeting_audio.BYTES_PER_MS if meeting else 0
    times = await asyncio.to_thread(retime, segments, turns, duration or None)   # text alignment is CPU work
    if times:
        async with conn.cursor() as cursor:
            await cursor.executemany("UPDATE segments SET start_ms = %s, end_ms = %s, timed = true WHERE meeting_id = %s AND seq = %s",
                                     [(start, end, meeting_id, seq) for seq, (start, end) in times.items()])
    return len(times)


async def retime_stored(meeting_id: str | None = None) -> dict[str, int]:
    """`python -m diarize retime [meeting_id]`: correct the segment times of meetings diarized before this existed
    (all of them without an id). Returns {meeting id: segments corrected, or -1 when it failed}."""
    done: dict[str, int] = {}
    async with db.connect() as conn:
        rows = await (await conn.execute(
            "SELECT meeting_id, turns FROM diarizations WHERE status = 'done' AND (%s::uuid IS NULL OR meeting_id = %s::uuid) ORDER BY queued_at",
            (meeting_id, meeting_id))).fetchall()
    for row in rows:   # one meeting at a time: a failure undoes that meeting only, and no rows stay locked for the whole run
        try:
            async with db.connect() as conn:
                done[str(row["meeting_id"])] = await retime_segments(conn, row["meeting_id"], [Turn(*t) for t in row["turns"]])
        except Exception as error:
            logger.warning("segment times of %s were not corrected: %s", row["meeting_id"], type(error).__name__)
            done[str(row["meeting_id"])] = -1
    return done


def service_language(meeting: dict) -> str:
    language = meeting.get("source_language") or meeting.get("language") or ""
    return language if language in ("zh", "en") else ""


# --- Queue -----------------------------------------------------------------------------------------

async def enqueue(conn, meeting_id, requested_by: str | None) -> bool:
    """Queue a diarization unless one is queued or running; False when refused."""
    row = await (await conn.execute(
        "INSERT INTO diarizations (meeting_id, status, requested_by) VALUES (%s, 'queued', %s) "
        "ON CONFLICT (meeting_id) DO UPDATE SET status = 'queued', message = '', requested_by = excluded.requested_by, "
        "queued_at = now(), started_at = NULL, finished_at = NULL WHERE diarizations.status NOT IN ('queued', 'running') "
        "RETURNING meeting_id", (meeting_id, requested_by))).fetchone()
    if row and _wake:
        _wake.set()
    return row is not None


async def recording_closed(meeting_id, recorded_bytes: int) -> None:
    """Called when a meeting's recording closes: queue it when it is long enough. Never raises."""
    if not configured() or recorded_bytes < MIN_RECORDING_BYTES:
        return
    try:
        async with db.connect() as conn:
            await enqueue(conn, meeting_id, None)
    except Exception:
        logger.exception("could not queue diarization for %s", meeting_id)


async def call_service(file: str, language: str) -> str:
    async with httpx.AsyncClient(timeout=SERVICE_TIMEOUT) as client:
        response = await client.post(f"{DIARIZE_URL}/diarize", json={"file": file, "language": language})
    if response.status_code != 200:
        try:
            detail = response.json().get("error") or response.text
        except ValueError:
            detail = response.text
        raise RuntimeError(f"辨識服務回應 {response.status_code}：{str(detail).strip()[-160:]}")
    return response.json()["output"]


async def store_result(conn, meeting_id, turns: list[Turn], seconds: float) -> None:
    """Replace the meeting's speakers with this run's and label every segment."""
    segments = await (await conn.execute(
        "SELECT seq, start_ms, end_ms, source FROM segments WHERE meeting_id = %s", (meeting_id,))).fetchall()
    labels = await asyncio.to_thread(assign, segments, turns)   # text alignment is CPU work: keep the event loop free
    await conn.execute("UPDATE segments SET speaker = NULL, speaker_manual = false WHERE meeting_id = %s", (meeting_id,))
    await conn.execute("DELETE FROM meeting_speakers WHERE meeting_id = %s", (meeting_id,))
    async with conn.cursor() as cursor:
        await cursor.executemany("INSERT INTO meeting_speakers (meeting_id, label) VALUES (%s, %s)",
                                 [(meeting_id, label) for label in sorted({t.label for t in turns})])
        await cursor.executemany("UPDATE segments SET speaker = %s WHERE meeting_id = %s AND seq = %s",
                                 [(label, meeting_id, seq) for seq, label in labels.items() if label is not None])
    await conn.execute(
        "UPDATE diarizations SET status = 'done', message = '', turns = %s, finished_at = now(), seconds = %s WHERE meeting_id = %s",
        (Jsonb([list(t) for t in turns]), seconds, meeting_id))
    try:   # the speakers are stored whatever happens here: wrong times are a lesser fault than no speakers
        async with conn.transaction():
            await retime_segments(conn, meeting_id, turns)
    except Exception as error:
        logger.warning("segment times of %s were not corrected: %s", meeting_id, type(error).__name__)


async def run_next() -> bool:
    """Claim the oldest queued diarization and run it to done or failed; False when none is queued."""
    async with db.connect() as conn:
        job = await (await conn.execute(
            "UPDATE diarizations SET status = 'running', started_at = now() WHERE meeting_id = "
            "(SELECT meeting_id FROM diarizations WHERE status = 'queued' ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING meeting_id")).fetchone()
        meeting = job and await (await conn.execute("SELECT * FROM meetings WHERE id = %s", (job["meeting_id"],))).fetchone()
    if not job:
        return False
    meeting_id = job["meeting_id"]
    try:
        file = f"teams/{meeting['team_id']}/{meeting['id']}/audio.wav"
        started = asyncio.get_running_loop().time()
        turns = parse_output(await call_service(file, service_language(meeting)))
        if not turns:
            raise RuntimeError("沒有辨識到任何說話")
        async with db.connect() as conn:
            await store_result(conn, meeting_id, turns, round(asyncio.get_running_loop().time() - started, 1))
        logger.info("diarized %s: %d turns, %d speakers", meeting_id, len(turns), len({t.label for t in turns}))
    except Exception as exc:  # the job must always end with a final status; segments and speakers stay as they were
        logger.exception("diarization failed for %s", meeting_id)
        detail = str(exc) if isinstance(exc, RuntimeError) else f"{type(exc).__name__}: {exc}"
        async with db.connect() as conn:
            await conn.execute("UPDATE diarizations SET status = 'failed', message = %s, finished_at = now() WHERE meeting_id = %s",
                               (f"辨識失敗（{detail[:200]}）", meeting_id))
    return True


async def recover() -> None:
    """A restart puts a running diarization back in the queue (the service call was lost with the old process)."""
    async with db.connect() as conn:
        await conn.execute("UPDATE diarizations SET status = 'queued', message = %s, started_at = NULL WHERE status = 'running'",
                           (INTERRUPTED,))


async def expire_stuck() -> None:
    """A run whose result could not be recorded (e.g. the database was briefly down) would stay running forever."""
    async with db.connect() as conn:
        await conn.execute("UPDATE diarizations SET status = 'failed', message = %s, finished_at = now() "
                           "WHERE status = 'running' AND started_at < now() - make_interval(secs => %s)", (STUCK, SERVICE_TIMEOUT + 600))


async def worker() -> None:
    """Run queued diarizations one at a time for as long as the app runs."""
    global _wake
    _wake = asyncio.Event()
    await recover()
    while True:
        try:
            await expire_stuck()
            if await run_next():
                continue
        except Exception:   # e.g. the database is briefly unreachable; try again later
            logger.exception("diarization worker")
        _wake.clear()
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(_wake.wait(), timeout=30)


async def label_new_segments(conn, meeting_id) -> None:
    """After segments are stored: label the unlabelled ones (not chosen by hand) from a finished diarization."""
    done = await (await conn.execute("SELECT turns FROM diarizations WHERE meeting_id = %s AND status = 'done'", (meeting_id,))).fetchone()
    if not done:
        return
    segments = await (await conn.execute(
        "SELECT seq, start_ms, end_ms, source FROM segments WHERE meeting_id = %s AND speaker IS NULL AND NOT speaker_manual",
        (meeting_id,))).fetchall()
    turns = [Turn(*t) for t in done["turns"]]
    labels = {seq: label for seq, label in (await asyncio.to_thread(assign, segments, turns)).items() if label is not None}
    if labels:
        async with conn.cursor() as cursor:
            await cursor.executemany("UPDATE segments SET speaker = %s WHERE meeting_id = %s AND seq = %s AND speaker IS NULL",
                                     [(label, meeting_id, seq) for seq, label in labels.items()])


# How a speaker is shown, everywhere (review page and minutes): its name, else the member's display name or account,
# else 說話者 N. Needs meeting_speakers s and users u joined on s.username.
SHOWN = "coalesce(nullif(s.name, ''), nullif(u.display_name, ''), s.username, '說話者 ' || s.label)"
SEGMENTS_WITH_SPEAKERS = (
    f"SELECT g.seq, g.source, CASE WHEN g.speaker IS NULL THEN '' ELSE {SHOWN} END AS speaker "
    "FROM segments g LEFT JOIN meeting_speakers s ON s.meeting_id = g.meeting_id AND s.label = g.speaker "
    "LEFT JOIN users u ON u.username = s.username WHERE g.meeting_id = %s ORDER BY g.seq")


# --- API -------------------------------------------------------------------------------------------

async def stored_turns(conn, meeting_id) -> list[Turn]:
    """The turns of the last finished diarization (kept while a new one is queued or running)."""
    row = await (await conn.execute("SELECT turns FROM diarizations WHERE meeting_id = %s", (meeting_id,))).fetchone()
    return [Turn(*t) for t in row["turns"]] if row else []


def timeline_turns(turns: list[Turn]) -> list[list]:
    """Turns for the page's timeline: [start_ms, end_ms, label, text], Chinese in Traditional script."""
    return [[t.start_ms, t.end_ms, t.label, TO_TRADITIONAL.convert(t.text)] for t in turns]


async def speakers_payload(conn, meeting_id, turns: list[Turn] | None = None) -> list[dict]:
    turns = await stored_turns(conn, meeting_id) if turns is None else turns
    talk: dict[int, int] = {}
    for t in turns:
        talk[t.label] = talk.get(t.label, 0) + t.end_ms - t.start_ms
    rows = await (await conn.execute(
        f"SELECT s.label, s.name, s.username, s.note, {SHOWN} AS shown, "
        "count(g.seq) AS segments, coalesce(sum(g.end_ms - g.start_ms), 0) AS ms FROM meeting_speakers s "
        "LEFT JOIN users u ON u.username = s.username "
        "LEFT JOIN segments g ON g.meeting_id = s.meeting_id AND g.speaker = s.label "
        "WHERE s.meeting_id = %s GROUP BY s.label, s.name, s.username, s.note, u.display_name ORDER BY s.label", (meeting_id,))).fetchall()
    return [{"label": r["label"], "name": r["name"], "username": r["username"], "shown": r["shown"], "note": r["note"],
             "segments": r["segments"], "ms": int(r["ms"]), "turnMs": talk.get(r["label"], 0)} for r in rows]


@router.get("/api/meetings/{meeting_id}/speakers")
async def get_speakers(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        job = await (await conn.execute("SELECT * FROM diarizations WHERE meeting_id = %s", (meeting["id"],))).fetchone()
        turns = [Turn(*t) for t in job["turns"]] if job else []
        speakers = await speakers_payload(conn, meeting["id"], turns)
        members = await (await conn.execute(
            "SELECT m.username, coalesce(nullif(u.display_name, ''), m.username) AS display_name FROM team_members m "
            "LEFT JOIN users u USING (username) WHERE m.team_id = %s ORDER BY m.username", (meeting["team_id"],))).fetchall()
    stamp = lambda value: value.isoformat() if value else None
    return {"configured": configured(), "status": job["status"] if job else "none", "message": job["message"] if job else "",
            "queuedAt": stamp(job and job["queued_at"]), "startedAt": stamp(job and job["started_at"]),
            "finishedAt": stamp(job and job["finished_at"]), "speakers": speakers,
            "turns": timeline_turns(turns), "durationMs": await asyncio.to_thread(team_access.recorded_ms, meeting, False),
            "members": [{"username": m["username"], "displayName": m["display_name"]} for m in members]}


@router.post("/api/meetings/{meeting_id}/speakers/run", status_code=202)
async def run(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        if not configured():
            raise HTTPException(status_code=400, detail=NOT_CONFIGURED)
        if not await asyncio.to_thread(team_access.recorded_ms, meeting, False):
            raise HTTPException(status_code=422, detail=NO_RECORDING)
        # A run now would cover part of the meeting and block the full run queued when the recording closes.
        if meeting_audio.is_recording(team_access.meeting_dir(meeting) / "audio.wav"):
            raise HTTPException(status_code=409, detail=STILL_RECORDING)
        if not await enqueue(conn, meeting["id"], user.username):
            raise HTTPException(status_code=409, detail=RUNNING)
    return {"status": "queued"}


class SpeakerIn(BaseModel):
    name: str = Field(default="", max_length=MAX_NAME)
    username: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=MAX_NAME)   # role, e.g. 主持人; None leaves it as it is


@router.put("/api/meetings/{meeting_id}/speakers/{label}")
async def name_speaker(meeting_id: str, label: int, body: SpeakerIn, user: auth.CurrentUser):
    """Name a speaker as a team member (username) or with free text (name); both empty clears the name. note: its role."""
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        username = (body.username or "").strip().lower() or None
        if username and not await team_access.is_member(conn, username, meeting["team_id"]):
            raise HTTPException(status_code=422, detail="只能指定為這個團隊的成員")
        updated = await (await conn.execute(
            "UPDATE meeting_speakers SET name = %s, username = %s, note = coalesce(%s, note) WHERE meeting_id = %s AND label = %s RETURNING label",
            ("" if username else body.name.strip(), username, None if body.note is None else body.note.strip(), meeting["id"], label))).fetchone()
        if not updated:
            raise HTTPException(status_code=404, detail="沒有這位說話者")
        return next(s for s in await speakers_payload(conn, meeting["id"]) if s["label"] == label)


@router.post("/api/meetings/{meeting_id}/speakers", status_code=201)
async def add_speaker(meeting_id: str, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(meeting["id"]),))
        row = await (await conn.execute(
            "INSERT INTO meeting_speakers (meeting_id, label) SELECT %s, coalesce(max(label), 0) + 1 FROM meeting_speakers "
            "WHERE meeting_id = %s RETURNING label", (meeting["id"], meeting["id"]))).fetchone()
        return next(s for s in await speakers_payload(conn, meeting["id"]) if s["label"] == row["label"])


class SegmentSpeakerIn(BaseModel):
    label: int | None = Field(default=None, ge=1)


@router.put("/api/meetings/{meeting_id}/segments/{seq}/speaker")
async def set_segment_speaker(meeting_id: str, seq: int, body: SegmentSpeakerIn, user: auth.CurrentUser):
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        if body.label is not None and not await (await conn.execute(
                "SELECT 1 FROM meeting_speakers WHERE meeting_id = %s AND label = %s", (meeting["id"], body.label))).fetchone():
            raise HTTPException(status_code=422, detail="沒有這位說話者")
        row = await (await conn.execute(
            "UPDATE segments SET speaker = %s, speaker_manual = true WHERE meeting_id = %s AND seq = %s RETURNING *",
            (body.label, meeting["id"], seq))).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="沒有這個段落")
    return team_access.segment_payload(row)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2 or sys.argv[1] != "retime" or len(sys.argv) > 3:
        sys.exit("usage: python -m diarize retime [meeting_id]")
    for meeting, count in asyncio.run(retime_stored(sys.argv[2] if len(sys.argv) == 3 else None)).items():
        print(f"{meeting}: {count} segments corrected" if count >= 0 else f"{meeting}: failed, nothing changed")
