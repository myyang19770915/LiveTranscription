# privacy-notice Specification

## Purpose

The live page tells the user where meeting audio and text are processed, because the answer depends on the recognition engine and the cloud refinement choice. This capability covers that notice and its wording.

## Requirements

### Requirement: The live page states where audio and text go

The live page SHALL show a privacy notice in its header and the same label in its footer, made of a short label and a sentence chosen by the current recognition engine, the cloud refinement choice and whether the translation model is an external service (`cloudTranslate` of `/api/config`) as in the example table. The recognition engine SHALL be the one the spoken language decides (`local` or `mai`, as meeting-setup-layout specifies); when no cloud engine is configured it SHALL count as `local`. The notice SHALL be updated as soon as the spoken language or the cloud refinement choice changes, and after the page has applied the remembered choices. When the cloud refinement checkbox is hidden, refinement SHALL count as off. When the translation model is external, the notice SHALL never say that text stays on the host. Until the page has read `/api/config` the notice SHALL show 資料去向 and 確認中…, and when that request fails the page SHALL treat the translation model as external. The live page and the sign-in page SHALL NOT state that audio stays on the user's device or that processing is end-to-end local, and SHALL NOT name a server folder as the place where recordings are stored. The `hybrid` rows of the table remain the wording `PrivacyNote.text` gives callers that pass `hybrid`; the live page itself SHALL pass only `local` or `mai`.

#### Scenario: Notice follows the choices

- **WHEN** the spoken language gives the engine of a row and the user chooses that row's cloud refinement setting
- **THEN** the notice shows the label and sentence of the matching row of the example table

##### Example: notice wording

| Engine | Cloud refinement | External translation | Label | Sentence |
| ------ | ---------------- | -------------------- | ----- | -------- |
| local | off | no | 自架主機 | 音訊與文字只在語橋主機處理 |
| local | on | no | 雲端精修 | 文字會傳送到外部服務 |
| hybrid | off | no | 雲端辨識 | 中文以外的音訊會傳送到外部服務 |
| mai | off | no | 雲端辨識 | 音訊會傳送到外部服務 |
| hybrid | on | no | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |
| mai | on | no | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |
| local | off | yes | 雲端翻譯 | 文字會傳送到外部服務 |
| local | on | yes | 雲端翻譯與精修 | 文字會傳送到外部服務 |
| hybrid | off | yes | 雲端辨識與翻譯 | 音訊與文字會傳送到外部服務 |
| mai | off | yes | 雲端辨識與翻譯 | 音訊與文字會傳送到外部服務 |
| mai | on | yes | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |

#### Scenario: Spoken language changed before a meeting

- **WHEN** the server offers MAI, there is no external translation and no refinement, the notice shows 自架主機 for 中文, and the user switches the spoken language to 日本語
- **THEN** the notice shows 雲端辨識 and 音訊會傳送到外部服務 without reloading the page

#### Scenario: No claim of on-device processing

- **WHEN** a user opens the live page or the sign-in page
- **THEN** neither page contains 不離開你的設備, 端對端本機處理 or output 資料夾

#### Scenario: Settings could not be read

- **WHEN** the request for `/api/config` fails and the engine is local
- **THEN** the notice shows 雲端翻譯 and 文字會傳送到外部服務

#### Scenario: External translation with the local engine

- **WHEN** `/api/config` reports `cloudTranslate` true, the engine is local and cloud refinement is off
- **THEN** the notice shows 雲端翻譯 and 文字會傳送到外部服務


<!-- @trace
source: engine-auto-and-mode-help
updated: 2026-11-15
code:
  - bench/README.md
  - webapp/static/refine.css
  - bench/translate_e2e.mjs
  - webapp/static/app.js
  - bench/ui_polish_e2e.mjs
  - webapp/static/index.html
  - chang01.png
-->


<!-- @trace
source: plain-wording-no-tech-names
updated: 2026-11-17
code:
  - webapp/static/ask.js
  - webapp/static/privacy-note.js
  - bench/interpret_e2e.mjs
  - bench/series_e2e.mjs
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - bench/README.md
  - README.md
  - webapp/static/meetings.html
  - webapp/static/admin.html
  - lab/realtime-translate/index.html
  - webapp/server.py
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - bench/qa_e2e.mjs
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/interpret.css
  - webapp/static/metrics.js
  - webapp/static/refine.css
  - webapp/static/index.html
  - bench/translate_e2e.mjs
  - webapp/migrations/019_interpret_usage.sql
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - chang01.png
  - webapp/static/minutes.js
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/interpret.py
  - bench/ui_polish_e2e.mjs
  - webapp/interpret_usage.py
  - .env.example
  - webapp/static/admin.css
  - webapp/static/ask.html
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/qa.py
  - lab/realtime-translate/costs.jsonl
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - webapp/minutes.py
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - compose.yaml
  - lab/realtime-translate/server.py
  - webapp/static/metrics.html
  - lab/realtime-translate/sessions/20261117-174651/output.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: The sign-in page shows no real account name

The account field of the sign-in page SHALL have the placeholder 公司帳號 and SHALL NOT contain the name of any existing account.

#### Scenario: Placeholder

- **WHEN** a signed-out user opens the sign-in page
- **THEN** the account field placeholder is 公司帳號

<!-- @trace
source: privacy-copy
updated: 2026-11-13
code:
  - bench/returnpathcheck.js
  - webapp/static/meetings.html
  - webapp/static/app.js
  - webapp/static/metrics.html
  - webapp/static/admin.html
  - webapp/static/return-path.js
  - bench/privacycheck.js
  - bench/qualitycheck.js
  - webapp/response_headers.py
  - webapp/static/account.js
  - webapp/static/minutes.html
  - webapp/static/search.html
  - webapp/static/ask.html
  - webapp/static/wake-lock.js
  - README.md
  - webapp/static/review.html
  - bench/wakelockcheck.js
  - webapp/quality_pass.py
  - webapp/static/index.html
  - webapp/static/not-found.html
  - webapp/auth.py
  - webapp/server.py
  - webapp/static/login.html
  - webapp/static/privacy-note.js
  - webapp/static/quality-view.js
  - webapp/static/actions.html
tests:
  - webapp/test_server.py
-->