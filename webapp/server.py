import asyncio
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path

import httpx
import websockets
from opencc import OpenCC
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketState
from translation_quality import (TERMS_SCHEMA, apply_aliases, asr_context, consolidate_terms, glossary_entries, learned_replacements,
                                 parse_discovered_terms, policy, repair_asr, strip_context_echo, term_discovery_messages, violations)

ASR_WS_URL = os.getenv("ASR_WS_URL", "ws://asr:8272/asr_stream_api_v1")
ASR_SECRET_KEY = os.getenv("ASR_SECRET_KEY", "change-me-local-only")
TRANSLATE_URL = os.getenv("TRANSLATE_URL", "http://translate:5000").rstrip("/")
TRANSLATE_MODEL = os.getenv("TRANSLATE_MODEL", "gemma-4-E2B_q4_0-it.gguf")
# Optional OpenAI-compatible cloud model for the delayed refinement pass only. Unset = fully local.
# Meeting text is sent to that service only when the user turns 雲端精修 on.
REFINE_URL = os.getenv("TRANSLATE_REFINE_URL", "").rstrip("/")
REFINE_MODEL = os.getenv("TRANSLATE_REFINE_MODEL", "")
REFINE_KEY = os.getenv("TRANSLATE_REFINE_KEY", "")
STATIC_DIR = Path(__file__).resolve().parent / "static"
# Meeting recordings and transcripts land here (compose mounts the project's output/ folder).
OUTPUT_DIR = Path(os.getenv("MEETING_OUTPUT_DIR", "/output"))
MEETING_FILE = re.compile(r"meeting-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.(txt|webm|ogg|m4a)")
MAX_MEETING_BYTES = 1 << 30
class _Traditional(OpenCC):
    # s2twp reads 了 after 說明/證明/表明… as 瞭 ("說明瞭付款方式"); the aspect particle is meant.
    MISREAD_LIAO = re.compile(r"([說證表聲發查講標註])明瞭")

    def convert(self, text: str) -> str:
        return self.MISREAD_LIAO.sub(r"\1明了", super().convert(text))


# Characters only: s2twp's phrase table rewrites ordinary words into IT jargon (循环→迴圈, 扩展→擴充套件)
# and doubles words that are already Taiwanese (演算法→演演算法). The translator writes Taiwanese wording itself.
TO_TRADITIONAL = _Traditional("s2tw")
LANGUAGES = {
    "zh": ("Chinese", "Traditional Chinese as used in Taiwan"),
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
LANGUAGE_PATTERN = "^(auto|zh_ja|" + "|".join(LANGUAGES) + ")$"
TARGET_PATTERN = "^(" + "|".join(LANGUAGES) + ")$"

app = FastAPI(title="語橋 Live — 即時會議翻譯")
logger = logging.getLogger("uvicorn.error")
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


class TranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)
    source: str = Field(pattern=LANGUAGE_PATTERN)
    target: str = Field(pattern=TARGET_PATTERN)
    history: str = Field(default="", max_length=4_000)
    history_translation: str = Field(default="", max_length=4_000)
    glossary: str = Field(default="", max_length=200)
    # Names and mishearings learned during the meeting (/api/terms); hints, never replacements.
    learned: str = Field(default="", max_length=2_000)
    # Speech already heard after this span; it settles how a span cut at a comma ends. Never translated.
    following: str = Field(default="", max_length=600)
    # Background refinement of a finalized span; uses the cloud model when one is configured.
    refine: bool = False
    draft: bool = False
    detected_language: str = Field(default="", pattern="^(|zh|ja)$")


def source_text(body: "TranslationRequest") -> str:
    """The span the model translates: hesitations removed, the user's listed mishearings and the
    meeting's learned misheard names corrected."""
    text = apply_aliases(clean_speech(repair_asr(strip_context_echo(body.text, body.glossary)), body.source), body.glossary)
    return apply_aliases(text, learned_replacements(body.learned))


