"""Revision of the quality pass's sentences (quality-revision).

The quality pass shows each sentence within about two seconds: one chunk at a time, without what comes next and
without time to reason. Here the sentences it has shown are looked at again in windows, by the same text model
with reasoning on, together with what was said before and after, the live engine's text for the same audio and
running notes about the meeting. Sentences that change go back to the page as a `revision` event, by id. The
number and order of sentences never change. Anything that goes wrong leaves the first result in place.
"""
import asyncio
import logging
import time

logger = logging.getLogger("uvicorn.error")

WINDOW, AFTER, BEFORE = 6, 3, 6     # sentences per window, sentences that must follow it, sentences shown before it
ASK_TIMEOUT = 60.0                  # one answer; reasoning took 7-20 s at the median and 88 s at worst (bench/README.md)
FINISH_TIMEOUT = 30.0               # everything still unrevised when the stream ends
MAX_WAITING = 30                    # more sentences than this waiting: the oldest windows are given up
NOTES_LIMIT = 900

SYSTEM = """You are the reviewer of a live meeting interpreter. A fast first pass has already shown the reader the sentences of WINDOW (SRC = transcript, TGT = translation). It worked chunk by chunk, without seeing what came next and without time to think. You see more: what was said before and after, a second recognizer's text, and running notes. Correct what the first pass got wrong, and leave what is right exactly as it is.

Input fields:
- TERMS (may be absent): names and terms of this meeting, spelled as they must appear.
- NOTES: what is known about this meeting so far (people with role and gender, names and terms with the translation in use, the topic).
- BEFORE: the sentences before WINDOW, already reviewed (context only).
- WINDOW: the numbered sentences to review.
- AFTER: the transcript of what follows WINDOW (context only; it is reviewed later, never output it).
- ALT: another recognizer's text for roughly the same audio as WINDOW. It is weaker overall, may be in another script variant (Simplified Chinese) and has little punctuation; its start and end are approximate.

Do this, thinking it through before you answer:
1. Recognition. Read WINDOW as continuous speech in its context. Where a word or phrase of SRC does not make sense there (a similar-sounding wrong word, a name spelled differently from TERMS, NOTES or BEFORE, a dropped or added negation, a wrong number, a wrong homophone such as 他/她, a question recognized as a statement) and ALT or the context makes the intended words clear, correct SRC. Where SRC and ALT differ, choose the reading that fits the context; when both fit, SRC stays. Words recognized twice in two variants ("穩定不穩定") become the one variant that fits. Never add content that neither recognizer has, and never delete, shorten or summarize content.
2. Sentences. Every numbered sentence stays its own item under its own number: never merge, split, reorder or drop items, and never move words from one item to another. When a sentence was cut across two items, translate each part so that the two read as one sentence.
3. Translation. Translate again wherever TGT is wrong or SRC changed: who does what to whom, negation, numbers and units, question versus statement, tense and hypotheticals, who is quoted and where the quote ends, the gender of each person (from NOTES, BEFORE, AFTER: someone with a husband is "she"), names and terms as in TERMS, NOTES and BEFORE, idioms by meaning, and wording that is a calque or not natural in the target language. Brand and product names in Latin script stay as written; never leave source-language script in the translation. A TGT that is already right stays word for word as it is: do not rephrase for taste.
4. NOTES. Return the notes updated with what this window adds or corrects: people (name, role, gender and the evidence), names and terms with their translation, the topic. At most 600 characters, in English.

Every "tgt" is written in the language named by TRANSLATE INTO; "src" stays in the language that was spoken.

Return JSON only: {"sentences": [{"id": 1, "src": "...", "tgt": "..."}], "notes": "..."} with every number of WINDOW exactly once, in order."""


class Refused(Exception):
    """The model answered, but not with a revision of this window. The message is one fixed word."""


def usable(given: int, back: int) -> bool:
    """Whether sources holding `back` units can be a revision of sources holding `given`: corrections change a few
    words, never a fifth of the text."""
    return 0.8 * given <= back <= 1.25 * given + 5


