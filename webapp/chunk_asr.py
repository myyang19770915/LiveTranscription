"""The app's own streaming engines as 精準模式's second recognizer (TRANSLATE_QUALITY_ASR=local|mai|hybrid).

The local engine takes one chunk at a time on a connection of its own. Azure MAI recognizes in real time: given a
whole chunk at once it returns only the beginning (measured 2026-11-14: 16 characters of 95 for a 13.6 s chunk, all
95 at real-time pace), so it gets one session per stream, hears the audio as it arrives, and is committed at each
chunk cut. Nothing is logged here; the caller logs numbers only.
"""
import array
import asyncio
import base64
import json
import os
import uuid
from collections import deque

import websockets

import mai_asr
from translation_quality import asr_context

ASR_WS_URL = os.getenv("ASR_WS_URL", "ws://asr:8272/asr_stream_api_v1")
ASR_SECRET_KEY = os.getenv("ASR_SECRET_KEY", "change-me-local-only")
EOS = mai_asr.EOS
STEP = 5120           # 160 ms of 16 kHz PCM16, the local engine's step
MAI_LANGUAGES = ("zh", "en", "ja")
RECONNECT_AFTER = 1.0


class Refused(Exception):
    """The engine answered with an error instead of text, or its connection ended."""


async def local(pcm: bytes, engine_language: str, bilingual: bool, glossary: str) -> str:
    """One chunk through the local engine; `engine_language` is the engine's own name for the language."""
    header = {"channels": 1, "sample_rate": 16000, "requestId": str(uuid.uuid4()), "language": engine_language,
              "use_vad": bilingual, "secret_key": ASR_SECRET_KEY, "mode": "slow", "system_prompt": asr_context(glossary),
              "retain": False}   # the live stream is the one the ASR request log keeps
    text = ""
    async with websockets.connect(ASR_WS_URL, ping_interval=None, max_size=None) as upstream:
        await upstream.send(json.dumps(header, ensure_ascii=False))
        for at in range(0, len(pcm), STEP):
            await upstream.send(pcm[at:at + STEP])
        await upstream.send(EOS)
        async for message in upstream:     # the engine closes the connection after the tail
            if isinstance(message, bytes):
                continue
            payload = json.loads(message)
            if payload.get("status") == "error":
                raise Refused("local")
            msg = payload.get("msg")
            if isinstance(msg, dict) and isinstance(msg.get("text"), str):
                text += msg["text"]
    return text


def audible(pcm: bytes) -> bool:
    """Whether this audio message holds any sound: the silence after a cut is no part of the next chunk's speech."""
    samples = array.array("h", pcm[:len(pcm) // 2 * 2])[::8]
    return bool(samples) and max(max(samples), -min(samples)) > 400


class MaiLive:
    """One MAI session for one stream. feed() passes the audio on as it arrives; commit() returns a future for the
    text MAI heard since the previous commit. Commits and their transcripts are matched in order. When the session
    cannot be opened or drops, the commits still waiting fail and a new session takes the audio that follows."""

    def __init__(self, language: str):
        self.language = language
        self.queue: asyncio.Queue = asyncio.Queue()   # bytes = audio, Future = a commit
        self.waiting: deque = deque()   # commits sent, not yet answered: a Future, or None for a transcript to drop
        self.closed = False
        self.open_audio = False   # sound went out since the last commit
        self.lost = False         # a session ended with such audio: the next commit would answer for part of a chunk
        self.task = asyncio.create_task(self._run())

    def feed(self, pcm: bytes) -> None:
        if not self.closed:
            self.queue.put_nowait(pcm)

    def commit(self) -> asyncio.Future:
        answer = asyncio.get_running_loop().create_future()
        answer.add_done_callback(lambda done: done.cancelled() or done.exception())   # a failure nobody waits for is not an error
        if self.closed:
            answer.set_exception(Refused("mai"))
        else:
            self.queue.put_nowait(answer)
        return answer

    def close(self) -> None:
        """Safe to call more than once."""
        if self.closed:
            return
        self.closed = True
        self.task.cancel()
        self._fail_waiting()

    def _fail_waiting(self) -> None:
        """The audio of these commits was (partly) lost with the session: commits sent and commits not yet sent.
        Audio that follows the last of them belongs to a chunk still arriving; its commit must fail as well."""
        while not self.queue.empty():
            item = self.queue.get_nowait()
            if isinstance(item, asyncio.Future):
                self.waiting.append(item)
                self.open_audio = False
            elif audible(item):
                self.open_audio = True
        while self.waiting:
            answer = self.waiting.popleft()
            if answer is not None and not answer.done():
                answer.set_exception(Refused("mai"))
        self.lost, self.open_audio = self.lost or self.open_audio, False

    async def _run(self) -> None:
        while True:
            try:
                await self._session()
            except asyncio.CancelledError:
                raise
            except Exception:   # could not connect, an error event, or the session ended (they do after about an hour)
                pass
            self._fail_waiting()
            await asyncio.sleep(RECONNECT_AFTER)

    async def _session(self) -> None:
        transcription = {"model": mai_asr.MAI_DEPLOYMENT}
        if self.language in MAI_LANGUAGES:
            transcription["language"] = self.language   # omitted = automatic detection
        async with websockets.connect(mai_asr.realtime_url(), additional_headers={"api-key": mai_asr.MAI_KEY}, max_size=None) as ws:
            if json.loads(await ws.recv()).get("type") != "session.created":
                raise Refused("mai")
            await ws.send(json.dumps({"type": "session.update", "session": {"type": "transcription", "audio": {"input": {
                "format": {"type": "audio/pcm", "rate": 16000}, "transcription": transcription, "turn_detection": None}}}}))
            while (event := json.loads(await ws.recv())).get("type") != "session.updated":   # audio sent before this is not in the format asked for
                if event.get("type") == "error":
                    raise Refused("mai")
            reader = asyncio.create_task(self._read(ws))
            try:
                while True:
                    item = asyncio.create_task(self.queue.get())
                    await asyncio.wait({item, reader}, return_when=asyncio.FIRST_COMPLETED)
                    if reader.done():   # the session is over; what was taken from the queue is not lost from the count
                        if item.done() and isinstance(item.result(), asyncio.Future):
                            self.waiting.append(item.result())
                        elif item.done() and audible(item.result()):
                            self.open_audio = True   # speech of a chunk still arriving went down with the session
                        item.cancel()
                        reader.result()
                        raise Refused("mai")
                    got = item.result()
                    if isinstance(got, asyncio.Future):
                        if self.lost:   # this session heard only the end of the chunk: no text is better than part of it
                            self.lost = False
                            got.set_exception(Refused("mai"))
                            got = None   # the commit still goes out, to empty MAI's buffer; its transcript is dropped
                        self.waiting.append(got)
                        self.open_audio = False
                        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
                    else:
                        self.open_audio = self.open_audio or audible(got)
                        await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(got).decode("ascii")}))
            finally:
                reader.cancel()

    async def _read(self, ws) -> None:
        async for raw in ws:
            event = json.loads(raw)
            kind = event.get("type", "")
            if kind == "error" or kind.endswith("failed"):
                raise Refused("mai")
            if kind.endswith("transcription.completed") and self.waiting:
                answer = self.waiting.popleft()
                if answer is not None and not answer.done():
                    answer.set_result(str(event.get("transcript") or ""))
