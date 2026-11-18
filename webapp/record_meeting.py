"""A record of 我的紀錄 becomes a team meeting (record-to-meeting).

A 即時翻譯 record saved with its sentences becomes the meeting's segments at once. Any other record (即時口譯, or a
即時翻譯 saved before sentences were kept) is passed whole through 精準模式: the audio already exists, so every language
is recognized by the offline transcription model (Qwen3-ASR) instead of a real-time one, then segmented, repaired and
translated by 精準模式's text model as in a meeting. The meeting is created only when every part is ready, in one
transaction with its recording; a failure leaves no meeting behind. Nothing said is logged: numbers only.
"""
import asyncio
import json
import logging
import time
import wave
from array import array
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import db
import diarize
import meeting_audio
import quality_pass
import team_access

logger = logging.getLogger("uvicorn.error")

KIND_NAME = {"translate": "即時翻譯", "interpret": "即時口譯"}
ENGINES = ("local", "mai", "hybrid")
MAX_RUNNING = 2                        # conversions through 精準模式 at once, on the whole server
FAILED = "部分內容處理失敗，請再試一次"
NOT_CONFIGURED = "精準模式尚未設定，這筆紀錄目前不能轉成會議紀錄"
UNSUPPORTED = "精準模式只支援中文、英文、日文，這筆紀錄的語言不能轉成會議紀錄"
QUALITY_SOURCES = ("zh", "yue", "auto", "en", "ja", "zh_ja")
STEP = quality_pass.BYTES_PER_MS * 160   # audio fed at a time: 160 ms
SPEED = 2                                 # expected processing speed, for the estimate on the page (times real time; 2.4 measured
                                          # 2026-11-18: 98.6 s of 即時口譯 in 41.7 s, revision included)

# (username, record id) -> {"state": "running"|"failed", "doneMs", "totalMs", "error"}; a server restart forgets it.
JOBS: dict[tuple[str, str], dict] = {}
CLAIMED: set[tuple[str, str]] = set()   # records whose conversion request is being handled


class Failed(Exception):
    pass


def quality_ready() -> bool:
    """精準模式 with the transcription API: the text model and the transcription model are both set."""
    return bool(quality_pass.URL and quality_pass.MODEL and quality_pass.ASR_MODEL)


def has_sentences(data: dict) -> bool:
    return isinstance(data.get("segments"), list) and bool(data["segments"]) and data.get("kind") == "translate"   # none kept: 精準模式


def why_not(data: dict) -> str:
    """Why this record cannot become a meeting now, or ''."""
    if has_sentences(data):
        return ""
    if not quality_ready():
        return NOT_CONFIGURED
    if data.get("sourceLang") not in QUALITY_SOURCES or data.get("target") not in quality_pass.NAMES:
        return UNSUPPORTED
    return ""


SAVE_GAP_MS = 35000   # 即時翻譯 sends its sentences every 30 s: more than this uncovered at the end means the last save was lost


def missing_tail_ms(data: dict) -> int:
    """How much of the end of a record with sentences has none (its last save did not arrive), or 0."""
    if not has_sentences(data):
        return 0
    gap = round((data.get("inputSeconds") or 0) * 1000) - max(s.get("endMs", 0) for s in data["segments"])
    return gap if gap > SAVE_GAP_MS else 0


def default_title(data: dict) -> str:
    return f"{KIND_NAME.get(data.get('kind') or 'interpret', '即時口譯')} {str(data.get('startedAt', ''))[:16]}".strip()


