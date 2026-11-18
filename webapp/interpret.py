"""即時口譯 (realtime-interpret): Azure GPT-Realtime-Translate for system administrators.

The page sends 24 kHz speech here; this module forwards it to Azure's translations endpoint with the key kept on
the server and sends the translated speech and text back. The source text comes from 語橋's own recognition: the
page opens /ws/transcribe in translate mode on its own and hands over the changes to the settled text as
{"type": "source", "keep": n, "text": rest}. The audio is written to disk as it arrives (a working folder starting
with "."); when a session ends the folder becomes output/interpret/<user>/<id>/ and the seconds of translated
speech are added to interpret_usage.
"""
import asyncio
import base64
import contextlib
import hashlib
import json
import logging
import math
import os
import re
import secrets
import shutil
import sys
import time
import wave
from array import array
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import websockets
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from opencc import OpenCC
from pydantic import BaseModel, Field, StrictInt, model_validator
from starlette.websockets import WebSocketState

import auth
import db
import interpret_usage
import record_meeting
import stream_limits
import team_access

logger = logging.getLogger("uvicorn.error")
router = APIRouter()

ENDPOINT = os.getenv("AZURE_gpt_realtime_translate_ENDPOINT", "").strip().rstrip("/")
KEY = os.getenv("AZURE_gpt_realtime_translate_KEY", "").strip()
DEPLOYMENT = os.getenv("AZURE_gpt_realtime_translate_DEPLOYMENT", "").strip() or "gpt-realtime-translate"
# Optional: a gpt-realtime-whisper deployment for Azure's own source transcript (not used by the page today).
TRANSCRIBE = os.getenv("AZURE_gpt_realtime_translate_TRANSCRIBE_DEPLOYMENT", "").strip()

