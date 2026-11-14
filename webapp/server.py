import asyncio
import contextlib
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import websockets
from opencc import OpenCC
from fastapi.exception_handlers import http_exception_handler
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketState
import auth
import db
import diarize
import mai_asr
import mai_usage
import mailer
import meeting_audio
import actions
import minutes
import review
import series
import stream_limits
import metrics
import qa
import quality_pass
import reminders
import response_headers
import search
import team_access
from translation_quality import (TERMS_SCHEMA, apply_aliases, asr_context, consolidate_terms, glossary_entries, learned_replacements,
                                 parse_discovered_terms, policy, repair_asr, strip_context_echo, term_discovery_messages, violations)

ASR_WS_URL = os.getenv("ASR_WS_URL", "ws://asr:8272/asr_stream_api_v1")
ASR_SECRET_KEY = os.getenv("ASR_SECRET_KEY", "change-me-local-only")
TRANSLATE_URL = os.getenv("TRANSLATE_URL", "http://translate:5000").rstrip("/")
TRANSLATE_MODEL = os.getenv("TRANSLATE_MODEL", "gemma-4-E2B_q4_0-it.gguf")
# With a key, TRANSLATE_URL is an OpenAI-compatible service outside this machine (cloud-translation): every
# translation and term-discovery request carries the key, loses the llama.cpp-only options and takes TRANSLATE_EXTRA
# (JSON, e.g. reasoning off so drafts stay fast). Meeting text then always leaves the machine; the page says so.
TRANSLATE_KEY = os.getenv("TRANSLATE_KEY", "")
LLAMA_ONLY = ("repeat_penalty", "chat_template_kwargs", "top_p")   # not part of the OpenAI API


def translate_extra(text: str) -> dict:
    """TRANSLATE_EXTRA as a dict; anything but a JSON object is ignored with a warning."""
    try:
        value = json.loads(text or "{}")
    except ValueError:
        value = None
    if not isinstance(value, dict):
        logging.getLogger("uvicorn.error").warning("TRANSLATE_EXTRA is not a JSON object; ignored")
        return {}
    return value


def translation_health_url(url: str, override: str = "") -> str:
    """What 服務狀態 checks for the translation model: TRANSLATE_HEALTH_URL, or TRANSLATE_URL + /health."""
    return override.strip() or f"{url}/health"


TRANSLATE_EXTRA = translate_extra(os.getenv("TRANSLATE_EXTRA", ""))
TRANSLATE_HEALTH_URL = translation_health_url(TRANSLATE_URL, os.getenv("TRANSLATE_HEALTH_URL", ""))
# Optional OpenAI-compatible cloud model for the delayed refinement pass only. Unset = fully local.
# Meeting text is sent to that service only when the user turns 雲端精修 on.
REFINE_URL = os.getenv("TRANSLATE_REFINE_URL", "").rstrip("/")
REFINE_MODEL = os.getenv("TRANSLATE_REFINE_MODEL", "")
REFINE_KEY = os.getenv("TRANSLATE_REFINE_KEY", "")
# Chinese MAI punctuation must come back within a pause, so the cloud model is asked not to reason.
# Off by default: in the 2026-11-03 benchmark (bench/README.md) the model ended items with 。 that the
# speaker had not finished, and MAI Chinese scored 73.7 with it vs 80.7 with pause-rule marks.
PUNCTUATE_MAI = os.getenv("TRANSLATE_PUNCTUATE_MAI", "") == "1"
PUNCTUATE_EXTRA = json.loads(os.getenv("TRANSLATE_PUNCTUATE_EXTRA", "") or '{"thinking": {"type": "disabled"}}')
STATIC_DIR = Path(__file__).resolve().parent / "static"
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

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # An unreachable database or a failed migration stops the app instead of failing on first sign-in.
    await db.check()
    await minutes.recover_interrupted()
    # 問答 index (meeting-qa) in the background; without EMBED_URL 問答 uses keyword retrieval only.
    indexing = asyncio.create_task(qa.indexer()) if qa.EMBED_URL else None
    # Speaker diarization (speaker-diarization) after meetings; without DIARIZE_URL segments get no speakers.
    diarizing = asyncio.create_task(diarize.worker()) if diarize.configured() else None
    # Due-date reminders to action item owners (action-reminders); without SMTP_HOST nothing is mailed.
    reminding = asyncio.create_task(reminders.worker()) if mailer.configured() else None
    logger.info("system administrators (ADMIN_USERS): %s", ", ".join(sorted(auth.ADMIN_USERS)) or "none")
    yield
    for task in (indexing, diarizing, reminding):
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="語橋 Live — 即時會議翻譯", lifespan=lifespan, dependencies=[Depends(auth.require_signed_in)])
app.add_middleware(response_headers.ResponseHeaders)
app.add_exception_handler(Exception, response_headers.server_error)
app.include_router(auth.router)
app.include_router(team_access.router)
app.include_router(review.router)
# Before minutes: its /items/{id}/{action} would otherwise take /items/{id}/status.
app.include_router(actions.router)
app.include_router(minutes.router)
app.include_router(mailer.router)
app.include_router(series.router)
app.include_router(metrics.router)
app.include_router(mai_usage.router)
app.include_router(search.router)
app.include_router(qa.router)
app.include_router(diarize.router)
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


