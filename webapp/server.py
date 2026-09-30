import asyncio
import json
import os
import uuid
from pathlib import Path

import httpx
import websockets
from opencc import OpenCC
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ASR_WS_URL = os.getenv("ASR_WS_URL", "ws://asr:8272/asr_stream_api_v1")
ASR_SECRET_KEY = os.getenv("ASR_SECRET_KEY", "change-me-local-only")
TRANSLATE_URL = os.getenv("TRANSLATE_URL", "http://translate:5000").rstrip("/")
TRANSLATE_MODEL = os.getenv("TRANSLATE_MODEL", "gemma-4-E2B_q4_0-it.gguf")
STATIC_DIR = Path(__file__).resolve().parent / "static"
TO_TRADITIONAL = OpenCC("s2twp")
LANGUAGES = {
    "zh": ("Chinese", "Traditional Chinese"),
    "en": ("English", "English"),
    "ja": ("Japanese", "Japanese"),
    "ko": ("Korean", "Korean"),
    "fr": ("French", "French"),
    "de": ("German", "German"),
    "it": ("Italian", "Italian"),
    "pt": ("Portuguese", "Portuguese"),
    "ru": ("Russian", "Russian"),
    "es": ("Spanish", "Spanish"),
    "ar": ("Arabic", "Arabic"),
    "yue": ("Cantonese", "Cantonese"),
    "id": ("Indonesian", "Indonesian"),
    "th": ("Thai", "Thai"),
    "vi": ("Vietnamese", "Vietnamese"),
    "tr": ("Turkish", "Turkish"),
    "hi": ("Hindi", "Hindi"),
    "ms": ("Malay", "Malay"),
    "nl": ("Dutch", "Dutch"),
    "sv": ("Swedish", "Swedish"),
    "da": ("Danish", "Danish"),
    "fi": ("Finnish", "Finnish"),
    "pl": ("Polish", "Polish"),
    "cs": ("Czech", "Czech"),
    "fil": ("Filipino", "Filipino"),
    "fa": ("Persian", "Persian"),
    "el": ("Greek", "Greek"),
    "ro": ("Romanian", "Romanian"),
    "hu": ("Hungarian", "Hungarian"),
    "mk": ("Macedonian", "Macedonian"),
}
LANGUAGE_PATTERN = "^(auto|" + "|".join(LANGUAGES) + ")$"
TARGET_PATTERN = "^(" + "|".join(LANGUAGES) + ")$"

app = FastAPI(title="語橋 Live — 即時會議翻譯")
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


class TranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)
    source: str = Field(pattern=LANGUAGE_PATTERN)
    target: str = Field(pattern=TARGET_PATTERN)
    history: str = Field(default="", max_length=4_000)
    draft: bool = False


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/translate")
async def translate(body: TranslationRequest):
    if body.source == body.target:
        return {"translatedText": TO_TRADITIONAL.convert(body.text) if body.target in ("zh", "yue") else body.text}
    source_name = "the detected input language" if body.source == "auto" else LANGUAGES[body.source][0]
    target_name = LANGUAGES[body.target][1]
    prompt = (
        f"Translate only the new {source_name} speech segment into natural {target_name}. "
        "Translate it exactly once. Preserve its meaning, names, numbers, and punctuation. "
        "Return only the translation; do not explain, add labels, or repeat any context.\n"
        f"Previous source-language context (reference only; do not translate): {body.history[-600:]}\n"
        f"Translate this segment only:\n{body.text}"
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{TRANSLATE_URL}/v1/chat/completions",
                json={
                    "model": TRANSLATE_MODEL,
                    "temperature": 0,
                    "max_tokens": min(512, max(96, len(body.text) * 4)),
                    "chat_template_kwargs": {"enable_thinking": False},
                    "messages": [
                        {"role": "system", "content": "You are a professional live interpreter. Output only the requested translation, once."},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()
            translated = payload["choices"][0]["message"]["content"].strip()
            if not translated:
                raise ValueError("translation model returned an empty response")
            if body.target in ("zh", "yue"):
                translated = TO_TRADITIONAL.convert(translated)
            return {"translatedText": translated}
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Translation service unavailable: {exc}") from exc


def translation_payload(body: TranslationRequest) -> dict:
    source_name = "the detected language" if body.source == "auto" else LANGUAGES[body.source][0]
    target_name = LANGUAGES[body.target][1]
    instruction = (
        f"Translate the following {source_name} speech into natural {target_name}. "
        "Return only the translation. Preserve names and numbers."
    )
    if body.draft:
        instruction += " This is live, unfinished speech; translate what is present without inventing an ending."
    context = f"Context (do not translate): {body.history[-180:]}\n" if body.history and not body.draft else ""
    return {
        "model": TRANSLATE_MODEL,
        "temperature": 0,
        "max_tokens": min(128 if body.draft else 384, max(48, len(body.text) * (2 if body.draft else 3))),
        "stream": True,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [
            {"role": "system", "content": "You are a professional live interpreter. Output only the translation."},
            {"role": "user", "content": f"{instruction}\n{context}Speech: {body.text}"},
        ],
    }


@app.post("/api/translate/stream")
async def translate_stream(body: TranslationRequest):
    async def events():
        if body.source == body.target:
            result = TO_TRADITIONAL.convert(body.text) if body.target in ("zh", "yue") else body.text
            yield f"data: {json.dumps({'text': result, 'done': True}, ensure_ascii=False)}\n\n"
            return
        raw = ""
        try:
            timeout = httpx.Timeout(connect=5, read=60, write=10, pool=5)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{TRANSLATE_URL}/v1/chat/completions", json=translation_payload(body)) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        part = json.loads(data)
                        if "error" in part:
                            raise ValueError(str(part["error"]))
                        delta = part.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if isinstance(delta, str) and delta:
                            raw += delta
                            visible = TO_TRADITIONAL.convert(raw) if body.target in ("zh", "yue") else raw
                            yield f"data: {json.dumps({'text': visible, 'done': False}, ensure_ascii=False)}\n\n"
            if not raw.strip():
                raise ValueError("translation model returned an empty response")
            visible = TO_TRADITIONAL.convert(raw.strip()) if body.target in ("zh", "yue") else raw.strip()
            yield f"data: {json.dumps({'text': visible, 'done': True}, ensure_ascii=False)}\n\n"
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            yield f"data: {json.dumps({'error': f'Translation service unavailable: {exc}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.websocket("/ws/transcribe")
async def transcribe(browser: WebSocket):
    await browser.accept()
    try:
        raw_header = await browser.receive_text()
        header = json.loads(raw_header)
        chinese_display = header.get("language", "auto") in ("auto", "zhen", "zh", "Chinese", "yue", "Cantonese")
        safe_header = {
            "channels": 1,
            "sample_rate": 16000,
            "requestId": str(header.get("requestId") or uuid.uuid4()),
            "language": LANGUAGES.get(header.get("language"), (None,))[0] or "zhen",
            "use_vad": bool(header.get("use_vad", False)),
            "secret_key": ASR_SECRET_KEY,
            "mode": "slow",
            "system_prompt": str(header.get("system_prompt", ""))[:4000],
        }
        async with websockets.connect(ASR_WS_URL, ping_interval=None, max_size=None) as upstream:
            await upstream.send(json.dumps(safe_header, ensure_ascii=False))
            raw_transcript = ""

            async def browser_to_asr():
                while True:
                    event = await browser.receive()
                    if event.get("type") == "websocket.disconnect":
                        return
                    if event.get("bytes") is not None:
                        await upstream.send(event["bytes"])
                    elif event.get("text") is not None:
                        await upstream.send(event["text"])

            async def asr_to_browser():
                nonlocal raw_transcript
                async for message in upstream:
                    if isinstance(message, bytes):
                        await browser.send_bytes(message)
                    else:
                        try:
                            payload = json.loads(message)
                            chunk = payload.get("msg", {}).get("text", "")
                            if isinstance(chunk, str) and chunk:
                                raw_transcript += chunk
                                payload["displayText"] = TO_TRADITIONAL.convert(raw_transcript) if chinese_display else raw_transcript
                                message = json.dumps(payload, ensure_ascii=False)
                        except (json.JSONDecodeError, AttributeError, TypeError):
                            pass
                        await browser.send_text(message)

            done, pending = await asyncio.wait(
                [asyncio.create_task(browser_to_asr()), asyncio.create_task(asr_to_browser())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()
    except (WebSocketDisconnect, websockets.ConnectionClosed):
        pass
    except Exception as exc:
        try:
            await browser.send_json({"status": "error", "msg": str(exc)})
        except Exception:
            pass
