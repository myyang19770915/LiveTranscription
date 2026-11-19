# transcript-only Specification

## Purpose

A meeting can be transcribed without any translation: the live text, and 精準模式's cleaned-up sentences, stay in the spoken language only.

## Requirements

### Requirement: A meeting without translation

In 開會 mode, 翻譯成 SHALL offer 不翻譯（只整理原文） (value `none`) as its first option; 即時翻譯 and 即時口譯 SHALL NOT offer it. With it chosen the page SHALL send no translation, term-learning or cloud-refinement request, SHALL hide the translation pane and give the transcript the full width, SHALL show the source text as the main text of the floating subtitles and 畫面＋字幕, and SHALL save every segment with an empty translation and the meeting's target language as `none`. In 開會 mode the spoken language and 翻譯成 (不翻譯 included) SHALL be remembered in the browser, so a Chinese meeting without translation needs no choice the next time.

#### Scenario: A Chinese meeting without translation

- **WHEN** a member chooses 中文 and 不翻譯（只整理原文）, starts the meeting and speaks
- **THEN** the transcript fills the page, no request goes to `/api/translate`, `/api/translate/stream` or `/api/terms`, and the saved segments have the spoken text and an empty translation

##### Example: what is sent

| 翻譯成 | `/api/translate/stream` requests | translation pane |
| ------ | -------------------------------- | ---------------- |
| English | one per draft and segment | shown |
| 不翻譯（只整理原文） | none | hidden |


<!-- @trace
source: transcript-only-meeting
updated: 2026-11-18
code:
  - chang01.png
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - lab/realtime-translate/index.html
  - webapp/static/meeting-nav.js
  - lab/realtime-translate/server.py
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/costs.jsonl
  - webapp/static/index.html
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/quality_pass.py
  - webapp/static/review.html
  - bench/transcript_only_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - webapp/static/minutes.html
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/revise_pass.py
  - webapp/static/review.js
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/refine.css
tests:
  - webapp/test_server.py
-->

---
### Requirement: 精準模式 without translation

When the stream's target is `none`, 精準模式 SHALL repair, segment and settle the spoken text as with a translation but SHALL NOT translate: the text model SHALL be given instructions without a translation step and SHALL NOT be told a language to translate into, an answer without translations SHALL be accepted, and every sentence SHALL have an empty translation. 回顧修訂 SHALL likewise correct and merge the spoken text only.

Without translation, the instructions to the text model (for chunks and for 回顧修訂) SHALL ask for a clean, readable transcript as an editor of meeting minutes would write it: fix recognition errors and wrong characters, use the standard written form of words and terms with Taiwan usage, remove filler words that carry no meaning (嗯, 呃, 欸, 那個, 就是, 然後, 的話, 對對對 used as fillers), stutters, false starts and words said twice by mistake, and make each sentence read smoothly. The same instructions SHALL state these limits: every point that was said is kept (facts, numbers, names, negations, conditions, hedges, questions) and nothing is summarized or added; speech in English or another language is kept as spoken and not translated; a direct quote stays a direct quote; a sentence the speaker left unfinished is not completed or paraphrased and the speaker's meaning is not changed; each item holds one complete thought; and 回顧修訂 leaves a sentence that already reads well word for word. The instructions for a translated stream SHALL NOT change.

#### Scenario: 精準模式 in a Chinese meeting

- **WHEN** a meeting with 不翻譯（只整理原文） and 精準模式 runs
- **THEN** its sentences replace the live text as corrected Chinese sentences, and no request to the text model asks for a translation

#### Scenario: Polished, not translated

- **WHEN** the system prompt for a Chinese stream with target `none` is built, and the 回顧修訂 prompt for a stream without translation
- **THEN** both ask to remove filler words such as 那個 and 就是, and both state that English speech is kept as spoken, a direct quote stays direct, an unfinished sentence is not completed, and nothing is added or summarized
- **AND** the system prompt for a Chinese stream translated into English, and the 回顧修訂 prompt with translation, are unchanged by this requirement

##### Example: a polished sentence

| Recognized | Polished |
| ---------- | -------- |
| 那個我們就是下週要把代辦事項整理一下 | 我們下週要把待辦事項整理一下。 |
| 他說：「OK, thank you，我們再看看」 | 他說：「OK, thank you，我們再看看。」 |


<!-- @trace
source: transcript-polish
updated: 2026-11-19
code:
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/index.html
  - lab/realtime-translate/server.py
  - webapp/quality_pass.py
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/costs.jsonl
  - bench/rubric_transcript.md
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261117-174651/output.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: The meeting page of a meeting without translation

The review page of a meeting whose target language is `none` SHALL show only the source column and SHALL NOT offer retranslation.

#### Scenario: Reviewing it

- **WHEN** the member opens that meeting's review page
- **THEN** there is no 譯文 column and no 重譯 action

<!-- @trace
source: transcript-only-meeting
updated: 2026-11-18
code:
  - chang01.png
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - lab/realtime-translate/index.html
  - webapp/static/meeting-nav.js
  - lab/realtime-translate/server.py
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/costs.jsonl
  - webapp/static/index.html
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/quality_pass.py
  - webapp/static/review.html
  - bench/transcript_only_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - webapp/static/minutes.html
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/revise_pass.py
  - webapp/static/review.js
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/refine.css
tests:
  - webapp/test_server.py
-->

---
### Requirement: Nothing said is silently left out without translation