@app.exception_handler(404)
async def not_found(request: Request, error):
    """A person following a broken link gets a page with a way on; API clients and assets keep the JSON
    (not-found-page). Public on purpose: it shows nothing and calls no API."""
    page = (request.method == "GET" and "text/html" in request.headers.get("accept", "")
            and not request.url.path.startswith(("/api/", "/assets/")))
    if page:
        # Not FileResponse: it answers a Range header with 206 whatever the status asked for.
        return HTMLResponse((STATIC_DIR / "not-found.html").read_text(encoding="utf-8"), status_code=404, headers={"Cache-Control": "no-cache"})
    return await http_exception_handler(request, error)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Browsers ask the root for it (bookmarks, tabs before the page loads); the pages also link it."""
    return FileResponse(STATIC_DIR / "favicon.ico", media_type="image/x-icon", headers={"Cache-Control": "public, max-age=86400"})


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
    # The draft the page shows for the beginning of this speech (smooth-subtitles); only used for drafts.
    previous_draft: str = Field(default="", max_length=600)
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


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/config")
async def config():
    return {"cloudRefine": bool(REFINE_URL and REFINE_MODEL), "mai": mai_asr.configured(), "minutes": minutes.configured(),
            "quality": quality_pass.configured(), "cloudTranslate": bool(TRANSLATE_KEY)}


def asr_health_url(ws_url: str, override: str = "") -> str:
    """The local ASR's /health URL: ASR_HEALTH_URL, or ASR_WS_URL with http(s) and the path /health."""
    if override:
        return override
    scheme, _, rest = ws_url.partition("://")
    return f"{'https' if scheme == 'wss' else 'http'}://{rest.split('/', 1)[0]}/health"


ASR_HEALTH_URL = asr_health_url(ASR_WS_URL, os.getenv("ASR_HEALTH_URL", ""))
SERVICE_TIMEOUT_S = 2.0


async def service_ok(url: str) -> bool:
    """True only when the service answers HTTP 200 within SERVICE_TIMEOUT_S."""
    try:
        async with httpx.AsyncClient(timeout=SERVICE_TIMEOUT_S) as client:
            return (await client.get(url)).status_code == 200
    except httpx.HTTPError:
        return False


async def database_ok() -> bool:
    async def query():
        async with db.connect() as conn:
            await conn.execute("SELECT 1")
    try:
        await asyncio.wait_for(query(), SERVICE_TIMEOUT_S)
        return True
    except Exception:   # unreachable, timed out or failing: the page only needs "not ready"
        return False


@app.get("/api/services")
async def services():
    """Whether the local services meetings depend on are ready (service-status); generic names only, no URLs or errors."""
    checks = await asyncio.gather(service_ok(ASR_HEALTH_URL), service_ok(TRANSLATE_HEALTH_URL), database_ok())
    entries = [{"key": key, "name": name, "ok": ok}
               for (key, name), ok in zip((("asr", "語音辨識"), ("translate", "翻譯"), ("database", "資料庫")), checks)]
    return {"ready": all(checks), "services": entries}


