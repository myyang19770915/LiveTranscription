"""Azure MAI-Transcribe-2-Streaming as a second ASR engine behind /ws/transcribe.

The bridge speaks the local ASR gateway's message format, so segmentation and translation are unchanged.
MAI streams finalized text as deltas but writes no punctuation for Chinese/Japanese and has no server VAD:
an energy VAD commits at pauses and each committed item is closed with a punctuation mark (rule-based, or
punctuated by the cloud text model for Chinese when 雲端精修 is on). English is punctuated by MAI itself,
and a commit there makes it end the sentence ("That means that despite."), so English only commits at the end.
"""
import array
import asyncio
import base64
import json
import logging
import math
import os
from collections import deque
from typing import Awaitable, Callable
from urllib.parse import urlsplit

import websockets

logger = logging.getLogger("uvicorn.error")
MAI_ENDPOINT = os.getenv("AZURE_MAI_ENDPOINT", "")
MAI_KEY = os.getenv("AZURE_MAI_API_KEY", "")
MAI_DEPLOYMENT = os.getenv("AZURE_MAI_DEPLOYMENT", "") or "MAI-Transcribe-2-Streaming"
EOS = "YOUDAO_ONETIME_ASR_STREAM_EOS"
FRAME = 640  # 20 ms of 16 kHz PCM16
COMMIT_PAUSE, SENTENCE_PAUSE, MAX_ITEM = 0.4, 0.8, 15.0
# Speech languages MAI writes without punctuation; auto/zh_ja may be either, so they commit at pauses too.
PAUSE_COMMITS = {"zh", "ja", "yue", "zh_ja", "auto"}
MARKS = set("。．.！!？?，,、；;：:「」『』（）()…—·\"' \n")


def realtime_url(endpoint: str = MAI_ENDPOINT) -> str:
    """The MAI realtime WebSocket for a Foundry resource. Accepts the resource's https endpoint
    (any path, e.g. the REST transcription URL from the portal) or a full wss:// URL."""
    parts = urlsplit(endpoint.strip())
    if parts.scheme in ("ws", "wss"):
        return endpoint.strip()
    resource = (parts.hostname or "").split(".")[0]
    return f"wss://{resource}.services.ai.azure.com/mai/v1/realtime?intent=transcription" if resource else ""


def configured() -> bool:
    return bool(realtime_url() and MAI_KEY)


def strip_marks(text: str) -> str:
    return "".join(char for char in text if char not in MARKS)


def merge_marks(original: str, punctuated: str, normalize: Callable[[str], str] = lambda char: char) -> str:
    """The original text with the punctuation of `punctuated`, or "" when the model changed any word.
    Characters always come from the original (the model may switch script), spaces and existing marks stay."""
    out, j = [], 0
    for char in original:
        if char in MARKS:
            out.append(char)
            if j < len(punctuated) and punctuated[j] == char:
                j += 1
            continue
        while j < len(punctuated) and punctuated[j] in MARKS:
            if punctuated[j].strip() and (not out or out[-1] != punctuated[j]):
                out.append(punctuated[j])
            j += 1
        if j >= len(punctuated) or normalize(punctuated[j]) != normalize(char):
            return ""
        out.append(char)
        j += 1
    tail = punctuated[j:]
    if strip_marks(tail):
        return ""
    return "".join(out) + "".join(mark for mark in tail if mark.strip())