When the stream's target is `none`, 精準模式 SHALL compare, character by character in order, the text it gave the text model (the carried text and the new text, with filler words such as 嗯, 呃, 那個, 就是, 然後, 的話 removed, both in Traditional characters) with the text of the answer (every sentence and the carry, before repeated sentences are removed). When a run of at least 8 consecutive letters or digits (6 words for text written mostly in Latin script) of the given text has no counterpart in the answer (nothing in its place, or a stand-in under a third of its length), and is not merely moved within the answer or said again elsewhere in the given text (fewer than 8 of its letters or digits are new when runs of 3 or more shared with the rest of the given text are discounted), the request SHALL be sent once more with that run named as left out, and of the two answers the one whose longest left-out run is shorter SHALL be used; a failed second request SHALL keep the first answer. 回顧修訂 SHALL make the same comparison for each item of an answer against the sentences it stands for, and an answer that leaves out such a run SHALL be unusable (asked once more, then the window stays as it was). Logs SHALL record only how many characters were left out, never the text. A translated stream SHALL NOT make these comparisons.

#### Scenario: A dropped sentence is asked for again

- **WHEN** a chunk without translation gives 「回到家裡跟家人起了爭執對方就會說你不要這麼情緒化好不好」 and the first answer's sentences leave that out
- **THEN** the request is sent once more naming the left-out text, and the second answer, which includes it, is used

##### Example: what counts as left out

| Given (after fillers removed) | Answer | Left out |
| ----------------------------- | ------ | -------- |
| 我們下週要把待辦事項整理一下 | 我們下週要把待辦事項整理一下。 | nothing |
| 那個我們就是下週要把代辦事項整理一下 | 我們下週要把待辦事項整理一下。 | nothing (fillers, one corrected character) |
| 那是在職場上回到家裡跟家人起了爭執 | 那是在職場上。 | 回到家裡跟家人起了爭執 (11 characters) |
| 這是對的嗎他問 | 這是對的嗎？ | nothing (2 characters is below 8) |
| 我們下週要把待辦事項我們下週要把待辦事項整理一下 | 我們下週要把待辦事項整理一下。 | nothing (said twice) |
| 我們下個禮拜要去台北不是我們下個禮拜要去台中 | 我們下個禮拜要去台中。 | nothing (a false start: what it adds is under 8 characters) |
| 這件事情我們要先跟客戶確認時間 | 我們要先跟客戶確認時間這件事情。 | nothing (moved) |


<!-- @trace
source: transcript-completeness
updated: 2026-11-19
code:
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/server.py
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/quality_pass.py
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/index.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - chang01.png
  - bench/cases_transcript.json
  - lab/realtime-translate/sessions/20261117-174651/session.json
tests:
  - webapp/test_server.py
-->

---
### Requirement: Without translation the wording follows the evidence and names learned so far

When the stream's target is `none`, the instructions to the text model (for chunks and for 回顧修訂) SHALL state that a content word is changed only when it sounds similar and the context or the other recognizer supports the change, never only to make the sentence read better; that a short answer by another person is its own item; that quotation marks cover only the quoted words; and that 然後, 就是 and 的話 stay where they carry time order, a condition or a definition. Each chunk request SHALL include the notes 回顧修訂 has gathered so far (people, names and terms of this meeting), labelled as hints for spelling names and terms and never as content, once there are any.

#### Scenario: Names learned in revision reach the next chunk

- **WHEN** 回顧修訂 has returned notes naming 阿總 as a participant and the next chunk is sent to the text model
- **THEN** that request contains those notes under NOTES, and a translated stream's request contains no NOTES

<!-- @trace
source: transcript-completeness
updated: 2026-11-19
code:
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/server.py
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/quality_pass.py
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/index.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - chang01.png
  - bench/cases_transcript.json
  - lab/realtime-translate/sessions/20261117-174651/session.json
tests:
  - webapp/test_server.py
-->

---
### Requirement: Without translation speaker turns stay apart

When the stream's target is `none`, the instructions for chunks SHALL state that when the speaker changes (a question, an answer, a backchannel) a new item starts, that two people's words are never in one item, and that a tag question (對不對？) stays with the person who said it; the 回顧修訂 instructions, which may only merge items, SHALL state that items spoken by different people are never merged and that a tag question is never merged with another person's words. They SHALL NOT ask for names to be locked to their first spelling: measured on 8 clips (2026-11-19), that rule together with "keep unclear words" carried a misheard name (Keith Johnstone → Kiss Johnson) through a whole clip and merged two names into one. The instructions for a translated stream SHALL NOT change.

#### Scenario: A question and its answer

- **WHEN** the instructions for a stream without translation are built, for chunks and for 回顧修訂
- **THEN** both contain their rule on separate speaker turns and neither contains a rule locking names to their first spelling
- **AND** the instructions with translation contain no speaker-turn rule

##### Example: what the rule aims at

| Recognized | Expected in the transcript |
| ---------- | -------------------------- |
| 然後它就會在前面 廣告的前面嗎 還是自然搜尋結果的前面 (two speakers) | two items: the statement, then the question |
| 是羞辱彼此的角色嗎 對不對 不是羞辱彼此的角色 (two speakers) | 對不對 stays with the question |

<!-- @trace
source: transcript-names-turns
updated: 2026-11-19
code:
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/index.html
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/quality_pass.py
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/server.py
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - chang01.png
  - lab/realtime-translate/server.py
  - bench/cases_transcript.json
  - lab/realtime-translate/sessions/20261117-174651/output.wav
tests:
  - webapp/test_server.py
-->