# The output languages the model accepts (its error message lists exactly these; zh-TW is refused).
TARGETS = ("af", "ar", "az", "be", "bg", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "fa", "fi", "fr", "gl",
           "he", "hi", "hr", "hu", "hy", "id", "is", "it", "iw", "ja", "kk", "kn", "ko", "lt", "lv", "mi", "mk", "mr", "ms",
           "ne", "nl", "no", "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "sw", "ta", "th", "tl", "tr", "uk", "ur", "vi", "zh")
SOURCE_LANGUAGES = frozenset({"zh", "auto", "yue", "en", "ja", "ko", "vi", "th", "id", "ms", "fr", "de", "es", "pt", "it", "ru",
                              "ar", "hi", "tr", "nl", "pl"})
LOCAL_SOURCES = frozenset({"zh", "auto", "yue"})   # recognized by the local Confucius engine; the rest by MAI
RATE = 24000
BYTES_PER_SECOND = RATE * 2
NOT_CONFIGURED = "即時口譯尚未設定"                         # close reason (4503) the page reads
NO_ACCESS = "即時口譯需要申請權限，請聯絡系統管理員"         # close reason (4403) for a user not granted
UNREACHABLE = "連不上翻譯服務，請稍後再試。"                 # error event when the translation service cannot be reached
USERNAME = re.compile(r"[a-z0-9_][a-z0-9._-]{0,63}")         # an account that may be granted interpreting
MAX_TEXT = 200000           # characters of source or translation kept for a record
FLUSH_SECONDS = 8          # after session.close: how long the rest of the translation may take
SESSION_ID = re.compile(r"\d{8}-\d{6}(-\d+)?")
FILES = ("input.wav", "output.wav", "transcript.txt")


class _Taiwan(OpenCC):
    """The model writes Simplified Chinese in mainland wording; s2twp gives Taiwan characters and words (软件 → 軟體).
    The meeting translator writes Taiwanese wording itself and uses characters only (server.TO_TRADITIONAL)."""
    MISREAD_LIAO = re.compile(r"([說證表聲發查講標註])明瞭")

    def convert(self, text: str) -> str:
        return self.MISREAD_LIAO.sub(r"\1明了", super().convert(text))


TO_TAIWAN = _Taiwan("s2twp")


def configured() -> bool:
    return bool(ENDPOINT and KEY)


async def allowed(user: auth.User) -> bool:
    """Interpreting is for system administrators and the accounts they grant (interpret-mode-on-home)."""
    if user.admin:
        return True
    async with db.connect() as conn:
        row = await (await conn.execute("SELECT 1 FROM interpret_access WHERE username = %s", (user.username,))).fetchone()
    return row is not None


def azure_url() -> str:
    parts = urlsplit(ENDPOINT if "://" in ENDPOINT else f"https://{ENDPOINT}")
    return f"wss://{parts.netloc}/openai/v1/realtime/translations?model={DEPLOYMENT}"


def user_dir(username: str) -> Path:
    """The owner's folder, from the signed-in name only; a name unfit for a path gets a stable hashed folder."""
    name = username if re.fullmatch(r"[a-z0-9_-][a-z0-9._-]{0,63}", username) else "u-" + hashlib.sha256(username.encode()).hexdigest()[:16]
    return team_access.OUTPUT_DIR / "interpret" / name


def session_dir(user: auth.User, sid: str) -> Path:
    folder = user_dir(user.username) / sid
    if not SESSION_ID.fullmatch(sid) or not (folder / "session.json").is_file():
        raise HTTPException(status_code=404, detail="找不到這筆紀錄")
    return folder


BAR = RATE // 10   # samples per waveform value (0.1 second)


def rms(pcm: bytes) -> float:
    """Root mean square of 16-bit little-endian samples, 0 to 1."""
    samples = array("h", pcm[: len(pcm) // 2 * 2])
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        return 0.0
    return round(min(1.0, math.sqrt(sum(s * s for s in samples) / len(samples)) / 32767), 4)


def bars_of(input_pcm_blocks, output_pcm_blocks) -> dict:
    """The waveform of a session saved without bars.json, read from its WAV files a block at a time."""
    output = [[round(i * BAR / RATE, 1), v] for i, block in enumerate(output_pcm_blocks) if (v := rms(block)) > 0]
    return {"step": 0.1, "input": [rms(block) for block in input_pcm_blocks], "output": output}


def wav_blocks(path: Path):
    with wave.open(str(path), "rb") as source:
        while block := source.readframes(source.getframerate() // 10):
            yield block


class Recording:
    """One session on its own clock (from 已連線), written to disk as it arrives: the audio sent, the translated pieces
    each at the time it arrived, the waveform values and the texts. Only counts and waveform values stay in memory."""

    def __init__(self, folder_of_user: Path, meta: dict, rate: int = RATE, output: bool = True):
        """`rate` and `output`: 24 kHz with translated audio for 即時口譯; a 即時翻譯 record (live-translation) is the
        16 kHz audio sent to recognition, with no output.wav."""
        self.rate, self.bar, self.with_output = rate, rate // 10, output
        self.started = datetime.now(ZoneInfo(team_access.MEETING_TIMEZONE))
        self.meta, self.t0 = {"startedAt": self.started.strftime("%Y-%m-%d %H:%M:%S")} | meta, time.monotonic()
        self.folder_of_user, self.folder, self.writers = folder_of_user, None, {}
        self.input_bytes = self.output_bytes = 0
        self.end = 0                       # samples written to output.wav
        self.rest = b""                    # input not yet a whole 0.1 second, for the waveform
        self.input_bars: list[float] = []
        self.output_bars: list[list[float]] = []
        self.translation: list[str] = []
        self.source = ""
        self.segments: list[dict] | None = None   # 即時翻譯's finished sentences (record-to-meeting), from the page

    def clock(self) -> float:
        return time.monotonic() - self.t0

    @property
    def input_seconds(self) -> float:
        return self.input_bytes / (2 * self.rate)

    @property
    def output_seconds(self) -> float:
        return self.output_bytes / BYTES_PER_SECOND

    def _open(self) -> None:
        if self.folder is not None:
            return
        self.folder_of_user.mkdir(parents=True, exist_ok=True)
        self.folder = self.folder_of_user / f".recording-{self.started.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(4)}"
        self.folder.mkdir()
        for name in ("input.wav", "output.wav") if self.with_output else ("input.wav",):
            file = open(self.folder / name, "wb", buffering=0)   # unbuffered: on disk as it arrives
            out = wave.open(file, "wb")
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(self.rate)
            self.writers[name] = (out, file)

    def add_input(self, pcm: bytes) -> None:
        self._open()
        self.writers["input.wav"][0].writeframes(pcm)
        self.input_bytes += len(pcm)
        data = self.rest + pcm
        whole = len(data) // (2 * self.bar) * (2 * self.bar)
        self.input_bars += [rms(data[i:i + 2 * self.bar]) for i in range(0, whole, 2 * self.bar)]
        self.rest = data[whole:]

    def add_piece(self, arrived: float, pcm: bytes) -> None:
        """Each piece at the time it arrived, never over the previous one, silence between."""
        self._open()
        out = self.writers["output.wav"][0]
        start = max(int(round(arrived * RATE)), self.end)
        gap = start - self.end
        while gap > 0:
            step = min(gap, RATE)
            out.writeframes(bytes(2 * step))
            gap -= step
        out.writeframes(pcm)
        self.output_bars += [[round((start + i) / RATE, 1), v] for i in range(0, len(pcm) // 2, BAR)
                             if (v := rms(pcm[2 * i:2 * (i + BAR)])) > 0]   # silence is not drawn
        self.output_bytes += len(pcm)
        self.end = start + len(pcm) // 2

    def close(self) -> None:
        for out, file in self.writers.values():
            out.close()
            file.close()
        self.writers = {}

    def discard(self) -> None:
        self.close()
        if self.folder is not None:
            shutil.rmtree(self.folder, ignore_errors=True)

    def save(self, usd: float) -> str | None:
        if not self.input_bytes and not self.output_bytes:
            self.discard()
            return None
        self.close()
        if self.rest:
            self.input_bars.append(rms(self.rest))
        base = self.started.strftime("%Y%m%d-%H%M%S")   # the id is the start time, as startedAt
        sid, n = base, 1
        while (self.folder_of_user / sid).exists():
            n += 1
            sid = f"{base}-{n}"
        data = self.meta | {"id": sid, "inputSeconds": round(self.input_seconds, 1),
                            "outputSeconds": round(self.output_seconds, 1), "sourceText": self.source,
                            "translation": "".join(self.translation), "usd": usd}
        if self.segments is not None:
            data["segments"] = self.segments
        (self.folder / "bars.json").write_text(json.dumps({"step": 0.1, "input": self.input_bars, "output": self.output_bars}), encoding="utf-8")
        (self.folder / "transcript.txt").write_text(f"原文：\n{self.source}\n\n譯文（{data['target']}）：\n{data['translation']}\n", encoding="utf-8")
        (self.folder / "session.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        self.folder.rename(self.folder_of_user / sid)
        return sid


LIVE: dict[str, tuple[str, "Recording"]] = {}   # token -> (owner, the 即時翻譯 record being written)


def live_open(username: str, rec: Recording) -> str:
    token = secrets.token_hex(8)
    LIVE[token] = (username, rec)
    return token


def live_close(token: str) -> None:
    LIVE.pop(token, None)


MAX_SEGMENTS = 5000          # sentences kept for a record (record-to-meeting)
MAX_SEGMENT_TEXT = 2000


class Sentence(BaseModel):
    """One finished sentence of a 即時翻譯 session, on the record's audio timeline (milliseconds)."""
    startMs: StrictInt = Field(ge=0)
    endMs: StrictInt = Field(ge=0)
    source: str = Field(max_length=MAX_SEGMENT_TEXT)
    target: str = Field(default="", max_length=MAX_SEGMENT_TEXT)
    detected: str = Field(default="", max_length=16)

    @model_validator(mode="after")
    def ordered(self):
        if self.endMs < self.startMs:
            raise ValueError("endMs before startMs")
        return self


class LiveText(BaseModel):
    text: str
    segments: list[Sentence] | None = Field(default=None, max_length=MAX_SEGMENTS)


@router.put("/api/interpret/live/{token}/translation")
async def live_translation(token: str, body: LiveText, user: auth.CurrentUser):
    owner, rec = LIVE.get(token, (None, None))
    if owner != user.username:
        raise HTTPException(status_code=404, detail="找不到進行中的翻譯")
    if len(body.text) > MAX_TEXT:
        raise HTTPException(status_code=422, detail="譯文太長")
    rec.translation = [body.text]
    if body.segments is not None:
        rec.segments = [s.model_dump() for s in body.segments]
    return {"kept": len(body.text)}


@router.get("/interpret")
async def page(_user: auth.CurrentUser):
    """我的紀錄: every signed-in user's own 即時翻譯 and 即時口譯 records; sessions run from the live page."""
    return FileResponse(auth.STATIC_DIR / "interpret.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/interpret/config")
async def config(user: auth.CurrentUser):
    import records_retention   # it reads this module's record folders
    return {"configured": configured(), "allowed": await allowed(user), "usdPerHour": interpret_usage.USD_PER_HOUR,
            "targets": list(TARGETS), "retentionDays": await records_retention.days(), "convertSpeed": record_meeting.SPEED}


class Grant(BaseModel):
    username: str


@router.get("/api/admin/interpret-access")
async def access_list(_admin: team_access.Admin):
    async with db.connect() as conn:
        rows = await (await conn.execute("SELECT username, granted_by, granted_at FROM interpret_access ORDER BY username")).fetchall()
    return [{"username": r["username"], "grantedBy": r["granted_by"], "grantedAt": r["granted_at"].isoformat()} for r in rows]


@router.post("/api/admin/interpret-access")
async def access_grant(body: Grant, admin: team_access.Admin):
    username = body.username.strip().lower()
    if not USERNAME.fullmatch(username):
        raise HTTPException(status_code=422, detail="帳號格式不正確")
    async with db.connect() as conn:
        await conn.execute("INSERT INTO interpret_access (username, granted_by) VALUES (%s, %s) ON CONFLICT (username) DO NOTHING",
                           (username, admin.username))
    return {"username": username}


@router.delete("/api/admin/interpret-access/{username}")
async def access_withdraw(username: str, _admin: team_access.Admin):
    if not USERNAME.fullmatch(username.strip().lower()):
        raise HTTPException(status_code=422, detail="帳號格式不正確")
    async with db.connect() as conn:
        result = await conn.execute("DELETE FROM interpret_access WHERE username = %s", (username.strip().lower(),))
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="這個帳號沒有即時口譯權限")
    return {"withdrawn": username.strip().lower()}


@router.get("/api/interpret/sessions")
async def sessions(user: auth.CurrentUser):
    """The user's own records of both kinds (即時翻譯 and 即時口譯), newest first."""
    items, folder = [], user_dir(user.username)
    if folder.is_dir():
        for sub in sorted(folder.iterdir(), reverse=True):
            if not SESSION_ID.fullmatch(sub.name):
                continue
            try:
                data = json.loads((sub / "session.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            data = {"kind": "interpret"} | data
            items.append({k: data.get(k) for k in ("id", "startedAt", "target", "sourceLang", "engine", "inputSeconds", "outputSeconds", "usd")}
                         | {"kind": data["kind"], "preview": (data.get("translation") or data.get("sourceText") or "")[:60],
                            # record-to-meeting: the meeting it became, whether it has its sentences, and why it cannot become one
                            "meetingId": data.get("meetingId"), "segments": record_meeting.has_sentences(data),
                            "cannotConvert": record_meeting.why_not(data),
                            "missingTailMs": record_meeting.missing_tail_ms(data),
                            "conversion": _job_state(record_meeting.JOBS[(user.username, sub.name)]) if (user.username, sub.name) in record_meeting.JOBS else None})
    return items


@router.get("/api/interpret/sessions/{sid}")
async def session(sid: str, user: auth.CurrentUser):
    data = json.loads((session_dir(user, sid) / "session.json").read_text(encoding="utf-8"))
    return {"kind": "interpret"} | data   # saved before kinds existed: interpreting


class Translation(LiveText):
    pass


def write_translation(folder: Path, text: str, segments: list[dict] | None = None) -> None:
    """The translation of a 即時翻譯 record, from the page: session.json and transcript.txt; with its sentences when sent."""
    data = json.loads((folder / "session.json").read_text(encoding="utf-8"))
    data["translation"] = text
    if segments is not None:
        data["segments"] = segments
    (folder / "session.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    (folder / "transcript.txt").write_text(f"原文：\n{data.get('sourceText', '')}\n\n譯文（{data.get('target', '')}）：\n{text}\n", encoding="utf-8")


@router.put("/api/interpret/sessions/{sid}/translation")
async def session_translation(sid: str, body: Translation, user: auth.CurrentUser):
    folder = session_dir(user, sid)
    if len(body.text) > MAX_TEXT:
        raise HTTPException(status_code=422, detail="譯文太長")
    if json.loads((folder / "session.json").read_text(encoding="utf-8")).get("kind") != "translate":
        raise HTTPException(status_code=409, detail="即時口譯紀錄的譯文由口譯產生，不能修改")
    await asyncio.to_thread(write_translation, folder, body.text, None if body.segments is None else [s.model_dump() for s in body.segments])
    return {"saved": sid}


class ToMeeting(BaseModel):
    team_id: StrictInt
    title: str = Field(default="", max_length=team_access.TITLE_MAX)


def _job_state(job: dict) -> dict:
    return {k: job[k] for k in ("state", "doneMs", "totalMs", "error")}


@router.post("/api/interpret/sessions/{sid}/meeting")
async def to_meeting(sid: str, body: ToMeeting, user: auth.CurrentUser):
    """record-to-meeting: the record becomes a meeting of one of the user's teams. With its sentences at once (200);
    otherwise through 精準模式 in the background (202), followed with GET."""
    folder = session_dir(user, sid)
    data = {"kind": "interpret"} | json.loads((folder / "session.json").read_text(encoding="utf-8"))
    if data.get("meetingId"):
        raise HTTPException(status_code=409, detail={"message": "這筆紀錄已轉成會議紀錄", "meetingId": data["meetingId"]})
    key = (user.username, sid)
    if record_meeting.JOBS.get(key, {}).get("state") == "running" or key in record_meeting.CLAIMED:
        raise HTTPException(status_code=409, detail={"message": "這筆紀錄正在轉成會議紀錄"})
    # Claimed before the first wait, so two requests at once (a double click, two tabs) never make two meetings.
    record_meeting.CLAIMED.add(key)
    try:
        return await _convert(key, folder, data, body, user)
    finally:
        record_meeting.CLAIMED.discard(key)


async def _convert(key: tuple[str, str], folder: Path, data: dict, body: ToMeeting, user: auth.User):
    async with db.connect() as conn:
        if not await team_access.is_member(conn, user.username, body.team_id):
            raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)
    reason = record_meeting.why_not(data)
    if reason:
        raise HTTPException(status_code=503 if reason == record_meeting.NOT_CONFIGURED else 422, detail=reason)
    title = body.title.strip() or record_meeting.default_title(data)
    if record_meeting.has_sentences(data):
        return {"meetingId": await record_meeting.convert(user.username, folder, body.team_id, title)}
    running = [k for k, job in record_meeting.JOBS.items() if job["state"] == "running"]
    if any(k[0] == user.username for k in running) or len(running) >= record_meeting.MAX_RUNNING:
        raise HTTPException(status_code=429, detail="目前有其他紀錄正在轉換，請稍後再試")
    job = record_meeting.JOBS[key] = {"state": "running", "doneMs": 0, "totalMs": 0, "error": ""}

    async def run() -> None:
        try:
            await record_meeting.convert(user.username, folder, body.team_id, title, job)
            record_meeting.JOBS.pop(key, None)
        except asyncio.CancelledError:
            record_meeting.JOBS.pop(key, None)
            raise
        except record_meeting.Failed as error:
            job.update(state="failed", error=str(error))
        except Exception as error:   # why, never what was said
            logger.warning("record to meeting failed: %s", type(error).__name__)
            job.update(state="failed", error=record_meeting.FAILED)
    job["task"] = asyncio.create_task(run())
    return JSONResponse(_job_state(job), status_code=202)


@router.get("/api/interpret/sessions/{sid}/meeting")
async def to_meeting_state(sid: str, user: auth.CurrentUser):
    data = json.loads((session_dir(user, sid) / "session.json").read_text(encoding="utf-8"))
    if data.get("meetingId"):
        return {"state": "done", "meetingId": data["meetingId"]}
    job = record_meeting.JOBS.get((user.username, sid))
    return _job_state(job) if job else {"state": "none"}


@router.get("/api/interpret/sessions/{sid}/bars")
async def session_bars(sid: str, user: auth.CurrentUser):
    folder = session_dir(user, sid)
    try:
        return json.loads((folder / "bars.json").read_text(encoding="utf-8"))
    except FileNotFoundError:   # saved before the waveform was kept: read it from the audio
        output = folder / "output.wav"
        return await asyncio.to_thread(lambda: bars_of(wav_blocks(folder / "input.wav"), wav_blocks(output) if output.exists() else ()))


@router.get("/api/interpret/sessions/{sid}/{name}")
async def session_file(sid: str, name: str, user: auth.CurrentUser):
    path = session_dir(user, sid) / name
    if name not in FILES or not path.is_file():   # a 即時翻譯 record has no output.wav
        raise HTTPException(status_code=404, detail="找不到這個檔案")
    return FileResponse(path, filename=f"interpret-{sid}-{name}", headers={"Cache-Control": "no-store"})


@router.delete("/api/interpret/sessions/{sid}")
async def delete_session(sid: str, user: auth.CurrentUser):
    folder = session_dir(user, sid)
    job = record_meeting.JOBS.pop((user.username, sid), None)
    if job and job.get("task"):   # being converted: stopped, no meeting
        job["task"].cancel()
    shutil.rmtree(folder)
    return {"deleted": sid}


async def _close(browser: WebSocket, code: int, reason: str) -> None:
    if browser.client_state == WebSocketState.CONNECTED:
        await browser.close(code=code, reason=reason)


@router.websocket("/ws/interpret")
async def interpret(browser: WebSocket):
    await browser.accept()
    user = browser.state.user
    if user is None:
        await _close(browser, 4401, "請先登入")
        return
    try:
        permitted = await allowed(user)
    except Exception as error:   # noqa: BLE001 - database unreachable: do not reach the translation service
        logger.warning("interpret: access check failed: %s", type(error).__name__)
        await _close(browser, 1011, "access check failed")
        return
    if not permitted:
        await _close(browser, 4403, NO_ACCESS)
        return
    if not stream_limits.take_place(user.username):
        await _close(browser, 4429, stream_limits.TOO_MANY.format(n=stream_limits.MAX_STREAMS_PER_USER))
        return
    try:
        await _run(browser, user)
    finally:
        stream_limits.free_place(user.username)


async def _run(browser: WebSocket, user: auth.User) -> None:
    try:
        start = json.loads(await asyncio.wait_for(browser.receive_text(), stream_limits.STREAM_HEADER_TIMEOUT))
    except asyncio.TimeoutError:
        await _close(browser, 4408, stream_limits.NO_START)
        return
    except WebSocketDisconnect:
        return
    except (ValueError, KeyError, RuntimeError):
        await _close(browser, 4400, "開始訊息格式不對")
        return
    target = start.get("target") if isinstance(start, dict) else None
    if target not in TARGETS:
        await _close(browser, 4400, "不支援這個輸出語言")
        return
    if not configured():
        await _close(browser, 4503, NOT_CONFIGURED)
        return
    source_lang = start.get("sourceLang") if start.get("sourceLang") in SOURCE_LANGUAGES else "zh"

    async def tell(payload: dict) -> None:
        if browser.client_state == WebSocketState.CONNECTED:
            await browser.send_text(json.dumps(payload, ensure_ascii=False))

    try:
        azure = await websockets.connect(azure_url(), additional_headers={"api-key": KEY}, max_size=None, open_timeout=15)
    except Exception as error:   # noqa: BLE001 - DNS, TLS, 401 from Azure: the page only needs the kind
        logger.warning("interpret: Azure connection failed: %s", type(error).__name__)
        await tell({"type": "error", "message": UNREACHABLE})
        await _close(browser, 1011, "azure unavailable")
        return
    session = {"audio": {"output": {"language": target}}}
    if TRANSCRIBE:
        session["audio"]["input"] = {"transcription": {"model": TRANSCRIBE}}
    await azure.send(json.dumps({"type": "session.update", "session": session}))
    await tell({"type": "status", "state": "connected"})
    rec = Recording(user_dir(user.username), {"kind": "interpret", "target": target, "sourceLang": source_lang, "engine": "local" if source_lang in LOCAL_SOURCES else "mai"})
    limit = stream_limits.max_stream_bytes() * RATE // 16000   # the same hours as /ws/transcribe, at 24 kHz
    stop_code = None
    token, checked = browser.cookies.get(auth.SESSION_COOKIE), time.monotonic()

    async def refused() -> tuple[int, str] | None:
        """Re-check the session and the access every STREAM_RECHECK_MINUTES, as /ws/transcribe does; when the
        database cannot answer, keep going and try again 30 seconds later. Returns the close code when refused."""
        nonlocal checked
        if time.monotonic() - checked < stream_limits.STREAM_RECHECK_MINUTES * 60:
            return None
        checked = time.monotonic()
        try:
            current = await auth.session_user(token)
            if current is None:
                return (4401, "session ended")
            return None if await allowed(current) else (4403, NO_ACCESS)
        except Exception as error:   # noqa: BLE001 - database unreachable
            logger.warning("interpret: access check failed, retrying in 30 s: %s", error)
            checked -= stream_limits.STREAM_RECHECK_MINUTES * 60 - stream_limits.RECHECK_RETRY_SECONDS
            return None

    async def upstream() -> None:
        nonlocal stop_code
        while True:
            message = await browser.receive()
            if message["type"] == "websocket.disconnect":
                return
            pcm = message.get("bytes")
            if pcm:
                if refusal := await refused():
                    stop_code = refusal
                    return
                if rec.input_bytes + len(pcm) > limit:
                    text = stream_limits.TOO_LONG.format(hours=stream_limits.MAX_STREAM_HOURS)
                    await tell({"type": "error", "message": text})
                    stop_code = (4413, text)
                    return
                rec.add_input(pcm)
                await azure.send(json.dumps({"type": "session.input_audio_buffer.append", "audio": base64.b64encode(pcm).decode()}))
            elif message.get("text"):
                try:
                    event = json.loads(message["text"])
                except ValueError:
                    continue
                if event.get("type") == "stop":
                    return
                if event.get("type") == "source" and isinstance(event.get("text"), str):
                    keep = event.get("keep", 0)   # only the change: the first `keep` characters stay, `text` follows
                    if type(keep) is int and 0 <= keep <= len(rec.source):
                        rec.source = (rec.source[:keep] + event["text"])[:200000]

    async def downstream() -> None:
        async for raw in azure:
            event = json.loads(raw)
            kind = event.get("type", "")
            if kind == "session.output_audio.delta":
                rec.add_piece(rec.clock(), base64.b64decode(event.get("delta", "")))
                await tell({"type": "audio", "audio": event.get("delta", "")})
            elif kind == "session.output_transcript.delta":
                delta = event.get("delta", "")
                delta = TO_TAIWAN.convert(delta) if target == "zh" else delta
                rec.translation.append(delta)
                await tell({"type": "out", "delta": delta})
            elif kind == "error":
                await tell({"type": "error", "message": str((event.get("error") or {}).get("message", ""))[:300]})

    up, down = asyncio.create_task(upstream()), asyncio.create_task(downstream())
    try:
        await asyncio.wait({up, down}, return_when=asyncio.FIRST_COMPLETED)
        if up.done():
            up.result()   # the browser stopped or went away
            try:
                await azure.send(json.dumps({"type": "session.close"}))
                await asyncio.wait_for(asyncio.shield(down), FLUSH_SECONDS)
            except (asyncio.TimeoutError, websockets.ConnectionClosed):
                pass
        else:   # the translation service ended the session first: say so instead of looking like a normal stop
            logger.warning("interpret: translation service closed the session: %s", type(down.exception()).__name__)
            await tell({"type": "error", "message": "翻譯服務中斷了連線，已停止並存下目前的內容"})
            stop_code = (1011, "translation service closed")
    except Exception as error:   # noqa: BLE001 - the browser went away mid-message: still save what there is
        logger.info("interpret: session ended early: %s", type(error).__name__)
    finally:
        up.cancel()
        down.cancel()
        await azure.close()
    seconds = rec.output_seconds
    usd = round(seconds / 3600 * interpret_usage.USD_PER_HOUR, 4)
    try:
        saved = await asyncio.to_thread(rec.save, usd)
    except OSError as error:
        logger.error("interpret: session not saved: %s", error)
        saved = None
        with contextlib.suppress(OSError):
            rec.close()   # what was written stays in the working folder
        await tell({"type": "error", "message": "存檔失敗"})
    await interpret_usage.add("live", seconds, user.username)
    await tell({"type": "status", "state": "closed", "saved": saved, "usd": usd,
                "inputSeconds": round(rec.input_seconds, 1), "outputSeconds": round(seconds, 1)})
    code, reason = stop_code or (1000, "")
    await _close(browser, code, reason)
