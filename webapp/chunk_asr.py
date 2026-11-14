"""One audio chunk through the app's own streaming engines, for 精準模式 with TRANSLATE_QUALITY_ASR=local|mai.

Both engines are streaming services: a chunk is sent at once on a connection of its own and the text is read
when the engine has finished it. Nothing is logged here; the caller logs numbers only.
"""
import base64
import json
import os
import uuid

import websockets

import mai_asr
from translation_quality import asr_context

ASR_WS_URL = os.getenv("ASR_WS_URL", "ws://asr:8272/asr_stream_api_v1")
ASR_SECRET_KEY = os.getenv("ASR_SECRET_KEY", "change-me-local-only")
EOS = mai_asr.EOS
STEP = 5120           # 160 ms of 16 kHz PCM16, the local engine's step
APPEND = 32000        # 1 s per MAI append
MAI_LANGUAGES = ("zh", "en", "ja")


class Refused(Exception):
    """The engine answered with an error instead of text."""


def available(engine: str) -> bool:
    return engine == "local" or (engine == "mai" and mai_asr.configured())


async def recognize(engine: str, pcm: bytes, language: str, engine_language: str, glossary: str) -> str:
    """`language` is the stream's language code, `engine_language` the local engine's name for it."""
    if engine == "mai":
        return await _mai(pcm, language)
    return await _local(pcm, engine_language, language == "zh_ja", glossary)


async def _local(pcm: bytes, engine_language: str, bilingual: bool, glossary: str) -> str:
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


async def _mai(pcm: bytes, language: str) -> str:
    transcription = {"model": mai_asr.MAI_DEPLOYMENT}
    if language in MAI_LANGUAGES:
        transcription["language"] = language   # omitted = automatic detection
    async with websockets.connect(mai_asr.realtime_url(), additional_headers={"api-key": mai_asr.MAI_KEY}, max_size=None) as ws:
        if json.loads(await ws.recv()).get("type") != "session.created":
            raise Refused("mai")
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "transcription", "audio": {"input": {
            "format": {"type": "audio/pcm", "rate": 16000}, "transcription": transcription, "turn_detection": None}}}}))
        while (event := json.loads(await ws.recv())).get("type") != "session.updated":   # audio sent before this is not in the format asked for
            if event.get("type") == "error":
                raise Refused("mai")
        for at in range(0, len(pcm), APPEND):
            await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm[at:at + APPEND]).decode("ascii")}))
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        async for raw in ws:
            event = json.loads(raw)
            kind = event.get("type", "")
            if kind == "error" or kind.endswith("failed"):
                raise Refused("mai")
            if kind.endswith("transcription.completed"):
                return str(event.get("transcript") or "")
    raise Refused("mai")
