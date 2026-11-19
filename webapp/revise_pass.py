"""Revision of the quality pass's sentences (quality-revision).

The quality pass shows each sentence within about two seconds: one chunk at a time, without what comes next and
without time to reason. Here the sentences it has shown are looked at again in windows, by the same text model
with reasoning on, together with what was said before and after, the live engine's text for the same audio and
running notes about the meeting. Sentences that change go back to the page as a `revision` event, by id. A
sentence the first pass cut in two can be merged into one (revision-merge); nothing is ever split or reordered.
Anything that goes wrong leaves the first result in place.
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
MERGE_MAX = 2                       # sentences that may become one: more made walls of text (bench/README.md)

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
2. Sentences. When one sentence was cut in the middle across consecutive items (an item stops in mid-clause and the next one continues it), merge those items into one item and give their numbers in "ids": at most 2 numbers, both spoken in the same language. Complete sentences stay separate items, and so does a reply by another speaker. Never split, reorder or drop items, and never move words between items that stay separate.
3. Translation. Translate again wherever TGT is wrong or SRC changed: who does what to whom, negation, numbers and units, question versus statement, tense and hypotheticals, who is quoted and where the quote ends, the gender of each person (from NOTES, BEFORE, AFTER: someone with a husband is "she"), names and terms as in TERMS, NOTES and BEFORE, idioms by meaning, and wording that is a calque or not natural in the target language. Brand and product names in Latin script stay as written; never leave source-language script in the translation. A TGT that is already right stays word for word as it is: do not rephrase for taste.
4. NOTES. Return the notes updated with what this window adds or corrects: people (name, role, gender and the evidence), names and terms with their translation, the topic. At most 600 characters, in English.

Every "tgt" is written in the language named by TRANSLATE INTO; "src" stays in the language that was spoken.

Return JSON only: {"sentences": [{"ids": [1], "src": "...", "tgt": "..."}, {"ids": [2, 3], "src": "...", "tgt": "..."}], "notes": "..."} with every number of WINDOW exactly once, in order."""


POLISH_STEP = """1. Recognition and wording. Read WINDOW as continuous speech in its context. Correct SRC where a word or phrase does not make sense there (a similar-sounding wrong word, a name or term spelled differently from TERMS, NOTES or BEFORE, a dropped or added negation, a wrong number, a wrong homophone such as 他/她, a question recognized as a statement) and ALT or the context makes the intended words clear. Where SRC and ALT differ, choose the reading that fits the context; when both fit, SRC stays. Words recognized twice in two variants ("穩定不穩定") become the one variant that fits. Never add content that neither recognizer has. Use the standard written form of terms (for Chinese with Taiwan usage). Remove fillers (uh, um; えー, あの; 嗯, 呃, 欸, 那個, 就是, 然後, 的話, 對對對 used as fillers), stutters and words said twice by mistake that are still there, and make a sentence that still reads awkwardly read smoothly as natural written text. Keep every point, fact, number, name, negation, condition, hedge and question and the speaker's meaning; never add content, and never delete, shorten or summarize content. Evidence first: change a content word only when it sounds similar and the context, TERMS, NOTES or the other recognizer supports the change; never change a word only to make the sentence read better (存在 does not become 存成), and never reverse a direction, negation or number. 然後, 就是 and 的話 stay where they carry time order, a condition or a definition. A short answer by another person (害怕。 逃跑。 對。) is its own item, never joined to the next question. Quotation marks cover only the quoted words: what the speaker says after the quote is outside them, and answers of different people are not put into one quote. Turns: never merge items spoken by different people (a question and its answer, a backchannel); a tag question (對不對？) is never merged with another person's words. Limits: words or sentences spoken in a language other than the speaker's main language (English inside Chinese speech, for example) stay in that language as spoken, never translated; a direct quote stays a direct quote, never turned into reported speech; a sentence the speaker left unfinished stays unfinished, never completed, guessed or paraphrased; each item holds one complete thought. A sentence that already reads well stays word for word as it is.
"""


def _without_translation(prompt: str) -> str:
    """SYSTEM for a meeting that is not translated (transcript-only): SRC polished like a meeting record (POLISH_STEP,
    transcript-polish) and merged as before, no TGT."""
    start, end = prompt.index("1. Recognition."), prompt.index("2. Sentences.")
    prompt = prompt[:start] + POLISH_STEP + prompt[end:]
    for old, new in (
            ("A fast first pass has already shown the reader the sentences of WINDOW (SRC = transcript, TGT = translation).",
             "A fast first pass has already shown the reader the sentences of WINDOW (SRC = transcript; this meeting is not translated)."),
            ("(people with role and gender, names and terms with the translation in use, the topic)", "(people with role and gender, names and terms, the topic)"),
            ("people (name, role, gender and the evidence), names and terms with their translation, the topic.",
             "people (name, role, gender and the evidence), names and terms, the topic."),
            ('Every "tgt" is written in the language named by TRANSLATE INTO; "src" stays in the language that was spoken.',
             '"src" stays in the language that was spoken, with Traditional characters and Taiwan usage for Chinese.'),
            ('{"sentences": [{"ids": [1], "src": "...", "tgt": "..."}, {"ids": [2, 3], "src": "...", "tgt": "..."}], "notes": "..."}',
             '{"sentences": [{"ids": [1], "src": "..."}, {"ids": [2, 3], "src": "..."}], "notes": "..."}')):
        assert prompt.count(old) == 1, old
        prompt = prompt.replace(old, new)
    start, end = prompt.index("3. Translation."), prompt.index("4. NOTES.")
    return prompt[:start] + "3. NOTES." + prompt[end + len("4. NOTES."):]


