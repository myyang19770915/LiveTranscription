"""精準模式 (quality-pass): the meeting audio is cut at pauses, re-recognized by a stronger offline recognizer,
and one text-model request per chunk repairs, segments and translates it. The results go back on the
recognition WebSocket and replace the live text for the same time range.

Opt-in and off unless configured: audio and text leave for the external service only when the stream header
asks for it. A failed chunk never ends the stream; the live result of that range simply stays.
"""
import array
import asyncio
import io
import json
import logging
import math
import os
import re
import time
import unicodedata
import wave
from collections import deque
from dataclasses import dataclass, field

import httpx

import chunk_asr
import mai_asr

logger = logging.getLogger("uvicorn.error")

URL = (os.getenv("TRANSLATE_QUALITY_URL", "") or os.getenv("TRANSLATE_REFINE_URL", "")).rstrip("/")
KEY = os.getenv("TRANSLATE_QUALITY_KEY", "") or os.getenv("TRANSLATE_REFINE_KEY", "")
ASR_MODEL = os.getenv("TRANSLATE_QUALITY_ASR_MODEL", "")
# The recognizer may live elsewhere than the text model (a recognizer on this machine): its own address, and its own
# key so the text service's key is never sent there.
ASR_URL = os.getenv("TRANSLATE_QUALITY_ASR_URL", "").rstrip("/")
ASR_KEY = os.getenv("TRANSLATE_QUALITY_ASR_KEY", "")
MODEL = os.getenv("TRANSLATE_QUALITY_MODEL", "")
# Who hears each chunk again: empty = the transcriptions API of URL (ASR_MODEL); "local" or "mai" = the app's own
# engine (chunk_asr.py), so with "local" no audio leaves the machine; "hybrid" = the transcriptions API for Chinese
# and MAI for every other language (bench/README.md 2026-11-14: Qwen3-ASR led on Chinese, MAI elsewhere).
# Any other value leaves the quality pass off.
ASR = os.getenv("TRANSLATE_QUALITY_ASR", "").strip().lower()
# Off by default: the benchmarked configuration (bench/README.md) ran without the live text.
USE_ALT = os.getenv("TRANSLATE_QUALITY_ALT", "") == "1"


def _extra(name: str = "TRANSLATE_QUALITY_EXTRA") -> dict:
    """TRANSLATE_QUALITY_EXTRA: JSON merged into the text-model request (reasoning settings differ by model)."""
    try:
        value = json.loads(os.getenv(name, "") or "{}")
    except ValueError:
        logger.warning("%s is not valid JSON; ignored", name)
        return {}
    return value if isinstance(value, dict) else {}


EXTRA = _extra()
# Form fields added to the transcription request (TRANSLATE_QUALITY_ASR_EXTRA, JSON), e.g. {"max_completion_tokens": 400}
# for Qwen3-ASR on vLLM: without a limit a repetition loop runs to the model's full length (28 s measured).
ASR_EXTRA = {key: str(value) for key, value in _extra("TRANSLATE_QUALITY_ASR_EXTRA").items()}
# A recognizer stuck in a loop repeats a short unit until it is cut off ("はい。はい。はい。…").
LOOP = re.compile(r"(.{2,12}?)\1{4,}", re.S)


def without_loop(text: str) -> str:
    """`text` with a repetition loop at its end (a unit of 2-12 characters, five times or more) reduced to one unit."""
    for match in LOOP.finditer(text):
        unit, rest = match.group(1), text[match.end():]
        if len(set(unit)) == 1:   # one character repeated ("哈哈哈…", the zeros of a number) is speech, not a loop
            continue
        if len(rest) < len(unit) and unit.startswith(rest):   # the loop runs to the end; the last unit may be cut short
            # Keep the unit as it was said: the one ending in a sentence mark ("はい。", not "。はい").
            loop = text[match.start():]
            shift = next((k for k in range(len(unit)) if loop[k + len(unit) - 1] in "。！？.!?"), 0)
            return text[:match.start() + shift] + loop[shift:shift + len(unit)]
    return text