def clean_speech(text: str, source: str) -> str:
    if source != "zh":
        return text
    # Remove clear hesitation sounds, but preserve meaningful 那個/就是說 and
    # ordinary reduplication (人人、看看), names, numbers and corrections.
    cleaned = re.sub(r"(?i)(?<![a-z])n[八8]n(?![a-z])", "n8n", text)
    if any(word in text for word in ("工作流", "流程", "引擎", "自動化", "自动化", "節點", "节点")):
        cleaned = re.sub(r"(?i)(?<![a-z])n班(?![a-z])", "n8n", cleaned)
    cleaned = re.sub(r"[呃嗯哦]+[，,、\s]*", "", cleaned)
    cleaned = re.sub(r"([我你他她])\1{2,}", r"\1", cleaned)
    cleaned = re.sub(r"([我你他她])\1(?=們|们)", r"\1", cleaned)
    cleaned = re.sub(r"(我們|我们|你們|你们|總務|总务)(?:[，,、\s]*\1)+", r"\1", cleaned)
    return cleaned.strip() or text


def interpreter_rules(target: str) -> str:
    rules = "You are a professional live interpreter. Translate EVERY clause in order; do not summarize or skip introductory technical explanations. Output only the translation, once. Remove only meaningless stutters and fillers. Preserve facts, contrasts, negation, uncertainty, names, numbers and self-corrections; never add facts or placeholders. If speech is unfinished, translate only the available meaning without inventing its ending."
    if target == "ja":
        rules += (
            " 將口語整理成自然精簡的商務日文です・ます體；避免反覆使用〜んです、〜のだ，勿過度敬語。"
            "依上下文選詞：共享服務→シェアードサービス；集團公司→グループ会社；"
            "分公司→支社（勿與子公司混淆）；事務經費→事務経費；付款申請→支払申請；"
            "費用報銷→経費精算；改善案→業務改善策。"
            "IT術語：n8n保留原名（勿自行添加工具介紹）；工作流/工作流程→ワークフロー；"
            "網頁模式→Web UI；本地端引擎→ローカル実行エンジン；"
            "SOP→標準業務手順（SOP）；動作→アクション；觸發器→トリガー；串聯→連携する。"
            "例：我我我們做了一個改善案。→私たちは業務改善策に取り組みました。"
            "例：總務哦總務人員在加班。→総務の担当者が残業していました。"
        )
    return rules + (" IT語境：資料搬運→データ転記・連携・移行；敲Excel→Excelへの手入力；導到Excel→Excelへのエクスポート。作業を自動化する、効率を向上させる，不可把效率自動化。你會發現若是修辭引導，用実際には等自然銜接，勿誤譯為已經發現。" if target == "ja" else "")


def resolve_translation_direction(body: TranslationRequest) -> tuple[str, str]:
    if body.source != "zh_ja":
        return body.source, body.target
    # Prefer the language recognized from audio: kanji-only Japanese cannot
    # reliably be distinguished from Chinese using characters alone.
    source = body.detected_language
    if not source:
        source = "ja" if any("\u3040" <= char <= "\u30ff" or "\uff66" <= char <= "\uff9d" for char in body.text) else "zh"
    return source, "zh" if source == "ja" else "ja"


def detect_pair_language(text: str, hint: str = "", previous: str = "") -> str:
    recognized = {"Chinese": "zh", "Japanese": "ja", "zh": "zh", "ja": "ja"}.get(hint, "")
    if recognized:
        return recognized
    if any("\u3040" <= char <= "\u30ff" or "\uff66" <= char <= "\uff9d" for char in text):
        return "ja"
    if any("\u3400" <= char <= "\u9fff" for char in text):
        return "zh"
    return previous


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.put("/api/meetings/{name}")
async def save_meeting_file(name: str, request: Request):
    """Store one meeting's recording or transcript; the fixed name pattern keeps writes inside OUTPUT_DIR."""
    if not MEETING_FILE.fullmatch(name):
        raise HTTPException(status_code=400, detail="invalid meeting file name")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    partial, size = OUTPUT_DIR / f".{name}.part", 0
    try:
        with partial.open("wb") as file:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_MEETING_BYTES:
                    raise HTTPException(status_code=413, detail="meeting file too large")
                file.write(chunk)
        partial.replace(OUTPUT_DIR / name)
    finally:
        partial.unlink(missing_ok=True)
    logger.info("saved meeting file %s bytes=%d", name, size)
    return {"saved": f"output/{name}", "bytes": size}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/config")