SYSTEM_TRANSCRIPT = _without_translation(SYSTEM)


NO_NOTES = "(nothing yet)"


class Refused(Exception):
    """The model answered, but not with a revision of this window. The message is one fixed word."""


def usable(given: int, back: int) -> bool:
    """Whether sources holding `back` units can be a revision of sources holding `given`: corrections change a few
    words, never a fifth of the text."""
    return 0.8 * given <= back <= 1.25 * given + 5


class Reviser:
    """One stream's revision. `ask(messages, timeout)` returns the model's parsed JSON answer; `send` takes the event
    for the browser; `alt(start_ms, end_ms)` is the live engine's text of that span; `units(text)` measures text."""

    def __init__(self, ask, send, target_name: str, alt, convert, units, glossary: str = "", translate: bool = True, left_out=None):
        self.ask, self.send, self.target_name, self.alt, self.convert, self.units = ask, send, target_name, alt, convert, units
        # left_out(given, back): the stretch of `given` that `back` leaves out, or "" (transcript-completeness); None: unchecked
        self.left_out = left_out
        self.translate = translate          # False: the meeting is not translated (transcript-only), SRC only
        self.glossary = glossary.strip()
        self.sentences: list[dict] = []     # every sentence sent so far, as revised: id, source, target, lang, startMs, endMs
        self.at = 0                         # sentences before this index are settled (revised or given up)
        self.added = self.done = 0          # sentences taken in; sentences whose window is over (revised or given up)
        self.busy = 0                       # sentences of the window being revised now
        self.tail: list[asyncio.Task] = []  # the windows asked together when the stream ends
        self.notes = NO_NOTES
        self.seq = 0
        self.closing = self.closed = False
        self.deadline = None                # set when the stream ends
        self.wake = asyncio.Event()
        self.worker = asyncio.create_task(self._run())

    def add(self, sentences: list[dict]) -> None:
        self.sentences += [dict(sentence) for sentence in sentences]
        self.added += len(sentences)
        self.wake.set()

    async def finish(self) -> None:
        """Revise what is left and return; at most FINISH_TIMEOUT. What is not done by then stays as it was."""
        if self.closed:
            return
        self.closing, self.deadline = True, time.monotonic() + FINISH_TIMEOUT
        self.wake.set()
        # Every window that is left is asked for now, together and next to the one still being revised, so the last
        # sentences are in time. Their requests are built here, before anything else changes the list.
        self.tail = [asyncio.ensure_future(self._window(first, window, self._messages(first, window))) for first, window in self._last_windows()]
        try:
            _, late = await asyncio.wait([self.worker, *self.tail], timeout=FINISH_TIMEOUT)
            if late:
                logger.warning("quality revision: %d sentences were not revised before the stream closed", self.added - self.done)
        finally:
            self.cancel()

    def cancel(self) -> None:
        """Stop without sending anything more. Safe to call again."""
        self.closing = self.closed = True
        self.worker.cancel()
        for task in self.tail:
            task.cancel()

    def _last_windows(self) -> list[tuple[int, list[dict]]]:
        """What is left when the stream ends, after the window being revised, as (index of the first sentence, window)."""
        windows, at = [], self.at + self.busy
        while at < len(self.sentences):
            left = len(self.sentences) - at
            size = left if left <= WINDOW + AFTER else WINDOW
            windows.append((at, self.sentences[at:at + size]))
            at += size
        return windows

    async def _run(self) -> None:
        while True:
            if len(self.sentences) - self.at > MAX_WAITING and not self.closing:
                # Far behind (a slow model): the oldest sentences keep their first result so the rest is revised in time.
                for _ in range(-(-(len(self.sentences) - self.at - MAX_WAITING) // WINDOW)):
                    logger.warning("quality revision sentences=%d changed=0 merged=0 ms=0 result=skipped", WINDOW)
                    self.at += WINDOW
                    self.done += WINDOW
            if self.closing:   # finish() has asked for everything that was left
                return
            if len(self.sentences) - self.at < WINDOW + AFTER:
                self.wake.clear()
                await self.wake.wait()
                continue
            window = self.sentences[self.at:self.at + WINDOW]
            self.busy = len(window)
            gone = await self._window(self.at, window, self._messages(self.at, window))
            # The window is settled; the sentences merged into another leave the list, so later windows see one sentence.
            self.sentences = [s for s in self.sentences if s["id"] not in gone]
            self.at, self.busy = self.at + len(window) - len(gone), 0

    async def _window(self, first: int, window: list[dict], messages: list[dict]) -> list[int]:
        """Revise one window and log it. Returns the ids of the sentences that were merged into another."""
        started, outcome, changed, gone = time.monotonic(), "ok", 0, []
        try:
            changed, gone = await self._revise(window, messages)
        except asyncio.CancelledError:
            raise
        except Exception as error:   # the first result stays; why, never what was said
            outcome = f"failed:{error}" if isinstance(error, Refused) else f"failed:{type(error).__name__}"
        self.done += len(window)
        log = logger.info if outcome == "ok" else logger.warning
        log("quality revision sentences=%d changed=%d merged=%d ms=%d result=%s", len(window), changed, len(gone), round((time.monotonic() - started) * 1000), outcome)
        return gone

    def _messages(self, first: int, window: list[dict]) -> list[dict]:
        before = "\n".join(f"{s['source']}\n  => {s['target']}" if self.translate else s["source"]
                           for s in self.sentences[max(0, first - BEFORE):first]) or "(start of meeting)"
        after = " ".join(s["source"] for s in self.sentences[first + len(window):first + len(window) + AFTER]) or "(nothing yet)"
        numbered = "\n".join(f"{number}. SRC: {s['source']}" + (f"\n   TGT: {s['target']}" if self.translate else "") for number, s in enumerate(window, 1))
        user = ((f"TERMS: {self.glossary}\n\n" if self.glossary else "") + f"NOTES: {self.notes}\n\nBEFORE:\n{before}\n\nWINDOW:\n{numbered}\n\nAFTER: {after}\n\n"
                f"ALT: {self.alt(window[0]['startMs'], window[-1]['endMs'])}" + (f"\n\nTRANSLATE INTO: {self.target_name}" if self.translate else ""))
        return [{"role": "system", "content": SYSTEM if self.translate else SYSTEM_TRANSCRIPT}, {"role": "user", "content": user}]

    async def _answer(self, window: list[dict], messages: list[dict]) -> tuple[dict, list[list[int]]]:
        """The model's answer and, for each of its items, the numbers of the window's sentences it stands for."""
        timeout = ASK_TIMEOUT if self.deadline is None else max(1.0, min(ASK_TIMEOUT, self.deadline - time.monotonic()))
        answer = await asyncio.wait_for(self.ask(messages, timeout), timeout)
        items = answer.get("sentences") if isinstance(answer, dict) else None
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise Refused("sentences")
        groups = [item["ids"] if isinstance(item.get("ids"), list) else [item.get("id")] for item in items]
        if not all(groups) or [number for group in groups for number in group] != list(range(1, len(window) + 1)):
            raise Refused("sentences")
        if any(len(group) > MERGE_MAX or len({window[number - 1]["lang"] for number in group}) > 1 for group in groups):
            raise Refused("merge")
        if not all(isinstance(item.get(key), str) and item[key].strip() for item in items for key in (("src", "tgt") if self.translate else ("src",))):
            raise Refused("empty")
        if not usable(self.units(" ".join(s["source"] for s in window)), self.units(" ".join(item["src"] for item in items))):
            raise Refused("coverage")
        if self.left_out and any(self.left_out(" ".join(window[number - 1]["source"] for number in group), item["src"])
                                 for group, item in zip(groups, items)):
            raise Refused("left-out")
        return answer, groups

    async def _revise(self, window: list[dict], messages: list[dict]) -> tuple[int, list[int]]:
        """How many sentences changed, and the ids of the ones merged into another."""
        try:
            answer, groups = await self._answer(window, messages)
        except asyncio.CancelledError:
            raise
        except Exception:
            answer, groups = await self._answer(window, messages)
        changed, gone = [], []
        for group, item in zip(groups, answer["sentences"]):
            sentence, taken = window[group[0] - 1], [window[number - 1] for number in group[1:]]
            source = self.convert(item["src"].strip()) if sentence["lang"] == "zh" else item["src"].strip()
            target = "" if not self.translate else self.convert(item["tgt"].strip()) if sentence.get("targetLang") == "zh" else item["tgt"].strip()
            if taken or (source, target) != (sentence["source"], sentence["target"]):
                sentence["source"], sentence["target"] = source, target
                event = {"id": sentence["id"], "source": source, "target": target}
                if taken:   # one sentence now: it ends where the last of them ended
                    sentence["endMs"] = taken[-1]["endMs"]
                    event.update(merged=[s["id"] for s in taken], endMs=sentence["endMs"])
                    gone += event["merged"]
                changed.append(event)
        notes = answer.get("notes")
        if isinstance(notes, str) and notes.strip():
            self.notes = notes.strip()[:NOTES_LIMIT]
        if changed and not self.closed:
            self.seq += 1
            await self.send({"revision": {"seq": self.seq, "sentences": changed}})
        return len(changed), gone