FRAME = 640                 # 20 ms of 16 kHz PCM16
BYTES_PER_MS = 32
MIN_CHUNK, MAX_CHUNK = 5.0, 18.0
PAUSE, LONG_PAUSE = 0.35, 1.0
FORCED_WINDOW = 6.0         # a chunk with no pause is cut at the quietest 100 ms of its last 6 s
MIN_SPEECH = 0.3            # less speech than this is not sent: recognizers invent text for silence
MAX_WAITING = 3             # more chunks than this waiting: the oldest is given up so results catch up
ASR_TIMEOUT, TEXT_TIMEOUT, FINISH_TIMEOUT = 15.0, 25.0, 25.0
CONTEXT_SENTENCES, PROMPT_TAIL = 8, 200
CARRY_LIMIT = 800          # characters of unsettled text; beyond this an answer that does not cover its input fails the chunk
ALT_LAG_MS = 1500           # live text arrives up to ~1.3 s after its audio

NAMES = {"zh": "Chinese (Traditional, Taiwan)", "en": "English", "ja": "Japanese"}


CHINESE = ("zh", "yue")


def recognizer(language: str) -> str:
    """Who hears a stream of this language again: "api" (the transcriptions API), "mai", "local", or "" for an
    unknown setting. With "hybrid" only Chinese goes to the API; mixed and automatic modes go to MAI."""
    if ASR == "hybrid":
        return "api" if language in CHINESE else "mai"
    return {"": "api", "mai": "mai", "local": "local"}.get(ASR, "")


def configured() -> bool:
    if not (URL and MODEL):
        return False
    needs_api, needs_mai = ASR in ("", "hybrid"), ASR in ("mai", "hybrid")
    return ASR in ("", "local", "mai", "hybrid") and (not needs_api or bool(ASR_MODEL)) and (not needs_mai or mai_asr.configured())


def units(text: str, words: bool) -> int:
    """How much was said in `text`: words for Latin script, letters and digits otherwise."""
    text = unicodedata.normalize("NFKC", text)
    return len(re.findall(r"[A-Za-z0-9']+", text)) if words else sum(char.isalnum() for char in text)


def in_words(text: str) -> bool:
    letters = [char for char in unicodedata.normalize("NFKC", text) if char.isalnum()]
    return sum(char.isascii() for char in letters) * 2 > len(letters)


def said(text: str) -> str:
    """The letters and digits of `text`, for telling whether two pieces say the same thing."""
    return "".join(char for char in unicodedata.normalize("NFKC", text).lower() if char.isalnum())


def joined(first: str, second: str) -> str:
    """Two pieces of running text as one: no space between CJK or kana, one space otherwise."""
    if not first or not second:
        return first or second
    edge = first[-1:] + second[:1]
    return first + ("" if CJK.search(edge) or KANA.search(edge) else " ") + second


def covered(given: int, back: int) -> bool:
    """Whether an answer holding `back` units accounts for an input of `given`: nothing much dropped (the model
    sometimes returns the new text and forgets the carried sentence) and nothing much invented. Removing fillers
    costs a few per cent; a dropped sentence costs a third or more."""
    return not (given >= 12 and back < 0.7 * given) and back <= 1.5 * given + 10


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(headers={"Authorization": f"Bearer {KEY}"} if KEY else {})


@dataclass
class Chunk:
    start_ms: int
    end_ms: int
    pcm: bytes
    speech: float               # seconds of frames above the speech threshold
    pause: str = "short"        # none | short | long; "short" may still become "long" while silence continues
    last: bool = False
    heard: "asyncio.Future | None" = None   # the text of a recognizer that listens along (MAI), when it arrives