class PauseDetector:
    """Energy VAD over 20 ms frames; the noise floor is a low percentile of the last ~10 s."""

    def __init__(self):
        self.levels, self.rest = deque(maxlen=500), b""
        self.silence, self.speech, self.since_pause = 0.0, False, 0.0

    def feed(self, pcm: bytes) -> bool:
        """True when a pause starts: COMMIT_PAUSE of silence after speech, or a quiet frame once an
        item has run MAX_ITEM seconds without one."""
        data, pause = self.rest + pcm, False
        usable = len(data) - len(data) % FRAME
        for start in range(0, usable, FRAME):
            samples = array.array("h", data[start:start + FRAME])
            level = math.sqrt(sum(x * x for x in samples) / len(samples))
            self.levels.append(level)
            floor = sorted(self.levels)[len(self.levels) // 7]
            self.since_pause += 0.02
            if level >= max(150.0, 2.5 * floor):
                self.speech, self.silence = True, 0.0
                continue
            self.silence += 0.02
            if self.speech and (self.silence >= COMMIT_PAUSE or self.since_pause >= MAX_ITEM):
                self.speech, self.since_pause, pause = False, 0.0, True
        self.rest = data[usable:]
        return pause


class MaiBridge:
    """One browser meeting <-> one MAI session (reconnected when the service drops it)."""

    def __init__(self, browser, language: str, display, punctuate: Callable[[str, str, bool], Awaitable[str]] | None = None):
        self.browser, self.language, self.display, self.punctuate = browser, language, display, punctuate
        self.vad, self.ws, self.items = PauseDetector(), None, deque()
        self.events: asyncio.Queue = asyncio.Queue()
        self.audio_since_commit, self.closing, self.eos, self.reconnects = 0, False, False, 0
        self.item_start = 0  # display position where the uncommitted item begins

    async def connect(self):
        ws = await websockets.connect(realtime_url(), additional_headers={"api-key": MAI_KEY}, max_size=None, ping_interval=20)
        if json.loads(await ws.recv()).get("type") != "session.created":
            raise RuntimeError("MAI session was not created")
        transcription = {"model": MAI_DEPLOYMENT}
        if self.language not in ("auto", "zh_ja"):
            transcription["language"] = self.language  # omitted = automatic detection
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "transcription", "audio": {"input": {
            "format": {"type": "audio/pcm", "rate": 16000}, "transcription": transcription, "turn_detection": None}}}}))
        while (event := json.loads(await ws.recv())).get("type") != "session.updated":
            if event.get("type") == "error":
                raise RuntimeError(event.get("error", {}).get("message", "MAI session update failed"))
        self.ws = ws

    async def send(self, event: dict):
        if self.ws is not None:
            try:
                await self.ws.send(json.dumps(event))
            except websockets.ConnectionClosed:
                pass  # the reader reconnects

    async def commit(self, pause: bool):
        self.items.append(pause)
        self.audio_since_commit = 0
        await self.send({"type": "input_audio_buffer.commit"})

    async def browser_to_mai(self):
        while True:
            event = await self.browser.receive()
            if event.get("type") == "websocket.disconnect":
                self.closing = True
                return
            if event.get("bytes") is not None:
                pcm = event["bytes"]
                await self.send({"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm).decode("ascii")})
                self.audio_since_commit += len(pcm)
                if self.vad.feed(pcm) and self.language in PAUSE_COMMITS:
                    await self.commit(pause=True)
            elif event.get("text") == EOS:
                self.closing = self.eos = True
                if self.audio_since_commit:
                    await self.commit(pause=False)
                await self.events.put(None)  # drain marker: close once every commit is answered
                return

    async def mai_to_queue(self):
        while True:
            try:
                async for raw in self.ws:
                    event = json.loads(raw)
                    if event.get("type") == "error" or event.get("type", "").endswith("failed"):
                        logger.warning("MAI error: %s", event.get("error", event))
                        await self.ws.close()
                        break
                    await self.events.put(event)
            except websockets.ConnectionClosed:
                pass
            if self.closing and not self.items:
                return
            # Sessions end after an hour or on a service hiccup; audio sent meanwhile is lost.
            self.reconnects += 1
            self.items.clear()
            self.ws = None
            if self.reconnects > 5:
                raise RuntimeError("雲端辨識連線中斷")
            await asyncio.sleep(min(2.0, 0.5 * self.reconnects))
            logger.info("MAI reconnecting (%d)", self.reconnects)
            await self.connect()
            await self.events.put({"type": "reconnected"})

    async def emit(self, text: str, speech_end: bool = False):
        payload = {"status": "success", "msg": {"text": text, "reset": False, "speech_end": speech_end, "language": ""}}
        self.display.annotate(payload)
        await self.browser.send_text(json.dumps(payload, ensure_ascii=False))

    async def rule_mark(self, text: str) -> str:
        # A pause that keeps going ends the sentence; speech resuming soon after is a clause break.
        for _ in range(10):
            if self.vad.speech or self.vad.silence >= SENTENCE_PAUSE:
                break
            await asyncio.sleep(0.05)
        if not self.vad.speech:
            return "。"
        return "、" if any("぀" <= char <= "ヿ" for char in text) else "，"

    async def close_item(self, transcript: str, pause: bool):
        """Punctuate the committed item and mark the utterance end where it stops. Items that are not
        aligned with the display (later deltas came first, or text was lost on a reconnect) and text
        without CJK characters only get the utterance end."""
        start, mark = self.item_start, ""
        cjk = any("぀" <= char <= "ヿ" or "㐀" <= char <= "鿿" for char in transcript)
        if cjk and self.display.raw[start:] == transcript:
            fixed = await self.punctuate(self.display.raw[max(0, start - 200):start], transcript, pause) if self.punctuate else ""
            if fixed and fixed[-1] in "。！？，、" and strip_marks(fixed) == strip_marks(transcript):
                self.display.rewrite(start, fixed[:-1])
                mark = fixed[-1]
            elif transcript[-1] not in MARKS:
                mark = await self.rule_mark(transcript)
        await self.emit(mark, speech_end=True)
        self.item_start = len(self.display.raw)

    async def process(self):
        while True:
            event = await self.events.get()
            if event is None:
                if not self.items:
                    return
                await self.events.put(None)  # still waiting for completions
                await asyncio.sleep(0.05)
                continue
            kind = event.get("type", "")
            if kind.endswith("transcription.delta") and event.get("delta"):
                await self.emit(event["delta"])
            elif kind.endswith("transcription.completed"):
                pause = self.items.popleft() if self.items else False
                await self.close_item(event.get("transcript", ""), pause)
            elif kind == "reconnected":
                self.item_start = len(self.display.raw)

    async def run(self):
        await self.connect()
        await self.browser.send_text(json.dumps({"status": "connected", "msg": "", "engine": "mai"}))
        reader, writer, worker = (asyncio.create_task(self.browser_to_mai()), asyncio.create_task(self.mai_to_queue()),
                                  asyncio.create_task(self.process()))
        try:
            # Ends when the browser leaves, MAI cannot be reached, or (after EOS) every commit is answered.
            done, _ = await asyncio.wait([reader, writer, worker], return_when=asyncio.FIRST_COMPLETED)
            if reader in done and self.eos:
                done, _ = await asyncio.wait([writer, worker], timeout=20, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in (reader, writer, worker):
                task.cancel()
            await asyncio.gather(reader, writer, worker, return_exceptions=True)
            if self.ws is not None:
                await self.ws.close()