def asr_engine(choice: str, language: str) -> str:
    """'mai' or 'local'. 混合 keeps Chinese, and the modes that may contain it, on the local model."""
    if not mai_asr.configured():
        return "local"
    if choice == "mai" or (choice == "hybrid" and language not in ("zh", "auto", "zh_ja", "yue")):
        return "mai"
    return "local"


def refine_headers() -> dict:
    return {"Authorization": f"Bearer {REFINE_KEY}"} if REFINE_KEY else {}


async def punctuate_item(context: str, text: str, pause: bool) -> str:
    """Punctuation for one committed MAI Chinese item from the cloud text model; only its marks are used."""
    messages = [
        {"role": "system", "content": "你是語音辨識的標點修復器。為 TEXT 加上全形標點（，。？！、：；「」）。"
                                      "不得增加、刪除或替換任何字，也不要轉換繁簡，只輸出加好標點的 TEXT。"
                                      "結尾一定要有標點：句子已完整用。？！，話還沒說完用，。"},
        {"role": "user", "content": f"前文（僅供判斷，不要輸出）：{context[-120:]}\n"
                                    f"說話者在 TEXT 之後{'停頓' if pause else '結束發言'}。\nTEXT：{text}"},
    ]
    payload = {"model": REFINE_MODEL, "messages": messages, "temperature": 0, "max_tokens": len(text) * 2 + 32, **PUNCTUATE_EXTRA}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.post(f"{REFINE_URL}/chat/completions", json=payload, headers=refine_headers())
            response.raise_for_status()
            answer = response.json()["choices"][0]["message"]["content"] or ""
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
        logger.warning("punctuation failed: %s", exc)
        return ""
    return mai_asr.merge_marks(text, answer.strip().removeprefix("TEXT："), TO_TRADITIONAL.convert)


def translation_request(payload: dict) -> tuple[dict, dict]:
    """(headers, payload) for the translation model: as built for local llama.cpp, or for the keyed external service."""
    if not TRANSLATE_KEY:
        return {}, payload
    return {"Authorization": f"Bearer {TRANSLATE_KEY}"}, {**{k: v for k, v in payload.items() if k not in LLAMA_ONLY}, **TRANSLATE_EXTRA}


def translation_backend(body: "TranslationRequest", payload: dict) -> tuple[str, dict, dict]:
    """(url, headers, payload): the cloud model for refinements when configured, else the translation model."""
    if not (body.refine and REFINE_URL and REFINE_MODEL):
        return f"{TRANSLATE_URL}/v1/chat/completions", *translation_request(payload)
    cloud = {k: v for k, v in payload.items() if k not in LLAMA_ONLY}
    headers = refine_headers()
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
            headers, request = translation_request({**translation_payload(body), "stream": False})
            response = await client.post(f"{TRANSLATE_URL}/v1/chat/completions", json=request, headers=headers)
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
    if TRANSLATE_KEY:
        # External services differ on JSON schemas; a JSON object with the schema in the prompt works everywhere.
        payload["response_format"] = {"type": "json_object"}
        payload["messages"][0]["content"] += "\nAnswer with one JSON object of this schema: " + json.dumps(TERMS_SCHEMA)
    headers, payload = translation_request(payload)
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{TRANSLATE_URL}/v1/chat/completions", json=payload, headers=headers)
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
        # The reader already sees a draft of the beginning: rewording it makes the subtitle flicker.
        if body.previous_draft.strip():
            context += ("The reader already sees this draft for the beginning of the speech: "
                        f"{body.previous_draft.strip()}\n"
                        "Continue it: keep its wording for the part it covers unless it is wrong, and add the translation of the rest.\n")
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