async def config():
    return {"cloudRefine": bool(REFINE_URL and REFINE_MODEL)}


def translation_backend(body: "TranslationRequest", payload: dict) -> tuple[str, dict, dict]:
    """(url, headers, payload): the cloud model for refinements when configured, else local llama.cpp."""
    if not (body.refine and REFINE_URL and REFINE_MODEL):
        return f"{TRANSLATE_URL}/v1/chat/completions", {}, payload
    # llama.cpp-only sampling options are not part of the OpenAI API.
    cloud = {k: v for k, v in payload.items() if k not in ("repeat_penalty", "chat_template_kwargs", "top_p")}
    headers = {"Authorization": f"Bearer {REFINE_KEY}"} if REFINE_KEY else {}
    # Reasoning models (deepseek-v4-flash) spend max_tokens on thinking first; an exact budget
    # returns an empty translation, so leave room for it. Refinements run in the background.
    budget = payload.get("max_tokens", 512) + 4096
    return f"{REFINE_URL}/chat/completions", headers, {**cloud, "model": REFINE_MODEL, "max_tokens": budget}


@app.post("/api/translate")
async def translate(body: TranslationRequest):
    source, target = resolve_translation_direction(body)
    metadata = {"source": source, "target": target} if body.source == "zh_ja" else {}
    body = body.model_copy(update={"source": source, "target": target})
    if body.source == body.target:
        return {"translatedText": TO_TRADITIONAL.convert(body.text) if body.target in ("zh", "yue") else body.text}
    source_name = "the detected input language" if body.source == "auto" else LANGUAGES[body.source][0]
    target_name = LANGUAGES[body.target][1]
    prompt = (
        f"Translate only the new {source_name} speech segment into natural {target_name}. "
        "Translate it exactly once. Preserve its meaning, names, numbers, and punctuation. "
        "Return only the translation; do not explain, add labels, or repeat any context.\n"
        f"Translate this segment only:\n{body.text}"
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{TRANSLATE_URL}/v1/chat/completions",
                json={**translation_payload(body), "stream": False},
            )
            response.raise_for_status()
            payload = response.json()
            if payload["choices"][0].get("finish_reason") == "length":
                raise ValueError("translation exceeded output limit; original text retained")
            translated = payload["choices"][0]["message"]["content"].strip()
            if not translated:
                raise ValueError("translation model returned an empty response")
            if body.target in ("zh", "yue"):
                translated = TO_TRADITIONAL.convert(translated)
            return {"translatedText": translated, **metadata}
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Translation service unavailable: {exc}") from exc


class TermsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4_000)
    source: str = Field(pattern=LANGUAGE_PATTERN)
    # Earlier passes' findings in this meeting; they are re-voted together with this one.
    previous: list[str] = Field(default_factory=list, max_length=40)


@app.post("/api/terms")
async def discover_terms(body: TermsRequest):
    """Learn this meeting's names and their mishearings from its recent transcript."""
    language = {"auto": "multilingual", "zh_ja": "Chinese and Japanese"}.get(body.source) or LANGUAGES[body.source][0]
    known = consolidate_terms(body.previous)
    payload = {"model": TRANSLATE_MODEL, "temperature": 0, "max_tokens": 400, "stream": False,
               "chat_template_kwargs": {"enable_thinking": False},
               "response_format": {"type": "json_schema", "json_schema": {"name": "terms", "schema": TERMS_SCHEMA}},
               "messages": term_discovery_messages(body.text, language, known)}
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{TRANSLATE_URL}/v1/chat/completions", json=payload)
            response.raise_for_status()
            output = response.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Term discovery unavailable: {exc}") from exc
    found = parse_discovered_terms(output, body.text)
    learned = consolidate_terms([*body.previous, found])
    logger.info("terms found=%r learned=%r elapsed_ms=%.0f", found, learned, (time.monotonic() - started) * 1000)
    # Forms the translator now replaces; finalized spans containing them are worth re-translating.
    replaced = sorted({form for _, forms in glossary_entries(learned_replacements(learned)) for form in forms})
    return {"found": found, "learned": learned, "replaced": replaced}


