## MODIFIED Requirements

### Requirement: Translation is proxied with the key kept on the server

`/ws/interpret` SHALL take its first text message as the start message `{"target": <language>, "sourceLang": <language>}` and SHALL close with code 4408 when none arrives within `STREAM_HEADER_TIMEOUT` seconds. `target` SHALL be one of the 58 language codes the model accepts (`he` and `iw` both name Hebrew) (`af`, `ar`, `az`, `be`, `bg`, `bs`, `ca`, `cs`, `cy`, `da`, `de`, `el`, `en`, `es`, `et`, `fa`, `fi`, `fr`, `gl`, `he`, `hi`, `hr`, `hu`, `hy`, `id`, `is`, `it`, `iw`, `ja`, `kk`, `kn`, `ko`, `lt`, `lv`, `mi`, `mk`, `mr`, `ms`, `ne`, `nl`, `no`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sr`, `sv`, `sw`, `ta`, `th`, `tl`, `tr`, `uk`, `ur`, `vi`, `zh`); any other value SHALL close the connection with code 4400 before Azure is contacted. The server SHALL connect to `wss://<host of AZURE_gpt_realtime_translate_ENDPOINT>/openai/v1/realtime/translations?model=<AZURE_gpt_realtime_translate_DEPLOYMENT>` with the key from `AZURE_gpt_realtime_translate_KEY` in the `api-key` header, set the output language with `session.update`, forward each binary message from the browser (24 kHz 16-bit mono PCM) as `session.input_audio_buffer.append`, and send the browser `{"type":"audio","audio":<base64>}` for each translated audio delta and `{"type":"out","delta":<text>}` for each translated text delta. When `target` is `zh` the text SHALL be converted to Taiwan Traditional Chinese before it is sent or saved. The key SHALL NOT appear in any response, page, log line or saved file. A connection SHALL take one of the user's `MAX_STREAMS_PER_USER` stream places and free it when it closes, and SHALL accept at most `MAX_STREAM_HOURS` hours of audio (172,800,000 bytes per hour at 24 kHz), closing with code 4413 beyond it. `{"type":"stop"}` from the browser SHALL end the session: the server sends `session.close`, waits up to 8 seconds for the remaining translation, and then saves the session.

#### Scenario: Translating to Chinese

- **WHEN** an administrator starts with target `zh` and Azure returns the text delta 这个软件
- **THEN** the browser receives `{"type":"out","delta":"這個軟體"}`

#### Scenario: An unsupported language

- **WHEN** the start message names target `zh-TW`
- **THEN** the connection closes with code 4400 and Azure is not contacted

#### Scenario: Not configured

- **WHEN** `AZURE_gpt_realtime_translate_ENDPOINT` or `AZURE_gpt_realtime_translate_KEY` is empty
- **THEN** `GET /api/interpret/config` returns `"configured": false`, the page shows 即時口譯尚未設定，請聯絡系統管理員。 with the 連線 button disabled, and `/ws/interpret` closes with code 4503


<!-- @trace
source: realtime-interpret
updated: 2026-11-17
code:
  - lab/realtime-translate/index.html
  - chang01.png
  - lab/realtime-translate/server.py
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/admin.html
  - webapp/static/refine.css
  - webapp/interpret.py
  - webapp/static/admin.css
  - webapp/static/interpret.js
  - bench/translate_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - README.md
  - compose.yaml
  - webapp/interpret_usage.py
  - webapp/migrations/019_interpret_usage.sql
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/app.js
  - .env.example
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - bench/ui_polish_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/server.py
  - webapp/static/index.html
  - bench/interpret_e2e.mjs
  - bench/README.md
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.css
  - webapp/static/interpret.html
tests:
  - webapp/test_server.py
-->

---

### Requirement: The source text comes from 語橋's recognition

While a session is connected the interpret page SHALL also send the same audio, at 16 kHz, to `/ws/transcribe` with the start message `{"mode":"translate","language":<sourceLang>,"engine":<engine>}`, where the engine is `local` for 中文 (`zh`), 中英混合 (`auto`) and 粵語 (`yue`) and `mai` for every other speaking language, and SHALL show the recognized text in the 原文 column with the engine named (本機辨識 or 雲端辨識). Each time the settled source text changes the page SHALL send it on `/ws/interpret` as `{"type":"source","text":<text>}`, and the server SHALL save the last one received. When `/ws/transcribe` fails the page SHALL show the reason and the translation SHALL continue.

#### Scenario: English speech

- **WHEN** an administrator chooses 說話語言 English and connects
- **THEN** `/ws/transcribe` receives engine `mai`, the 原文 column is labelled 雲端辨識, and the audio sent there is recorded under the MAI usage purpose `live`


<!-- @trace
source: realtime-interpret
updated: 2026-11-17
code:
  - lab/realtime-translate/index.html
  - chang01.png
  - lab/realtime-translate/server.py
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/admin.html
  - webapp/static/refine.css
  - webapp/interpret.py
  - webapp/static/admin.css
  - webapp/static/interpret.js
  - bench/translate_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - README.md
  - compose.yaml
  - webapp/interpret_usage.py
  - webapp/migrations/019_interpret_usage.sql
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/app.js
  - .env.example
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - bench/ui_polish_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/server.py
  - webapp/static/index.html
  - bench/interpret_e2e.mjs
  - bench/README.md
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.css
  - webapp/static/interpret.html
tests:
  - webapp/test_server.py
-->

---

### Requirement: Translation cost is recorded for administrators

When a session ends the server SHALL add its translated audio seconds to today's row (date in `MEETING_TIMEZONE`) of the table `interpret_usage (day, purpose, seconds)` with purpose `live`; the saved session's `usd` SHALL be those seconds / 3600 × `INTERPRET_USD_PER_HOUR` (default 2.04). A failure to write the usage SHALL be logged and SHALL NOT stop the session from being saved. `GET /api/admin/interpret-usage` SHALL require a system administrator and SHALL return `seconds`, `usd` (rounded to 2 decimals), `usdPerHour` and `byPurpose`. The team administration page SHALL show these figures in a card 即時口譯用量. The translation cost SHALL NOT be added to the MAI budget. `python -m interpret_usage add <seconds> <purpose>` SHALL add usage by hand with the same purpose rules as `mai_usage` (1–40 of `a-z`, `0-9`, `-`; seconds more than 0 and finite), and `python -m interpret_usage` SHALL print the total.

#### Scenario: Cost of a session

- **WHEN** a session produces 15.4 seconds of translated audio with the default price
- **THEN** `interpret_usage` grows by 15.4 seconds for purpose `live` and the session's `usd` is 0.0087

##### Example: usage figures

| Seconds recorded | `INTERPRET_USD_PER_HOUR` | `usd` |
| ---------------- | ------------------------ | ----- |
| 0 | 2.04 | 0 |
| 1800 | 2.04 | 1.02 |
| 129 | 2.04 | 0.07 |
| 3600 | 3 | 3 |

#### Scenario: A member asks for the usage

- **WHEN** member alice requests `/api/admin/interpret-usage`
- **THEN** the response is 403

<!-- @trace
source: realtime-interpret
updated: 2026-11-17
code:
  - lab/realtime-translate/index.html
  - chang01.png
  - lab/realtime-translate/server.py
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/admin.html
  - webapp/static/refine.css
  - webapp/interpret.py
  - webapp/static/admin.css
  - webapp/static/interpret.js
  - bench/translate_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - README.md
  - compose.yaml
  - webapp/interpret_usage.py
  - webapp/migrations/019_interpret_usage.sql
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/app.js
  - .env.example
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - bench/ui_polish_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/server.py
  - webapp/static/index.html
  - bench/interpret_e2e.mjs
  - bench/README.md
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.css
  - webapp/static/interpret.html
tests:
  - webapp/test_server.py
-->