def to_16k(pcm: bytes, rate: int) -> bytes:
    """The record's audio as a meeting keeps it: 16 kHz mono PCM16. 即時口譯's 24 kHz keeps two samples of every three."""
    if rate == meeting_audio.SAMPLE_RATE:
        return pcm
    if rate != 24000:
        raise ValueError(f"unexpected sample rate {rate}")
    samples = array("h", pcm[:len(pcm) // 6 * 6])
    out = array("h", bytes(len(samples) // 3 * 2 * 2))
    out[0::2], out[1::2] = samples[0::3], samples[1::3]
    return out.tobytes()


STAGED = ".meeting-audio.wav"   # the meeting's recording while it is being made, in the record's folder


def audio_ms(folder: Path) -> int:
    with wave.open(str(folder / "input.wav")) as audio:
        return audio.getnframes() * 1000 // audio.getframerate()


async def stage_audio(folder: Path, feed=None) -> tuple[Path, int]:
    """The record's audio written as the meeting's recording (16 kHz), one second at a time so that a recording of
    hours is never held in memory; each second also goes to `feed` (精準模式). Returns the staged file and its bytes."""
    staged = folder / STAGED
    staged.unlink(missing_ok=True)   # left by a conversion that stopped
    out = meeting_audio.MeetingAudio(staged)
    try:
        with wave.open(str(folder / "input.wav")) as audio:
            rate = audio.getframerate()
            while pcm := audio.readframes(rate):   # one second; 24 kHz stays a multiple of three samples
                pcm = to_16k(pcm, rate)
                out.write(pcm)
                if feed is not None:
                    await feed(pcm)
                else:
                    await asyncio.sleep(0)
    except BaseException:
        out.close()
        staged.unlink(missing_ok=True)
        raise
    return staged, out.close()


def mark(folder: Path, meeting_id: str) -> None:
    path = folder / "session.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["meetingId"] = meeting_id
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


async def sentences_of(folder: Path, language: str, target: str, progress) -> tuple[list[dict], Path, int]:
    """精準模式 over the whole recording, recognized by the transcription API in every language, while the recording is
    staged. Returns the sentences with their revisions applied, and the staged recording; raises Failed when any part
    failed."""
    from server import TO_TRADITIONAL   # the app's own conversion, as in a meeting (imported late: server imports this)
    kept: dict[int, dict] = {}
    failed = False

    async def collect(event: dict) -> None:
        nonlocal failed
        if "revision" in event:   # 回顧修訂: kept sentences change text, or take in the ones after them
            for change in event["revision"].get("sentences", []):
                sentence = kept.get(change.get("id"))
                if sentence is None:
                    continue
                sentence["source"], sentence["target"] = change.get("source", sentence["source"]), change.get("target", sentence["target"])
                for gone in change.get("merged", []):
                    kept.pop(gone, None)
                if "endMs" in change:
                    sentence["endMs"] = change["endMs"]
            return
        quality = event.get("quality") or {}
        if quality.get("failed"):
            failed = True
        for sentence in quality.get("sentences", []):
            kept[sentence["id"]] = sentence
        if "throughMs" in quality:
            progress(quality["throughMs"])

    qp = quality_pass.QualityPass(collect, language, target, "", TO_TRADITIONAL.convert, engine="api")

    async def feed(pcm: bytes) -> None:
        for start in range(0, len(pcm), STEP):
            qp.feed(pcm[start:start + STEP])
            # As fast as it is processed, never faster: more than MAX_WAITING parts waiting would give the oldest up.
            while len(qp.waiting) >= 2 and not qp.finished:
                await asyncio.sleep(0.02)
            await asyncio.sleep(0)
    staged = None
    try:
        staged, recorded = await stage_audio(folder, feed)
        await qp.finish()
    except BaseException:
        qp.cancel()
        if staged is not None:
            staged.unlink(missing_ok=True)
        raise
    if failed:
        staged.unlink(missing_ok=True)
        raise Failed(FAILED)
    return [kept[key] for key in sorted(kept)], staged, recorded


async def create_meeting(username: str, data: dict, team_id: int, title: str, segments: list[dict], staged: Path, recorded: int) -> str:
    """The meeting, its segments and its recording (the staged file, moved), all or nothing."""
    zone = ZoneInfo(team_access.MEETING_TIMEZONE)
    started = datetime.strptime(data["startedAt"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=zone)
    engine = data.get("engine") if data.get("engine") in ENGINES else "local"
    path = None
    try:
        async with db.connect() as conn:
            async with conn.transaction():
                row = await (await conn.execute(
                    "INSERT INTO meetings (team_id, created_by, language, engine, title, source_language, target_language, started_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (team_id, username, data.get("sourceLang") or "auto", engine, title, data.get("sourceLang") or "", data.get("target") or "",
                     started))).fetchone()
                meeting = {"id": row["id"], "team_id": team_id}
                path = team_access.meeting_dir(meeting) / "audio.wav"
                path.parent.mkdir(parents=True, exist_ok=True)
                staged.replace(path)
                await conn.execute("UPDATE meetings SET audio_bytes = %s, ended_at = %s WHERE id = %s",
                                   (recorded, started + timedelta(milliseconds=recorded // meeting_audio.BYTES_PER_MS), meeting["id"]))
                async with conn.cursor() as cursor:
                    await cursor.executemany(
                        "INSERT INTO segments (meeting_id, seq, start_ms, end_ms, asr_text, source, live_target, target, detected) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        [(meeting["id"], seq, s["startMs"], max(s["startMs"], s["endMs"]), s["source"], s["source"], s["target"], s["target"],
                          s.get("detected") or s.get("lang") or "") for seq, s in enumerate(segments, 1)])
    except BaseException:
        if path is not None:
            path.unlink(missing_ok=True)
        staged.unlink(missing_ok=True)
        raise
    await diarize.recording_closed(meeting["id"], recorded)
    return str(meeting["id"])


async def convert(username: str, folder: Path, team_id: int, title: str, job: dict | None = None) -> str:
    """The whole conversion of one record; returns the meeting's id. With 精準模式, `job` shows its progress."""
    data = json.loads((folder / "session.json").read_text(encoding="utf-8"))
    if has_sentences(data):
        segments = data["segments"]
        staged, recorded = await stage_audio(folder)
    else:
        job = job if job is not None else {}
        job["totalMs"] = await asyncio.to_thread(audio_ms, folder)
        began = time.monotonic()
        segments, staged, recorded = await sentences_of(folder, data.get("sourceLang") or "auto", data.get("target") or "en",
                                                        lambda ms: job.update(doneMs=min(ms, job["totalMs"])))
        logger.info("record to meeting: audio_ms=%d sentences=%d ms=%d", job["totalMs"], len(segments), round((time.monotonic() - began) * 1000))
    if not (folder / "session.json").is_file():   # deleted while it was being converted: no meeting
        staged.unlink(missing_ok=True)
        raise Failed("這筆紀錄已被刪除")
    meeting_id = await create_meeting(username, data, team_id, title, segments, staged, recorded)
    await asyncio.to_thread(mark, folder, meeting_id)
    return meeting_id