def following_note(body: TranslationRequest) -> str:
    """Before Speech: placed after it, the model kept translating it as part of the span
    ("…before going to large scale…" appeared in two consecutive spans)."""
    following = body.following.strip()[:160]
    if not following:
        return ""
    return ("Next words, a separate segment that is translated later (context only; do not include them, "
            f"the translation ends where Speech ends even mid-sentence): {following}\n")


def translation_payload(body: TranslationRequest) -> dict:
    source, target = resolve_translation_direction(body)
    body = body.model_copy(update={"source": source, "target": target})
    source_name = "the detected language" if body.source == "auto" else LANGUAGES[body.source][0]
    target_name = LANGUAGES[body.target][1]
    instruction = (
        f"Translate the following {source_name} speech into natural {target_name}. "
        "Return only the translation. Preserve names and numbers."
    )
    # The preceding finalized span resolves pronouns and keeps terms consistent. It is
    # labelled as already translated so the model does not repeat it.
    context = ""
    if body.history.strip():
        context = f"Already translated, for context only (do not translate or repeat): {body.history.strip()[-500:]}\n"
        if body.history_translation.strip():
            context += f"Its translation (reuse its terminology): {body.history_translation.strip()[-600:]}\n"
    # Drafts and the final of a span share everything up to here, so the server's prompt
    # cache covers the system prompt and context; only the draft note and speech differ.
    if body.draft:
        context += ("This is live, unfinished speech; translate what is present without inventing "
                    "an ending or placeholder symbols.\n")
    return {
        "model": TRANSLATE_MODEL,
        "temperature": 0,
        "top_p": 0.9,
        "repeat_penalty": 1.0,
        "max_tokens": min(512 if body.draft else 1024, max(128, len(body.text) * 4)),
        "stream": True,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [
            {"role": "system", "content": policy(source_text(body), body.target, glossary=body.glossary, learned=body.learned)},
            {"role": "user", "content": f"{instruction}\n{context}{following_note(body)}Speech: {source_text(body)}"},
        ],
    }


@app.post("/api/translate/stream")
async def translate_stream(body: TranslationRequest):
    source, target = resolve_translation_direction(body)
    metadata = {"source": source, "target": target} if body.source == "zh_ja" else {}
    body = body.model_copy(update={"source": source, "target": target})
    async def events():
        started = time.monotonic()
        request_id = uuid.uuid4().hex[:8]
        logger.info("translation id=%s source=%s target=%s chars=%s draft=%s", request_id, source, target, len(body.text), body.draft)
        if body.source == body.target:
            result = TO_TRADITIONAL.convert(body.text) if body.target in ("zh", "yue") else body.text
            yield f"data: {json.dumps({'text': result, 'done': True}, ensure_ascii=False)}\n\n"
            return
        raw = ""
        try:
            timeout = httpx.Timeout(connect=5, read=60, write=10, pool=5)
            async with httpx.AsyncClient(timeout=timeout) as client:
                url, headers, payload = translation_backend(body, translation_payload(body))
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        part = json.loads(data)
                        if part.get("choices", [{}])[0].get("finish_reason") == "length":
                            raise ValueError("translation exceeded output limit; original text retained")
                        if "error" in part:
                            raise ValueError(str(part["error"]))
                        delta = part.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if isinstance(delta, str) and delta:
                            raw += delta
                            visible = TO_TRADITIONAL.convert(raw) if body.target in ("zh", "yue") else raw
                            yield f"data: {json.dumps({'text': visible, 'done': False, **metadata}, ensure_ascii=False)}\n\n"
            if not raw.strip():
                raise ValueError("translation model returned an empty response")
            problems = violations(source_text(body), raw, body.target, body.glossary)
            if problems and not body.draft:
                # One bounded repair, grounded only in the same source span.
                logger.info("translation id=%s repairing: %s", request_id, problems)
                repair = translation_payload(body)
                repair["stream"] = False
                repair["messages"][0]["content"] += "\nMandatory checks: " + " ".join(problems)
                url, headers, repair = translation_backend(body, repair)
                async with httpx.AsyncClient(timeout=30) as client:
                    corrected = await client.post(url, json=repair, headers=headers)
                    corrected.raise_for_status()
                    choice = corrected.json()["choices"][0]
                    # A truncated repair is unusable; the first complete attempt is kept instead.
                    repaired = "" if choice.get("finish_reason") == "length" else choice["message"]["content"].strip()
                remaining = violations(source_text(body), repaired, body.target, body.glossary) if repaired else problems
                # Rejecting a final would stall every later sentence behind it; keep the better attempt.
                if repaired and len(remaining) <= len(problems):
                    raw, problems = repaired, remaining
                if problems:
                    logger.warning("translation id=%s kept with unresolved checks: %s", request_id, problems)
            visible = TO_TRADITIONAL.convert(raw.strip()) if body.target in ("zh", "yue") else raw.strip()
            logger.info("translation id=%s completed output_chars=%s elapsed_ms=%.0f", request_id, len(visible), (time.monotonic() - started) * 1000)
            yield f"data: {json.dumps({'text': visible, 'done': True, **metadata}, ensure_ascii=False)}\n\n"
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            logger.warning("translation id=%s failed: %s", request_id, exc)
            yield f"data: {json.dumps({'error': f'Translation service unavailable: {exc}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.websocket("/ws/transcribe")