class TranscriptDisplay:
    """What the browser shows for either ASR engine: Traditional script for Chinese, the meeting glossary's
    corrections, and per-chunk zh/ja detection in 中日雙向 mode."""

    def __init__(self, language: str, glossary: str, audio: "meeting_audio.MeetingAudio | None" = None):
        self.glossary, self.bilingual, self.audio = glossary, language == "zh_ja", audio
        self.chinese = language in ("auto", "zhen", "zh", "Chinese", "yue", "Cantonese")
        self.raw = self.pair_text = self.detected = ""
        self.quality = None   # 精準模式: told what the browser is shown, to compare with its own recognition

    def render(self, text: str) -> str:
        return apply_aliases(repair_asr(strip_context_echo(text, self.glossary)), self.glossary)

    def annotate(self, payload: dict) -> None:
        # Gateway audio clock when the event went out; the browser times its segments with it.
        if self.audio is not None:
            payload["audioMs"] = self.audio.position_ms
        elif self.quality is not None:
            # 即時翻譯 keeps no recording, but the page needs the clock to know which live text a quality event replaces.
            payload["audioMs"] = self.quality.fed_ms
        msg = payload.get("msg")
        if not isinstance(msg, dict):
            return
        chunk = msg.get("text") if isinstance(msg.get("text"), str) else ""
        if self.bilingual:
            self.detected = detect_pair_language(chunk, msg.get("language"), self.detected)
            payload["detectedLanguage"] = self.detected
            if chunk:
                self.pair_text += TO_TRADITIONAL.convert(chunk) if self.detected == "zh" else chunk
                payload["displayText"] = self.render(self.pair_text)
            if msg.get("reset"):
                self.detected = ""
        if chunk:
            self.raw += chunk
            if not self.bilingual:
                payload["displayText"] = self.render(TO_TRADITIONAL.convert(self.raw) if self.chinese else self.raw)
        if self.quality is not None and isinstance(payload.get("displayText"), str):
            self.quality.live(payload["displayText"])

    def tentative(self, text: str) -> str:
        """MAI's intermediate (not yet confirmed) text as the browser shows it: Traditional script for Chinese."""
        chinese = self.chinese or (self.bilingual and self.detected == "zh")
        return TO_TRADITIONAL.convert(text) if chinese and text else text

    def rewrite(self, start: int, text: str) -> None:
        """Replace the raw transcript from `start` (a punctuated MAI item); shown with the next chunk.
        中日雙向 builds its text per chunk, so it is never rewritten."""
        if not self.bilingual:
            self.raw = self.raw[:start] + text


async def finish_recording(audio: "meeting_audio.MeetingAudio", meeting_id) -> None:
    """Close the WAV and record its length; shielded so a cancelled handler still finishes it."""
    recorded = audio.close()
    async with db.connect() as conn:
        await conn.execute("UPDATE meetings SET audio_bytes = %s, ended_at = now() WHERE id = %s", (recorded, meeting_id))
    await diarize.recording_closed(meeting_id, recorded)