class Chunker:
    """Consecutive, non-overlapping chunks cut at pauses (the energy rule of mai_asr.PauseDetector)."""

    def __init__(self):
        self.levels, self.rest = deque(maxlen=500), b""
        self.pcm, self.energy, self.loud = bytearray(), [], []
        self.start_frame = 0            # stream position of the current chunk's first frame
        self.quiet_run = 0
        self.watching: Chunk | None = None   # the chunk whose pause may still grow to "long"
        self.after_cut = 0              # quiet frames since that chunk's cut

    def feed(self, pcm: bytes) -> list[Chunk]:
        data, out = self.rest + pcm, []
        usable = len(data) - len(data) % FRAME
        for start in range(0, usable, FRAME):
            frame = data[start:start + FRAME]
            samples = array.array("h", frame)
            level = math.sqrt(sum(x * x for x in samples) / len(samples))
            self.levels.append(level)
            # The floor is capped by the recent peak: ten seconds of speech with no gap would otherwise raise
            # the floor to speech level and make everything look like a pause.
            floor = min(sorted(self.levels)[len(self.levels) // 7], 0.04 * max(self.levels))
            quiet = level < max(150.0, 2.5 * floor)
            self.pcm += frame
            self.energy.append(level)
            self.loud.append(not quiet)
            self.quiet_run = self.quiet_run + 1 if quiet else 0
            if self.watching is not None:
                if quiet:
                    self.after_cut += 1
                    if self.after_cut * 0.02 >= LONG_PAUSE:
                        self.watching.pause, self.watching = "long", None
                else:
                    self.watching = None
            length = len(self.energy) * 0.02
            need = round(PAUSE / 0.02)
            if length >= MIN_CHUNK and self.quiet_run >= need:
                # The middle of the first PAUSE of silence; the rest of the silence opens the next chunk. A short
                # utterance followed by silence is cut at that pause too, and a chunk of silence only is cut whole.
                frames = len(self.energy) - self.quiet_run + need // 2 if any(self.loud) else len(self.energy)
                out.append(self._cut(frames, "short"))
            elif length >= MAX_CHUNK:
                window = round(FORCED_WINDOW / 0.02)
                first = len(self.energy) - window
                quietest = min(range(first, len(self.energy) - 4), key=lambda k: sum(self.energy[k:k + 5]))
                out.append(self._cut(quietest + 2, "none"))
        self.rest = data[usable:]
        return out

    def _cut(self, frames: int, pause: str) -> Chunk:
        chunk = Chunk(self.start_frame * 20, (self.start_frame + frames) * 20, bytes(self.pcm[:frames * FRAME]),
                      sum(self.loud[:frames]) * 0.02, pause)
        del self.pcm[:frames * FRAME]
        tail = self.loud[frames:]
        self.energy, self.loud = self.energy[frames:], tail
        self.start_frame += frames
        if pause == "short":
            # Silence already heard after the cut counts toward a long pause.
            self.watching, self.after_cut = (chunk, len(tail)) if not any(tail) else (None, 0)
            if self.watching is not None and self.after_cut * 0.02 >= LONG_PAUSE:
                chunk.pause, self.watching = "long", None
        else:
            self.watching = None
        return chunk

    def flush(self) -> Chunk | None:
        """The rest of the stream as its last chunk."""
        self.watching = None
        if not self.energy:
            return None
        chunk = self._cut(len(self.energy), "long")
        chunk.last = True
        return chunk


def allocate(start_ms: int, end_ms: int, sources: list[str], carry: str) -> tuple[list[tuple[int, int]], int]:
    """Divide [start_ms, end_ms] among the sentences and the carried text in proportion to their lengths.
    Returns each sentence's (startMs, endMs) and where the carried text starts."""
    lengths = [max(len(text), 1) for text in sources]
    total = sum(lengths) + len(carry)
    if not total:
        return [], end_ms
    spans, done = [], 0
    for length in lengths:
        begin = start_ms + round((end_ms - start_ms) * done / total)
        done += length
        spans.append((begin, start_ms + round((end_ms - start_ms) * done / total)))
    return spans, spans[-1][1] if spans else start_ms


SYSTEM = """You are the quality pass of a live meeting interpreter. Speech is recognized in chunks cut at pauses; for each chunk you receive the recognizer's text and return the final transcript and its translation, sentence by sentence.

Input fields:
- TERMS (may be absent): names and terms of this meeting, spelled as they must appear.
- CONTEXT: the previous sentences with their translations (already shown to the reader; never repeat or re-translate them).
- CARRY: the unfinished end of the previous chunk; it comes right before NEW and must be included now.
- NEW: the recognizer's text for this chunk. The audio was cut at a pause, so NEW may end mid-sentence, and the recognizer's final punctuation mark is only a guess.
- PAUSE: how long the speaker paused after NEW ("none" = the audio was cut while they were still talking, even a word may be split across CARRY/NEW joins; "short" = a breath, the sentence very likely continues; "long" = a real stop).
- ALT (may be absent): a second, weaker recognizer's text for roughly the same audio; its start and end are approximate and may include a few neighbouring words. Use it only to recover words NEW dropped or to choose the reading that fits the context where NEW looks wrong or adds a connective that changes the logic; otherwise NEW wins. Never copy ALT's extra neighbouring words.
- LAST: true when the meeting has ended and nothing follows.

Do this:
1. Read CARRY + NEW as one continuous stretch of {src} speech. Repair recognition errors only where the context makes the intended word clear (similar-sounding wrong words, a name spelled differently from CONTEXT or TERMS, wrong 他/她, a stray question mark, a number split by a full stop). Remove only filler sounds (uh, um, えー, あの, 嗯, 呃) and a false start that the speaker immediately repeats. Everything else that was said stays, including every sentence of CARRY: never delete, summarize, shorten or skip a sentence, and never add content; when unsure, keep what was recognized.
2. Split it into sentences: one complete thought per item. The recognizer's full stops are unreliable: it often puts one at a pause in the middle of a sentence. A piece that is not a full clause on its own (a time adverbial like "Later this year.", a relative or subordinate clause, a bare noun phrase, the rest of a list) belongs to the sentence it completes: join them into one item. Items of one to three words are only for real complete utterances (a greeting, an answer, a backchannel). A reply or interjection by another speaker (なるほど, はい, Right., 對) is its own item, never glued to the previous speaker's sentence. A very long sentence may be split at a natural clause boundary only if both halves translate cleanly on their own (never between a negation or condition and what it applies to, never inside a list). Do not merge separate sentences into one item.
3. The final sentence of the stretch may continue in the next chunk ("...to deploy." + "unsupervised FSD at large scale when..."). If LAST is true, output everything and leave "carry" empty. Otherwise, when PAUSE is none or short, never output the final sentence: return its source text, verbatim, in "carry". When PAUSE is long, output it only if it is grammatically complete and could not be the first half of a longer sentence; else carry it. The carry is at most ~120 characters / 40 words: if the final sentence is longer, output its complete leading clauses as an item and carry only the last open clause.
4. Translate each item into {tgt}, as a skilled conference interpreter would say it: accurate first, then natural and concise. Keep who does what, negation, numbers, units, tense, hedging, hypotheticals (would have ≠ did) and questions exactly. Keep names and terms consistent with CONTEXT and TERMS. Translate idioms and fixed expressions by their meaning, and avoid calques of source wording (やっぱり is not 果然, 発信 is not 發信, 曖昧な言葉 is 模糊的用語; "unsupervised" driving is 無人監督). Approximate quantities stay exactly as vague as spoken (八千多 is "over eight thousand", not "eight thousand several hundred"). Do not add subjects, "more than", politeness or explanations that are not in the speech; when the subject is generic or third-person, do not turn it into "I". Quoted speech stays marked as a quote.
5. Names: keep Latin-script brand and product names as written (WeWork, FSD); render other names in the target language's usual form. Never leave source-language script in the translation, and for Chinese always use Traditional characters with Taiwan usage.

Every "tgt" is written in {tgt}, whatever language CONTEXT or these instructions happen to use; "src" stays in the language that was spoken.

Return JSON only: {{"sentences": [{{"src": "...", "tgt": "...", "lang": "{lang}"}}], "carry": "..."}}"""

KANA = re.compile(r"[぀-ヿ]")
CJK = re.compile(r"[㐀-鿿]")


def spoken_language(text: str, stream_language: str, said: str = "") -> str:
    """The language of one sentence: the stream's own, or told apart by script in the two-way and auto modes."""
    if stream_language in NAMES:
        return stream_language
    if stream_language == "zh_ja":
        # Kana settles it; a sentence of kanji only is whatever the model heard it as.
        return "ja" if KANA.search(text) else said if said in ("zh", "ja") else "zh"
    return "zh" if len(CJK.findall(text)) * 2 >= len(re.sub(r"\s", "", text)) else "en"


def target_name(language: str, target: str) -> str:
    """The translation language as the text model is told, next to the text as well: without reasoning, a small model
    answered English speech in Chinese when only the instructions named Japanese (measured 2026-11-14)."""
    if language == "zh_ja":
        return "Japanese for a Chinese sentence, Chinese (Traditional, Taiwan) for a Japanese one"
    return NAMES.get(target, "English")


def system_prompt(language: str, target: str) -> str:
    if language == "zh_ja":
        return SYSTEM.format(src="Chinese or Japanese (each sentence is one of the two)",
                             tgt="the other of the two languages (Japanese for a Chinese sentence, Chinese (Traditional, Taiwan) for a Japanese one)",
                             lang="zh or ja: the language the sentence was spoken in")
    src = NAMES.get(language, "Chinese or English (as spoken; a sentence already in the target language is repeated as it is)")
    return SYSTEM.format(src=src, tgt=NAMES.get(target, "English"), lang=language if language in NAMES else "zh or en")


def wav_bytes(pcm: bytes) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(pcm)
    return buffer.getvalue()


class Unusable(Exception):
    """The service answered, but not with what was asked for."""


@dataclass
class _Live:
    """The live transcript as shown, with where it was at each moment of the audio clock (for ALT)."""
    text: str = ""
    marks: list = field(default_factory=list)   # (audio ms, characters shown)

    def note(self, text: str, ms: int) -> None:
        self.text = text
        self.marks.append((ms, len(text)))

    def between(self, start_ms: int, end_ms: int) -> str:
        def position(ms):
            at = 0
            for when, shown in self.marks:
                if when > ms:
                    break
                at = shown
            return at
        return self.text[position(start_ms):position(end_ms + ALT_LAG_MS)].strip()


class QualityPass:
    """One stream's quality pass. `send` is an async callable taking the event dict for the browser."""

    def __init__(self, send, language: str, target: str, glossary: str, convert=lambda text: text, engine_language: str = "zhen"):
        self.send, self.language, self.glossary, self.convert = send, language, glossary.strip(), convert
        self.engine_language = engine_language   # the local engine's name for the language (TRANSLATE_QUALITY_ASR=local)
        self.engine = recognizer(language)
        # MAI recognizes in real time: it listens along and is committed at each chunk cut.
        self.mai = chunk_asr.MaiLive(language) if self.engine == "mai" else None
        self.target = target if target in NAMES else "en"
        self.chunker, self.live_text = Chunker(), _Live()
        self.waiting: deque[Chunk] = deque()
        self.wake = asyncio.Event()
        self.more, self.wants_more = asyncio.Event(), False   # the worker is waiting for audio to decide a pause
        self.idle = asyncio.Event()                           # set while the worker waits for input (tests pace on it)
        self.fed_ms = 0
        self.seq = 0
        self.context: list[dict] = []
        self.carry, self.carry_start = "", 0
        self.heard = ""                 # recognized so far; its tail prompts the next transcription
        self.silence_asked = False      # the carried text was already offered to the model after a silence
        self.prompt_ok = True           # until the recognizer refuses a prompt (some take none)
        self.closing = self.finished = self.closed = False
        self.client = new_client()
        self.worker = asyncio.create_task(self._run())

    # --- input -------------------------------------------------------------------------------------------

    def feed(self, pcm: bytes) -> None:
        self.fed_ms += len(pcm) // BYTES_PER_MS
        if self.mai:
            self.mai.feed(pcm)
        for chunk in self.chunker.feed(pcm):
            self._listened(chunk)
            self.waiting.append(chunk)
        if self.waiting or self.wants_more:
            self.idle.clear()
            self.wake.set()
            self.more.set()

    def _listened(self, chunk: Chunk) -> None:
        """MAI has heard this chunk by now (and a little of what follows the cut): ask for its text. Silence is not
        committed; it stays in MAI's buffer for the next commit."""
        if self.mai and chunk.speech >= MIN_SPEECH:
            chunk.heard = self.mai.commit()

    def live(self, text: str) -> None:
        """The live transcript as the browser shows it now."""
        if USE_ALT:   # only kept when it is used
            self.live_text.note(text, self.fed_ms)

    async def finish(self) -> None:
        """Process what is left as the last chunk and send the final event; at most FINISH_TIMEOUT."""
        if self.closing:
            return
        self.closing = True
        last = self.chunker.flush() or Chunk(self.fed_ms, self.fed_ms, b"", 0.0, "long")
        last.last = True
        self._listened(last)
        self.waiting.append(last)
        self.idle.clear()
        self.wake.set()
        self.more.set()
        try:
            await asyncio.wait_for(asyncio.shield(self.worker), FINISH_TIMEOUT)
        except asyncio.TimeoutError:
            self.worker.cancel()
            if not self.finished:
                logger.warning("quality pass: final chunk timed out")
                await self._emit({"failed": True, "throughMs": self.fed_ms, "final": True})
        finally:
            self.closed = True
            if self.mai:
                self.mai.close()
                await self.mai.meter.finish()   # what went to MAI is on record before the stream closes
            await self.client.aclose()

    def cancel(self) -> None:
        """The browser left (or the stream was stopped): stop without sending anything more. Safe after finish()."""
        if self.closed:
            return
        self.closing = self.closed = True
        self.worker.cancel()
        if self.mai:
            self.mai.close()
            self.mai.meter.finish_soon()
        asyncio.ensure_future(self.client.aclose())

    # --- processing --------------------------------------------------------------------------------------

    async def _run(self) -> None:
        while not self.finished:
            while not self.waiting:
                self.wake.clear()
                self.idle.set()
                await self.wake.wait()
            self.idle.clear()
            chunk = self.waiting.popleft()
            started, outcome, heard, shown = time.monotonic(), "ok", 0, 0
            try:
                if len(self.waiting) > MAX_WAITING and not chunk.last:
                    raise Unusable("backlog")
                heard, sentences = await self._process(chunk)
                shown = sum(len(s["source"]) + len(s["target"]) for s in sentences)
                await self._emit({"throughMs": chunk.end_ms, "final": chunk.last, "sentences": sentences})
            except asyncio.CancelledError:
                raise
            except Exception as error:   # any failure keeps the live result; the stream goes on
                # Why, never what was said: the reason of an unusable answer is one fixed word.
                outcome = "backlog" if str(error) == "backlog" else f"failed:{type(error).__name__}" + (f":{error}" if isinstance(error, Unusable) else "")
                self.carry, self.carry_start = "", chunk.end_ms
                await self._emit({"failed": True, "throughMs": chunk.end_ms, "final": chunk.last})
            # No meeting text in logs: numbers only.
            log = logger.info if outcome == "ok" else logger.warning
            log("quality chunk seq=%d audio_ms=%d chars_in=%d chars_out=%d ms=%d result=%s", self.seq, chunk.end_ms - chunk.start_ms,
                heard, shown, round((time.monotonic() - started) * 1000), outcome)
            if chunk.last:
                self.finished = True

    async def _emit(self, quality: dict) -> None:
        self.seq += 1
        await self.send({"quality": {"seq": self.seq, **quality}, "audioMs": self.fed_ms})

    async def _twice(self, request):
        try:
            return await request()
        except asyncio.CancelledError:
            raise
        except Exception:
            return await request()

    async def _process(self, chunk: Chunk) -> tuple[int, list[dict]]:
        new = ""
        if chunk.speech >= MIN_SPEECH:
            # A recognizer that listened along has one answer per commit: waiting for it again gives nothing new.
            new = (await self._transcribe(chunk) if chunk.heard is not None else await self._twice(lambda: self._transcribe(chunk))).strip()
            self.heard = (self.heard + " " + new)[-2000:]
        if new:
            self.silence_asked = False
        if not self.carry:
            self.carry_start = chunk.start_ms
        if not new and not self.carry:
            return 0, []
        # Whether the pause is short or long is known only once a second of audio after the cut was heard;
        # a fast recognizer (or a chunk with nothing to recognize) gets here before that.
        while self.chunker.watching is chunk and not self.closing:
            self.more.clear()
            self.wants_more = True
            self.idle.set()
            await self.more.wait()
        self.wants_more = False
        self.idle.clear()
        # 2.5 s of silence settles a carried sentence. Asked once per carried text: more silence adds nothing.
        silent_long = not new and chunk.end_ms - chunk.start_ms >= 2500
        pause = "long" if chunk.last or silent_long else chunk.pause
        if not new and not chunk.last and (pause != "long" or self.silence_asked):
            return 0, []                # nothing new to decide the carried sentence with
        if not new:
            self.silence_asked = True
        alt = self.live_text.between(self.carry_start, chunk.end_ms) if USE_ALT else ""
        try:
            result = await self._twice(lambda: self._refine(new, pause, alt, chunk.last))
        except Unusable as error:
            unsettled = joined(self.carry, new)
            if str(error) != "coverage" or chunk.last or len(unsettled) > CARRY_LIMIT:
                raise
            # Twice the answer dropped or invented text. Falling back to the live result here leaves a seam of
            # repeated and missing sentences (measured 2026-11-14), so nothing is shown yet: all of it waits for
            # the next chunk, which asks again with more to go on.
            logger.warning("quality pass: the answer did not cover its input; %d characters wait for the next chunk", len(unsettled))
            self.carry = unsettled
            return len(new), []
        items, carry = result["sentences"], result["carry"]
        if chunk.last:
            carry = ""
        elif pause != "long" and items:
            # A short pause never ends a sentence, whatever the model decided. The model often names that sentence
            # in "carry" as well: it is carried once, not twice.
            held = items.pop()["src"]
            if not said(carry).startswith(said(held)):
                carry = joined(held, carry)
        spans, carry_start = allocate(self.carry_start, chunk.end_ms, [item["src"] for item in items], carry)
        sentences = []
        for item, (start, end) in zip(items, spans):
            lang = spoken_language(item["src"], self.language, item.get("lang", ""))
            target = ("ja" if lang == "zh" else "zh") if self.language == "zh_ja" else self.target
            sentences.append({"source": self.convert(item["src"]) if lang == "zh" else item["src"],
                              "target": self.convert(item["tgt"]) if target == "zh" else item["tgt"],
                              "lang": lang, "startMs": start, "endMs": end})
        self.context = (self.context + [{"src": s["source"], "tgt": s["target"]} for s in sentences])[-CONTEXT_SENTENCES:]
        self.carry, self.carry_start = carry, carry_start
        return len(new), sentences

    async def _transcribe(self, chunk: Chunk) -> str:
        if chunk.heard is not None:   # MAI listened along; its text for this commit is on its way
            # Shielded: a timeout must not cancel the answer itself (awaiting a cancelled future ends the worker).
            return without_loop(await asyncio.wait_for(asyncio.shield(chunk.heard), ASR_TIMEOUT))
        if self.engine == "mai":
            raise Unusable("transcription")   # speech that was never committed: nothing can answer for it
        if self.engine == "local":
            return without_loop(await asyncio.wait_for(
                chunk_asr.local(chunk.pcm, self.engine_language, self.language == "zh_ja", self.glossary), ASR_TIMEOUT))
        data = {"model": ASR_MODEL, "response_format": "json", **ASR_EXTRA}
        prompt = " ".join(part for part in (self.glossary, self.heard[-PROMPT_TAIL:].strip()) if part)
        if prompt and self.prompt_ok:
            data["prompt"] = prompt
        if self.language in NAMES:
            data["language"] = self.language
        audio = wav_bytes(chunk.pcm)

        async def ask():
            request = self.client.build_request("POST", f"{ASR_URL or URL}/audio/transcriptions", data=data, timeout=ASR_TIMEOUT,
                                                files={"file": ("chunk.wav", audio, "audio/wav")})
            if ASR_URL:   # its own key or none: never the text service's
                request.headers.pop("Authorization", None)
                if ASR_KEY:
                    request.headers["Authorization"] = f"Bearer {ASR_KEY}"
            return await self.client.send(request)
        response = await ask()
        if response.status_code == 400 and "prompt" in data:
            # Refused as a bad request with a prompt: this recognizer takes none. Ask again without it,
            # and leave it out for the rest of the stream.
            self.prompt_ok = False
            del data["prompt"]
            logger.info("quality pass: the recognizer refused a prompt; continuing without one")
            response = await ask()
        response.raise_for_status()
        text = response.json().get("text")
        if not isinstance(text, str):
            raise Unusable("transcription")
        # Qwen3-ASR served by vLLM answers "language Chinese<asr_text>…": the text is what follows the tag.
        return without_loop(text.rsplit("<asr_text>", 1)[-1])

    async def _refine(self, new: str, pause: str, alt: str, last: bool) -> dict:
        context = "\n".join(f"{s['src']}\n  => {s['tgt']}" for s in self.context) or "(start of meeting)"
        user = ((f"TERMS: {self.glossary}\n\n" if self.glossary else "") + f"CONTEXT:\n{context}\n\nCARRY: {self.carry}\nNEW: {new}\nPAUSE: {pause}\n"
                + (f"ALT: {alt}\n" if alt else "") + f"LAST: {'true' if last else 'false'}\nTRANSLATE INTO: {target_name(self.language, self.target)}")
        payload = {"model": MODEL, "max_tokens": 6000, "response_format": {"type": "json_object"},
                   "messages": [{"role": "system", "content": system_prompt(self.language, self.target)}, {"role": "user", "content": user}],
                   **EXTRA}
        response = await self.client.post(f"{URL}/chat/completions", json=payload, timeout=TEXT_TIMEOUT)
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"] or ""
        answer = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip()))
        if not isinstance(answer, dict) or not isinstance(answer.get("sentences"), list):
            raise Unusable("answer")
        items = [item for item in answer["sentences"]
                 if isinstance(item, dict) and isinstance(item.get("src"), str) and isinstance(item.get("tgt"), str) and item["src"].strip() and item["tgt"].strip()]
        # A sentence given twice (again in this answer, or the one shown last) counts and is shown once.
        shown = said(self.context[-1]["src"]) if self.context else ""
        for item in list(items):
            if said(item["src"]) == shown:
                items.remove(item)
            shown = said(item["src"])
        carry = answer.get("carry")
        carry = carry.strip() if isinstance(carry, str) else ""
        # The answer must account for what it was given: the carried sentence and the new text, not just one of them.
        given = joined(self.carry, new)
        words = in_words(given)
        if not covered(units(given, words), units(" ".join(item["src"] for item in items) + " " + carry, words)):
            raise Unusable("coverage")
        return {"sentences": items, "carry": carry}


class TeeReceiver:
    """Wraps the guarded browser connection: every audio message is also handed to `on_pcm`. Both engines
    read the browser through receive(), so neither needs to know about the quality pass."""

    def __init__(self, inner, on_pcm):
        self._inner, self._on_pcm = inner, on_pcm

    async def receive(self):
        event = await self._inner.receive()
        if event.get("bytes") is not None:
            self._on_pcm(event["bytes"])
        return event

    def __getattr__(self, name):
        return getattr(self._inner, name)