async def transcribe(browser: WebSocket):
    await browser.accept()
    try:
        raw_header = await browser.receive_text()
        header = json.loads(raw_header)
        glossary = str(header.get("system_prompt", ""))[:4000]
        bilingual = header.get("language") == "zh_ja"
        chinese_display = header.get("language", "auto") in ("auto", "zhen", "zh", "Chinese", "yue", "Cantonese")
        safe_header = {
            "channels": 1,
            "sample_rate": 16000,
            "requestId": str(header.get("requestId") or uuid.uuid4()),
            "language": LANGUAGES.get(header.get("language"), (None,))[0] or "zhen",
            "use_vad": bilingual or bool(header.get("use_vad", False)),
            "secret_key": ASR_SECRET_KEY,
            "mode": "slow",
            "system_prompt": asr_context(glossary),
        }
        async with websockets.connect(ASR_WS_URL, ping_interval=None, max_size=None) as upstream:
            await upstream.send(json.dumps(safe_header, ensure_ascii=False))
            raw_transcript = ""
            display_transcript = ""
            detected_language = ""

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
                nonlocal raw_transcript, display_transcript, detected_language
                async for message in upstream:
                    if isinstance(message, bytes):
                        await browser.send_bytes(message)
                    else:
                        try:
                            payload = json.loads(message)
                            chunk = payload.get("msg", {}).get("text", "")
                            if bilingual and isinstance(payload.get("msg"), dict):
                                language = detect_pair_language(chunk if isinstance(chunk, str) else "", payload["msg"].get("language"), detected_language)
                                detected_language = language
                                payload["detectedLanguage"] = language
                                if isinstance(chunk, str) and chunk:
                                    display_transcript += TO_TRADITIONAL.convert(chunk) if language == "zh" else chunk
                                    payload["displayText"] = apply_aliases(repair_asr(strip_context_echo(display_transcript, glossary)), glossary)
                                if payload["msg"].get("reset"):
                                    detected_language = ""
                            if isinstance(chunk, str) and chunk:
                                raw_transcript += chunk
                                if not bilingual:
                                    display = TO_TRADITIONAL.convert(raw_transcript) if chinese_display else raw_transcript
                                    payload["displayText"] = apply_aliases(repair_asr(strip_context_echo(display, glossary)), glossary)
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
            if browser.client_state == WebSocketState.CONNECTED:
                await browser.close()
    except (WebSocketDisconnect, websockets.ConnectionClosed):
        pass
    except Exception as exc:
        try:
            await browser.send_json({"status": "error", "msg": str(exc)})
        except Exception:
            pass
