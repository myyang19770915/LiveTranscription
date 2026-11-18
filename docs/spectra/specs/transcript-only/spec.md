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

When the stream's target is `none`, 精準模式 SHALL repair, segment and settle the spoken text exactly as with a translation but SHALL NOT translate: the text model SHALL be given instructions without a translation step and SHALL NOT be told a language to translate into, an answer without translations SHALL be accepted, and every sentence SHALL have an empty translation. 回顧修訂 SHALL likewise correct and merge the spoken text only.

#### Scenario: 精準模式 in a Chinese meeting

- **WHEN** a meeting with 不翻譯（只整理原文） and 精準模式 runs
- **THEN** its sentences replace the live text as corrected Chinese sentences, and no request to the text model asks for a translation


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