@app.websocket("/ws/transcribe")
async def transcribe(browser: WebSocket):
    await browser.accept()
    if browser.state.user is None:
        await browser.close(code=4401, reason="請先登入")
        return
    user = browser.state.user
    if not stream_limits.take_place(user.username):
        # The reason is what the live page shows (stream-limits).
        await browser.close(code=4429, reason=stream_limits.TOO_MANY.format(n=stream_limits.MAX_STREAMS_PER_USER))
        return
    audio, meeting, quality = None, None, None
    try:
        try:
            raw_header = await asyncio.wait_for(browser.receive_text(), stream_limits.STREAM_HEADER_TIMEOUT)
        except asyncio.TimeoutError:
            await browser.close(code=4408, reason=stream_limits.NO_START)
            return
        header = json.loads(raw_header)
        # 即時翻譯 (live-translation): no meeting, nothing kept — audio goes to the engine and the events come back.
        translate_only = header.get("mode") == "translate"
        if not translate_only:
            # The meeting must belong to one of the user's teams before any audio leaves for ASR or MAI.
            try:
                async with db.connect() as conn:
                    meeting = await team_access.require_member(conn, browser.state.user, header.get("meeting_id", ""))
            except HTTPException:
                await browser.close(code=4404, reason="meeting not found")
                return
            # The recording is exactly the audio sent to ASR/MAI, so it shares the transcript's timeline.
            # One connection per meeting: a second one must not truncate the first recording.
            try:
                audio = meeting_audio.MeetingAudio(team_access.meeting_dir(meeting) / "audio.wav")
            except FileExistsError:
                await browser.close(code=4409, reason="meeting already recorded")
                return
        glossary = str(header.get("system_prompt", ""))[:4000]
        language = header.get("language") if header.get("language") in ("auto", "zh_ja", *LANGUAGES) else "auto"
        bilingual = language == "zh_ja"
        display = TranscriptDisplay(language, glossary, audio)
        # Both engines read the browser through the guard: audio length, session and membership are checked there.
        guarded = stream_limits.StreamGuard(browser, user, browser.cookies.get(auth.SESSION_COOKIE), meeting)
        # 精準模式 (quality-pass): only when the browser asked for it and the service is configured. The same
        # audio the engine gets is re-recognized in chunks; results go back on this connection.
        if header.get("quality") is True and quality_pass.configured():
            async def quality_event(payload: dict) -> None:
                if browser.client_state == WebSocketState.CONNECTED:
                    await browser.send_text(json.dumps(payload, ensure_ascii=False))
            quality = quality_pass.QualityPass(quality_event, language, str(header.get("target", "")), glossary, TO_TRADITIONAL.convert,
                                               LANGUAGES.get(language, (None,))[0] or "zhen")
            display.quality = quality
            guarded = quality_pass.TeeReceiver(guarded, quality.feed)
        if asr_engine(str(header.get("engine", "")), language) == "mai":
            # Audio goes to Azure; text goes to the cloud text model only when 雲端精修 is on.
            cloud_marks = PUNCTUATE_MAI and bool(header.get("refine")) and language == "zh" and bool(REFINE_URL and REFINE_MODEL)
            await mai_asr.MaiBridge(guarded, language, display, punctuate_item if cloud_marks else None).run()
            if quality is not None and browser.client_state == WebSocketState.CONNECTED:
                await quality.finish()   # the last sentences, then the connection closes
            if browser.client_state == WebSocketState.CONNECTED:
                await browser.close()
            return
        safe_header = {
            "channels": 1,
            "sample_rate": 16000,
            # Ours, never the browser's: the ASR service builds file paths from it.
            "requestId": str(uuid.uuid4()),
            "language": LANGUAGES.get(header.get("language"), (None,))[0] or "zhen",
            "use_vad": bilingual or bool(header.get("use_vad", False)),
            "secret_key": ASR_SECRET_KEY,
            "mode": "slow",
            "system_prompt": asr_context(glossary),
        }
        if translate_only:
            safe_header["retain"] = False  # 即時翻譯 keeps nothing: the ASR request log never gets its text
        async with websockets.connect(ASR_WS_URL, ping_interval=None, max_size=None) as upstream:
            await upstream.send(json.dumps(safe_header, ensure_ascii=False))

            async def browser_to_asr():
                while True:
                    event = await guarded.receive()
                    if event.get("type") == "websocket.disconnect":
                        return
                    if event.get("bytes") is not None:
                        if audio is not None:
                            audio.write(event["bytes"])
                        await upstream.send(event["bytes"])
                    elif event.get("text") is not None:
                        await upstream.send(event["text"])

            async def asr_to_browser():
                async for message in upstream:
                    if isinstance(message, bytes):
                        await browser.send_bytes(message)
                    else:
                        try:
                            payload = json.loads(message)
                            if isinstance(payload, dict):
                                display.annotate(payload)
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
            if quality is not None and browser.client_state == WebSocketState.CONNECTED:
                await quality.finish()   # the last sentences, then the connection closes
            if browser.client_state == WebSocketState.CONNECTED:
                await browser.close()
    except stream_limits.StreamStopped as stop:
        if browser.client_state == WebSocketState.CONNECTED:
            await browser.close(code=stop.code, reason=stop.reason)
    except (WebSocketDisconnect, websockets.ConnectionClosed):
        pass
    except Exception as exc:
        try:
            await browser.send_json({"status": "error", "msg": str(exc)})
        except Exception:
            pass
    finally:
        if quality is not None:
            quality.cancel()   # no-op after finish(); stops the requests when the browser left
        stream_limits.free_place(user.username)
        if audio is not None:
            await asyncio.shield(finish_recording(audio, meeting["id"]))
