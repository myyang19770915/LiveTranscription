# privacy-notice Specification

## Purpose

The live page tells the user where meeting audio and text are processed, because the answer depends on the recognition engine and the cloud refinement choice. This capability covers that notice and its wording.

## Requirements

### Requirement: The live page states where audio and text go

The live page SHALL show a privacy notice in its header and the same label in its footer, made of a short label and a sentence chosen by the current recognition engine, the cloud refinement choice and whether the translation model is an external service (`cloudTranslate` of `/api/config`) as in the example table. The notice SHALL be updated as soon as the engine or the cloud refinement choice changes, and after the page has applied the remembered choices. When the engine selector is hidden because no cloud engine is configured, the engine SHALL count as `local`; when the cloud refinement checkbox is hidden, refinement SHALL count as off. When the translation model is external, the notice SHALL never say that text stays on the host. Until the page has read `/api/config` the notice SHALL show 資料去向 and 確認中…, and when that request fails the page SHALL treat the translation model as external. The live page and the sign-in page SHALL NOT state that audio stays on the user's device or that processing is end-to-end local, and SHALL NOT name a server folder as the place where recordings are stored.

#### Scenario: Notice follows the choices

- **WHEN** the user chooses a recognition engine and a cloud refinement setting
- **THEN** the notice shows the label and sentence of the matching row of the example table

##### Example: notice wording

| Engine | Cloud refinement | External translation | Label | Sentence |
| ------ | ---------------- | -------------------- | ----- | -------- |
| local | off | no | 自架主機 | 音訊與文字只在語橋主機處理 |
| local | on | no | 雲端精修 | 文字會傳送到外部模型服務 |
| hybrid | off | no | 雲端辨識 | 中文以外的音訊會傳送到 Azure |
| mai | off | no | 雲端辨識 | 音訊會傳送到 Azure |
| hybrid | on | no | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |
| mai | on | no | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |
| local | off | yes | 雲端翻譯 | 文字會傳送到外部模型服務 |
| local | on | yes | 雲端翻譯與精修 | 文字會傳送到外部模型服務 |
| hybrid | off | yes | 雲端辨識與翻譯 | 音訊與文字會傳送到外部服務 |
| mai | off | yes | 雲端辨識與翻譯 | 音訊與文字會傳送到外部服務 |
| mai | on | yes | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |

#### Scenario: Engine changed before a meeting

- **WHEN** the notice shows 自架主機 and the user switches the engine to 雲端 MAI
- **THEN** the notice shows 雲端辨識 and 音訊會傳送到 Azure without reloading the page

#### Scenario: No claim of on-device processing

- **WHEN** a user opens the live page or the sign-in page
- **THEN** neither page contains 不離開你的設備, 端對端本機處理 or output 資料夾

#### Scenario: Settings could not be read

- **WHEN** the request for `/api/config` fails and the engine is local
- **THEN** the notice shows 雲端翻譯 and 文字會傳送到外部模型服務

#### Scenario: External translation with the local engine

- **WHEN** `/api/config` reports `cloudTranslate` true, the engine is local and cloud refinement is off
- **THEN** the notice shows 雲端翻譯 and 文字會傳送到外部模型服務


<!-- @trace
source: cloud-translation
updated: 2026-11-14
code:
  - bench/privacy_e2e.mjs
  - bench/privacycheck.js
  - README.md
  - webapp/quality_pass.py
  - webapp/server.py
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - webapp/chunk_asr.py
  - bench/blindn.py
  - bench/README.md
  - compose.yaml
  - .env.example
  - docker/qwen-asr/healthcheck.py
  - webapp/static/index.html
  - README.en.md
  - README.deploy.md
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