class Reviser:
    """One stream's revision. `ask(messages, timeout)` returns the model's parsed JSON answer; `send` takes the event
    for the browser; `alt(start_ms, end_ms)` is the live engine's text of that span; `units(text)` measures text."""

    def __init__(self, ask, send, target_name: str, alt, convert, units, glossary: str = ""):
        self.ask, self.send, self.target_name, self.alt, self.convert, self.units = ask, send, target_name, alt, convert, units
        self.glossary = glossary.strip()
        self.sentences: list[dict] = []     # every sentence sent so far, as revised: id, source, target, lang, startMs, endMs
        self.at = 0                         # sentences before this index are settled (revised or given up)
        self.notes = "(nothing yet)"
        self.seq = 0
        self.closing = self.closed = False
        self.deadline = None                # set when the stream ends
        self.wake = asyncio.Event()
        self.worker = asyncio.create_task(self._run())

    def add(self, sentences: list[dict]) -> None:
        self.sentences += [dict(sentence) for sentence in sentences]
        self.wake.set()

    async def finish(self) -> None:
        """Revise what is left and return; at most FINISH_TIMEOUT. What is not done by then stays as it was."""
        if self.closed:
            return
        self.closing, self.deadline = True, time.monotonic() + FINISH_TIMEOUT
        self.wake.set()
        try:
            await asyncio.wait_for(asyncio.shield(self.worker), FINISH_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning("quality revision: %d sentences were not revised before the stream closed", len(self.sentences) - self.at)
        finally:
            self.cancel()

    def cancel(self) -> None:
        """Stop without sending anything more. Safe to call again."""
        self.closing = self.closed = True
        self.worker.cancel()

    def _next(self) -> list[dict] | None:
        """The window to revise now, or None when more sentences must arrive first."""
        waiting = len(self.sentences) - self.at
        if self.closing:
            return self.sentences[self.at:self.at + (waiting if waiting <= WINDOW + AFTER else WINDOW)] or None
        return self.sentences[self.at:self.at + WINDOW] if waiting >= WINDOW + AFTER else None

    async def _run(self) -> None:
        while True:
            if len(self.sentences) - self.at > MAX_WAITING and not self.closing:
                # Far behind (a slow model): the oldest sentences keep their first result so the rest is revised in time.
                for _ in range(-(-(len(self.sentences) - self.at - MAX_WAITING) // WINDOW)):
                    logger.warning("quality revision sentences=%d changed=0 ms=0 result=skipped", WINDOW)
                    self.at += WINDOW
            window = self._next()
            if window is None:
                if self.closing:
                    return
                self.wake.clear()
                await self.wake.wait()
                continue
            started, outcome, changed = time.monotonic(), "ok", 0
            try:
                changed = await self._revise(window)
            except asyncio.CancelledError:
                raise
            except Exception as error:   # the first result stays; why, never what was said
                outcome = f"failed:{error}" if isinstance(error, Refused) else f"failed:{type(error).__name__}"
            self.at += len(window)
            log = logger.info if outcome == "ok" else logger.warning
            log("quality revision sentences=%d changed=%d ms=%d result=%s", len(window), changed, round((time.monotonic() - started) * 1000), outcome)

    def _messages(self, window: list[dict]) -> list[dict]:
        first = self.at
        before = "\n".join(f"{s['source']}\n  => {s['target']}" for s in self.sentences[max(0, first - BEFORE):first]) or "(start of meeting)"
        after = " ".join(s["source"] for s in self.sentences[first + len(window):first + len(window) + AFTER]) or "(nothing yet)"
        numbered = "\n".join(f"{number}. SRC: {s['source']}\n   TGT: {s['target']}" for number, s in enumerate(window, 1))
        user = ((f"TERMS: {self.glossary}\n\n" if self.glossary else "") + f"NOTES: {self.notes}\n\nBEFORE:\n{before}\n\nWINDOW:\n{numbered}\n\nAFTER: {after}\n\n"
                f"ALT: {self.alt(window[0]['startMs'], window[-1]['endMs'])}\n\nTRANSLATE INTO: {self.target_name}")
        return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]

    async def _answer(self, window: list[dict], messages: list[dict]) -> dict:
        timeout = ASK_TIMEOUT if self.deadline is None else max(1.0, min(ASK_TIMEOUT, self.deadline - time.monotonic()))
        answer = await asyncio.wait_for(self.ask(messages, timeout), timeout)
        items = answer.get("sentences") if isinstance(answer, dict) else None
        if not isinstance(items, list) or [item.get("id") if isinstance(item, dict) else None for item in items] != list(range(1, len(window) + 1)):
            raise Refused("sentences")
        if not all(isinstance(item.get(key), str) and item[key].strip() for item in items for key in ("src", "tgt")):
            raise Refused("empty")
        if not usable(self.units(" ".join(s["source"] for s in window)), self.units(" ".join(item["src"] for item in items))):
            raise Refused("coverage")
        return answer

    async def _revise(self, window: list[dict]) -> int:
        messages = self._messages(window)
        try:
            answer = await self._answer(window, messages)
        except asyncio.CancelledError:
            raise
        except Exception:
            answer = await self._answer(window, messages)
        changed = []
        for sentence, item in zip(window, answer["sentences"]):
            source = self.convert(item["src"].strip()) if sentence["lang"] == "zh" else item["src"].strip()
            target = self.convert(item["tgt"].strip()) if sentence.get("targetLang") == "zh" else item["tgt"].strip()
            if (source, target) != (sentence["source"], sentence["target"]):
                sentence["source"], sentence["target"] = source, target
                changed.append({"id": sentence["id"], "source": source, "target": target})
        notes = answer.get("notes")
        if isinstance(notes, str) and notes.strip():
            self.notes = notes.strip()[:NOTES_LIMIT]
        if changed and not self.closed:
            self.seq += 1
            await self.send({"revision": {"seq": self.seq, "sentences": changed}})
        return len(changed)
