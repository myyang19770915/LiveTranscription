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
from fastapi.responses import FileResponse, HTMLResponse
from opencc import OpenCC
from starlette.websockets import WebSocketState

import auth
import interpret_usage
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
NOT_CONFIGURED = "即時口譯尚未設定"     # close reason (4503) the page reads
UNREACHABLE = "連不上翻譯服務，請稍後再試。"      # error event when the translation service cannot be reached
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
        while block := source.readframes(BAR):
            yield block


class Recording:
    """One session on its own clock (from 已連線), written to disk as it arrives: the audio sent, the translated pieces
    each at the time it arrived, the waveform values and the texts. Only counts and waveform values stay in memory."""

    def __init__(self, folder_of_user: Path, meta: dict):
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

    def clock(self) -> float:
        return time.monotonic() - self.t0

    @property
    def input_seconds(self) -> float:
        return self.input_bytes / BYTES_PER_SECOND

    @property
    def output_seconds(self) -> float:
        return self.output_bytes / BYTES_PER_SECOND

    def _open(self) -> None:
        if self.folder is not None:
            return
        self.folder_of_user.mkdir(parents=True, exist_ok=True)
        self.folder = self.folder_of_user / f".recording-{self.started.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(4)}"
        self.folder.mkdir()
        for name in ("input.wav", "output.wav"):
            file = open(self.folder / name, "wb", buffering=0)   # unbuffered: on disk as it arrives
            out = wave.open(file, "wb")
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(RATE)
            self.writers[name] = (out, file)

    def add_input(self, pcm: bytes) -> None:
        self._open()
        self.writers["input.wav"][0].writeframes(pcm)
        self.input_bytes += len(pcm)
        data = self.rest + pcm
        whole = len(data) // (2 * BAR) * (2 * BAR)
        self.input_bars += [rms(data[i:i + 2 * BAR]) for i in range(0, whole, 2 * BAR)]
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
        (self.folder / "bars.json").write_text(json.dumps({"step": 0.1, "input": self.input_bars, "output": self.output_bars}), encoding="utf-8")
        (self.folder / "transcript.txt").write_text(f"原文：\n{self.source}\n\n譯文（{data['target']}）：\n{data['translation']}\n", encoding="utf-8")
        (self.folder / "session.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        self.folder.rename(self.folder_of_user / sid)
        return sid


@router.get("/interpret")
async def page(user: auth.CurrentUser):
    if not user.admin:
        return HTMLResponse(team_access.FORBIDDEN_PAGE.replace("團隊管理只開放給系統管理員。", "即時口譯只開放給系統管理員。"), status_code=403)
    return FileResponse(auth.STATIC_DIR / "interpret.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/interpret/config")
async def config(_admin: team_access.Admin):
    return {"configured": configured(), "usdPerHour": interpret_usage.USD_PER_HOUR, "targets": list(TARGETS)}


@router.get("/api/interpret/sessions")
async def sessions(admin: team_access.Admin):
    items, folder = [], user_dir(admin.username)
    if folder.is_dir():
        for sub in sorted(folder.iterdir(), reverse=True):
            if not SESSION_ID.fullmatch(sub.name):
                continue
            try:
                data = json.loads((sub / "session.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            items.append({k: data.get(k) for k in ("id", "startedAt", "target", "sourceLang", "engine", "inputSeconds", "outputSeconds", "usd")}
                         | {"preview": (data.get("translation") or data.get("sourceText") or "")[:60]})
    return items


@router.get("/api/interpret/sessions/{sid}")
async def session(sid: str, admin: team_access.Admin):
    return json.loads((session_dir(admin, sid) / "session.json").read_text(encoding="utf-8"))


@router.get("/api/interpret/sessions/{sid}/bars")
async def session_bars(sid: str, admin: team_access.Admin):
    folder = session_dir(admin, sid)
    try:
        return json.loads((folder / "bars.json").read_text(encoding="utf-8"))
    except FileNotFoundError:   # saved before the waveform was kept: read it from the audio
        return await asyncio.to_thread(lambda: bars_of(wav_blocks(folder / "input.wav"), wav_blocks(folder / "output.wav")))


@router.get("/api/interpret/sessions/{sid}/{name}")
async def session_file(sid: str, name: str, admin: team_access.Admin):
    if name not in FILES:
        raise HTTPException(status_code=404, detail="找不到這個檔案")
    return FileResponse(session_dir(admin, sid) / name, filename=f"interpret-{sid}-{name}", headers={"Cache-Control": "no-store"})


@router.delete("/api/interpret/sessions/{sid}")
async def delete_session(sid: str, admin: team_access.Admin):
    shutil.rmtree(session_dir(admin, sid))
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
    if not user.admin:
        await _close(browser, 4403, "即時口譯只開放給系統管理員")
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
    rec = Recording(user_dir(user.username), {"target": target, "sourceLang": source_lang, "engine": "local" if source_lang in LOCAL_SOURCES else "mai"})
    limit = stream_limits.max_stream_bytes() * RATE // 16000   # the same hours as /ws/transcribe, at 24 kHz
    stop_code = None
    token, checked = browser.cookies.get(auth.SESSION_COOKIE), time.monotonic()

    async def still_allowed() -> bool:
        """Re-check the session every STREAM_RECHECK_MINUTES, as /ws/transcribe does; when the database cannot answer,
        keep going and try again 30 seconds later."""
        nonlocal checked
        if time.monotonic() - checked < stream_limits.STREAM_RECHECK_MINUTES * 60:
            return True
        checked = time.monotonic()
        try:
            current = await auth.session_user(token)
        except Exception as error:   # noqa: BLE001 - database unreachable
            logger.warning("interpret: access check failed, retrying in 30 s: %s", error)
            checked -= stream_limits.STREAM_RECHECK_MINUTES * 60 - stream_limits.RECHECK_RETRY_SECONDS
            return True
        return current is not None and current.admin

    async def upstream() -> None:
        nonlocal stop_code
        while True:
            message = await browser.receive()
            if message["type"] == "websocket.disconnect":
                return
            pcm = message.get("bytes")
            if pcm:
                if not await still_allowed():
                    stop_code = (4401, "session ended")
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
    await interpret_usage.add("live", seconds)
    await tell({"type": "status", "state": "closed", "saved": saved, "usd": usd,
                "inputSeconds": round(rec.input_seconds, 1), "outputSeconds": round(seconds, 1)})
    code, reason = stop_code or (1000, "")
    await _close(browser, code, reason)
