# realtime-interpret Specification

## Purpose

即時口譯 (`/interpret`) lets system administrators try Azure GPT-Realtime-Translate inside 語橋: speech goes in, translated speech and text come back, the source text is recognized by 語橋's own engines, and every session is saved for its owner to replay. The translation cost is recorded next to the MAI usage.

## Requirements

### Requirement: Translation is proxied with the key kept on the server

`/ws/interpret` SHALL take its first text message as the start message `{"target": <language>, "sourceLang": <language>}` and SHALL close with code 4408 when none arrives within `STREAM_HEADER_TIMEOUT` seconds. `target` SHALL be one of the 58 language codes the model accepts (`he` and `iw` both name Hebrew) (`af`, `ar`, `az`, `be`, `bg`, `bs`, `ca`, `cs`, `cy`, `da`, `de`, `el`, `en`, `es`, `et`, `fa`, `fi`, `fr`, `gl`, `he`, `hi`, `hr`, `hu`, `hy`, `id`, `is`, `it`, `iw`, `ja`, `kk`, `kn`, `ko`, `lt`, `lv`, `mi`, `mk`, `mr`, `ms`, `ne`, `nl`, `no`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sr`, `sv`, `sw`, `ta`, `th`, `tl`, `tr`, `uk`, `ur`, `vi`, `zh`); any other value SHALL close the connection with code 4400 before Azure is contacted. The server SHALL connect to `wss://<host of AZURE_gpt_realtime_translate_ENDPOINT>/openai/v1/realtime/translations?model=<AZURE_gpt_realtime_translate_DEPLOYMENT>` with the key from `AZURE_gpt_realtime_translate_KEY` in the `api-key` header, set the output language with `session.update`, forward each binary message from the browser (24 kHz 16-bit mono PCM) as `session.input_audio_buffer.append`, and send the browser `{"type":"audio","audio":<base64>}` for each translated audio delta and `{"type":"out","delta":<text>}` for each translated text delta. When `target` is `zh` the text SHALL be converted to Taiwan Traditional Chinese before it is sent or saved. The key SHALL NOT appear in any response, page, log line or saved file. A connection SHALL take one of the user's `MAX_STREAMS_PER_USER` stream places and free it when it closes, and SHALL accept at most `MAX_STREAM_HOURS` hours of audio (172,800,000 bytes per hour at 24 kHz), closing with code 4413 beyond it. `{"type":"stop"}` from the browser SHALL end the session: the server sends `session.close`, waits up to 8 seconds for the remaining translation, and then saves the session.

#### Scenario: Translating to Chinese

- **WHEN** an allowed user starts with target `zh` and Azure returns the text delta 这个软件
- **THEN** the browser receives `{"type":"out","delta":"這個軟體"}`

#### Scenario: An unsupported language

- **WHEN** the start message names target `zh-TW`
- **THEN** the connection closes with code 4400 and Azure is not contacted

#### Scenario: Not configured

- **WHEN** `AZURE_gpt_realtime_translate_ENDPOINT` or `AZURE_gpt_realtime_translate_KEY` is empty
- **THEN** `GET /api/interpret/config` returns `"configured": false`, the live page shows 即時口譯 disabled with 即時口譯尚未設定，請聯絡系統管理員, and `/ws/interpret` closes with code 4503


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: The source text comes from 語橋's recognition

While an interpret session is connected the live page SHALL also send the same audio, at 16 kHz, to `/ws/transcribe` with the start message `{"mode":"interpret","language":<sourceLang>,"engine":<engine>}`, where the engine is the one the spoken language decides on the live page (`local` or `mai`), and SHALL show the recognized text in 原始逐字稿. Each time the settled source text changes the page SHALL send only the change on `/ws/interpret` as `{"type":"source","keep":<n>,"text":<rest>}`, where `n` is the length of the part shared with the text sent before and `rest` is the new text after it. The server SHALL keep the first `n` characters of the source text it holds, append `rest`, and keep at most 200000 characters; a message without `keep` SHALL replace the whole source text, and a message whose `keep` is not an integer from 0 to the length of the held text SHALL be ignored. When `/ws/transcribe` fails the page SHALL show the reason and the interpreting SHALL continue.

#### Scenario: English speech

- **WHEN** an allowed user chooses 說話語言 English in 即時口譯 mode and starts
- **THEN** `/ws/transcribe` receives mode `interpret` and engine `mai`, and the audio sent there is recorded under the MAI usage purpose `live`

#### Scenario: The source text grows

- **WHEN** the settled source text goes from 大家好 to 大家好，今天 and then to 大家好，今天開會
- **THEN** the page sends `{"type":"source","keep":0,"text":"大家好"}`, `{"type":"source","keep":3,"text":"，今天"}` and `{"type":"source","keep":6,"text":"開會"}`, and the saved `sourceText` is 大家好，今天開會

##### Example: applying a source message

| Held text | Message | Held text after |
| --------- | ------- | --------------- |
| 大家好 | keep 3, text ，今天 | 大家好，今天 |
| 大家好，今天 | keep 4, text 明天 | 大家好，明天 |
| 大家好 | text 你好 (no keep) | 你好 |
| 大家好 | keep 9, text 。 | 大家好 (ignored) |
| 大家好 | keep -1, text 。 | 大家好 (ignored) |


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Playing the translation aloud is optional

In 即時口譯 mode the live page SHALL offer a checkbox 同步播放譯音, checked by default and remembered in the browser. When it is unchecked the translated speech SHALL NOT be heard while the session runs, including audio already scheduled; checking it again SHALL make the following speech heard. The checkbox SHALL NOT change what is saved or shown.

#### Scenario: Reading only

- **WHEN** an allowed user unchecks 同步播放譯音 and speaks for 10 seconds
- **THEN** nothing is played, the interpreted text still appears, and the saved session contains the translated audio


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Sessions are saved for their owner

While a session runs the server SHALL write the audio to disk as it arrives and SHALL NOT keep the whole session's audio in memory: from the first audio sent or received it SHALL write into a working folder under `output/interpret/<username>/` whose name starts with `.`, and when the session ends it SHALL rename that folder to `<id>`, where `<id>` is the start time `YYYYMMDD-HHMMSS` (with `-2`, `-3`… when taken). A saved interpret session SHALL hold `input.wav` (the audio sent, 24 kHz mono), `output.wav` (the translated audio, each piece placed at the time it arrived on the session clock and never overlapping the previous one, with silence between), `session.json` (`id`, `kind` `interpret`, `startedAt`, `target`, `sourceLang`, `engine`, `inputSeconds`, `outputSeconds`, `sourceText`, `translation`, `usd`), `transcript.txt` and `bars.json` (the waveform: `{"step":0.1,"input":[…],"output":[[t,v],…]}`, one RMS value from 0 to 1 per 0.1 second of `input.wav`, and for the translated audio one `[t, v]` per 0.1 second of each piece at its time `t` in `output.wav`, leaving out silent values). A saved 即時翻譯 session (live-translation) SHALL hold `input.wav` at 16 kHz, `session.json` with `kind` `translate`, `outputSeconds` 0 and `usd` 0, `transcript.txt` and `bars.json` with an empty `output`. A session without `kind` SHALL count as `interpret`. A session with no audio either way SHALL NOT be saved and SHALL leave no folder. A working folder SHALL NOT be listed or readable through the API. Every signed-in user SHALL be able to use `GET /api/interpret/sessions`, which SHALL list only the requesting user's sessions, newest first; `GET /api/interpret/sessions/<id>`, `GET /api/interpret/sessions/<id>/bars`, `GET /api/interpret/sessions/<id>/<input.wav|output.wav|transcript.txt>`, `PUT /api/interpret/sessions/<id>/translation` and `DELETE /api/interpret/sessions/<id>` SHALL act only on the requester's own session and SHALL answer 404 for another user's id, for an id not matching `^\d{8}-\d{6}(-\d+)?$`, and for any other file name. `PUT …/translation` with `{"text": <text>}` SHALL replace the translation of a `translate` session (at most 200000 characters, 422 beyond) in `session.json` and `transcript.txt`, and SHALL answer 409 for an `interpret` session. For a session saved without `bars.json`, `GET /api/interpret/sessions/<id>/bars` SHALL compute the waveform from the WAV files, with the translated audio in 0.1-second steps from the start of `output.wav`, so the values are the same when every piece starts on a 0.1-second step.

#### Scenario: Another user's session

- **WHEN** user t05313 requests `/api/interpret/sessions/20261117-174651` that belongs to user myyang
- **THEN** the response is 404 and the file is not read

#### Scenario: A saved session

- **WHEN** an allowed user sends 10 seconds of audio and the translation arrives as two pieces of 3 seconds each, at 2.0 and 4.0 seconds
- **THEN** `input.wav` lasts 10.0 seconds, `output.wav` lasts 8.0 seconds with audio from 2.0 to 5.0 and 5.0 to 8.0 seconds, and `outputSeconds` is 6.0

##### Example: placing translated audio

| Arrivals (time, length) | output.wav pieces |
| ----------------------- | ----------------- |
| (2.0 s, 3 s), (4.0 s, 3 s) | 2.0–5.0, 5.0–8.0 |
| (1.0 s, 1 s), (5.0 s, 2 s) | 1.0–2.0, 5.0–7.0 |
| (0.5 s, 2 s) | 0.5–2.5 |

#### Scenario: Audio is on disk during the session

- **WHEN** an allowed user has sent three chunks of 0.1 second (4800 bytes each) and the session is still open
- **THEN** a folder starting with `.` holds `input.wav` of 44 + 14400 bytes, and `GET /api/interpret/sessions` lists nothing for it

#### Scenario: The waveform of a session

- **WHEN** a session sends 0.3 second of audio at full scale (every sample 32767) and receives one translated piece of 0.2 second at full scale at 1.0 second followed by 0.1 second of silence
- **THEN** `bars` answers `input` `[1.0, 1.0, 1.0]` and `output` `[[1.0, 1.0], [1.1, 1.0]]`, and after `bars.json` is removed it answers the same

#### Scenario: The translation of a 即時翻譯 session

- **WHEN** the owner of a `translate` session sends `PUT …/translation` with Hello everyone.
- **THEN** `GET /api/interpret/sessions/<id>` has `translation` Hello everyone. and the same request for an `interpret` session answers 409


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Saved sessions can be replayed from any point

On 我的紀錄, 載入 SHALL restore the waveform (from `GET /api/interpret/sessions/<id>/bars`), the source text and the translation, without downloading the audio files first. The buttons 播放整段（原音＋譯音）, 只聽譯音 and 只聽原音 SHALL play the session's `input.wav` and `output.wav` from the server on the session's own clock with a moving playhead, and the last one used SHALL be marked as the current mode (整段 when none was used); for a `translate` session only 只聽原音 SHALL be enabled. Clicking or dragging on the waveform SHALL move the playhead with the pointer and, on release, play from that point in the current mode; doing so during playback SHALL keep the mode of that playback.

#### Scenario: Seeking in translation-only mode

- **WHEN** a user loads an interpret session, plays 只聽譯音, stops it, and drags on the waveform to 7.6 seconds
- **THEN** only the translated audio plays, starting at 7.6 seconds

#### Scenario: Opening a session from the live page

- **WHEN** a user follows 在我的紀錄開啟 after an interpret session saved as 20261117-180000
- **THEN** 我的紀錄 opens with that session loaded, and 播放整段（原音＋譯音） plays it


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Translation cost is recorded for administrators

When an interpret session ends the server SHALL add its translated audio seconds to today's row (date in `MEETING_TIMEZONE`) of the table `interpret_usage (day, purpose, username, seconds)` with purpose `live` and the user's name; rows written before this field existed SHALL have the username `''`. The saved session's `usd` SHALL be those seconds / 3600 × `INTERPRET_USD_PER_HOUR` (default 2.04). A failure to write the usage SHALL be logged and SHALL NOT stop the session from being saved. `GET /api/admin/interpret-usage` SHALL require a system administrator and SHALL return `seconds`, `usd` (rounded to 2 decimals), `usdPerHour`, `byPurpose` and `byUser` (seconds per username). The team administration page SHALL show these figures in a card 即時口譯用量 with a line per user (the empty username shown as （未記名）). There SHALL be no usage limit. The translation cost SHALL NOT be added to the MAI budget. `python -m interpret_usage add <seconds> <purpose>` SHALL add usage by hand with the same purpose rules as `mai_usage` (1–40 of `a-z`, `0-9`, `-`; seconds more than 0 and finite) and the username `''`, and `python -m interpret_usage` SHALL print the total.

#### Scenario: Cost of a session

- **WHEN** alice's session produces 15.4 seconds of translated audio with the default price
- **THEN** `interpret_usage` grows by 15.4 seconds for purpose `live` and username `alice`, and the session's `usd` is 0.0087

##### Example: usage figures

| Seconds recorded | `INTERPRET_USD_PER_HOUR` | `usd` |
| ---------------- | ------------------------ | ----- |
| 0 | 2.04 | 0 |
| 1800 | 2.04 | 1.02 |
| 129 | 2.04 | 0.07 |
| 3600 | 3 | 3 |

#### Scenario: Usage per user

- **WHEN** 129 seconds were added by hand and alice used 1800 seconds
- **THEN** `byUser` is `{"": 129, "alice": 1800}` and the card lists alice and （未記名）

#### Scenario: A member asks for the usage

- **WHEN** member alice requests `/api/admin/interpret-usage`
- **THEN** the response is 403


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Interpreting is open to granted users

A user SHALL be allowed to interpret when the user is a system administrator or the username is in the table `interpret_access (username, granted_by, granted_at)`. `GET /api/admin/interpret-access`, `POST /api/admin/interpret-access` with `{"username": <name>}` and `DELETE /api/admin/interpret-access/<username>` SHALL require a system administrator (403 otherwise) and SHALL list, grant and withdraw access; a username SHALL be lower-cased and SHALL match `^[a-z0-9_][a-z0-9._-]{0,63}$`, otherwise the answer is 422. The team administration page SHALL show a section 即時口譯權限 listing the granted accounts with 移除, a field to add a 公司帳號, and a note that interpreting is used from the live page. `GET /api/interpret/config` SHALL answer every signed-in user with `configured`, `allowed`, `usdPerHour` and `targets`. `/ws/interpret` SHALL close with code 4401 without a session and with code 4403 and the reason 即時口譯需要申請權限，請聯絡系統管理員 when the user is not allowed, in both cases before any connection to the translation service; while a session runs, the periodic session re-check SHALL also re-check the access, and a withdrawn access SHALL stop the session with code 4403 and save what there is.

#### Scenario: Granting a member

- **WHEN** an administrator adds 公司帳號 Alice in 即時口譯權限
- **THEN** `interpret_access` holds `alice`, and alice's `/api/interpret/config` answers `"allowed": true`

#### Scenario: A member without access opens the WebSocket

- **WHEN** member bob, not granted, opens `/ws/interpret`
- **THEN** it closes with code 4403 and the translation service is not contacted

#### Scenario: Access withdrawn during a session

- **WHEN** alice is interpreting and an administrator removes her, and the next re-check runs
- **THEN** the session stops with code 4403 and what was interpreted is saved

##### Example: who may interpret

| User | Granted | Allowed |
| ---- | ------- | ------- |
| administrator t05313 | no | yes |
| member alice | yes | yes |
| member bob | no | no |
| `POST` username `Bad Name` | — | 422 |


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Interpret mode on the live page

The live page SHALL offer the modes 開會, 即時翻譯 and 即時口譯. When `allowed` is false the 即時口譯 button SHALL be disabled and the mode note SHALL read 需要申請權限，請聯絡系統管理員; when `configured` is false it SHALL be disabled with 即時口譯尚未設定，請聯絡系統管理員; a remembered 即時口譯 mode that cannot be used SHALL open as 即時翻譯. In 即時口譯 mode the page SHALL hide the team, topic and series fields, 會議情境, 雲端精修 and 精準模式, SHALL disable 中日雙向 and the direction swap, SHALL offer as output languages the `targets` of `/api/interpret/config`, SHALL show the checkbox 同步播放譯音 in the same row as the start button, and the start button SHALL read 開始口譯 with the note 聽譯音、看譯文 on one line. The empty transcript SHALL name the start button of the current mode (開始會議, 開始翻譯 or 開始口譯). A running session SHALL send the captured audio at 24 kHz to `/ws/interpret` and at 16 kHz to `/ws/transcribe` with `mode: "interpret"` and an empty `system_prompt`, SHALL NOT request text translations, SHALL show the recognized text in 原始逐字稿 and the interpreted text in the translation pane, and the floating subtitles and 畫面＋字幕 SHALL show the interpreted text as their translation (the last two finished sentences and the unfinished rest as the draft) and the recognized text as their source. When the session ends and is saved the page SHALL show 已存檔 with a link 在我的紀錄開啟 to `/interpret?id=<id>`. 匯出逐字稿 SHALL export the source and the interpreted text.

#### Scenario: A member without access

- **WHEN** member bob, not granted, opens the live page
- **THEN** 即時口譯 is shown disabled with 需要申請權限，請聯絡系統管理員, and 開會 and 即時翻譯 work as before

#### Scenario: Interpreting a video into English

- **WHEN** alice, granted, chooses 即時口譯, 分頁／系統聲音 and English, and presses 開始口譯
- **THEN** 原始逐字稿 shows the recognized speech, the translation pane and the floating subtitles show the interpreted English, no request goes to `/api/translate/stream`, and after 停止 the page shows 已存檔 with 在我的紀錄開啟

#### Scenario: The settings of 即時口譯

- **WHEN** a granted user at 1440 px wide switches to 即時口譯
- **THEN** 會議情境 is not shown, 同步播放譯音 and 開始口譯 are in one row, and the empty transcript reads 點擊「開始口譯」


<!-- @trace
source: ui-consistency-pass
updated: 2026-11-17
code:
  - bench/ui_consistency_e2e.mjs
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.html
  - webapp/static/metrics.html
  - chang01.png
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/actions.css
  - webapp/static/ask.html
  - webapp/static/search.html
  - webapp/static/interpret-mode.js
  - bench/translate_e2e.mjs
  - webapp/static/admin.html
  - webapp/static/tokens.css
  - webapp/server.py
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/server.py
  - webapp/static/ask.css
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - bench/metrics_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/index.html
  - bench/ui_review_e2e.mjs
  - webapp/static/accounts.css
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/interpret_usage.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/account.js
  - webapp/static/interpret.css
  - webapp/static/search.css
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/admin.css
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/app.js
  - webapp/static/metrics.css
  - webapp/static/topbar.css
  - webapp/static/meetings.html
  - webapp/static/login.html
  - webapp/static/refine.css
  - bench/actions_e2e.mjs
  - webapp/static/not-found.html
  - webapp/records_retention.py
  - webapp/static/index.html
  - webapp/static/interpret-langs.js
  - webapp/static/review.css
  - webapp/interpret.py
  - webapp/static/mobile.css
  - webapp/static/review.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/themes.css
  - README.md
  - bench/interpret_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/static/interpret.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Saved records are kept for a set number of days

Saved sessions of both kinds SHALL be kept for the number of days in the setting `records_retention_days` (table `app_settings`), 90 when it is not set. `GET /api/admin/records-retention` SHALL return `{"days": <n>}` and `PUT /api/admin/records-retention` with `{"days": <n>}` SHALL change it; both SHALL require a system administrator (403 otherwise), and `days` SHALL be an integer from 1 to 3650, otherwise the answer is 422. The server SHALL delete every saved session folder under `output/interpret/<username>/` whose id date (`YYYYMMDD`, in `MEETING_TIMEZONE`) is earlier than today minus the number of days, and every working folder starting with `.recording-` that was last changed more than one day ago: once when the server starts, every 6 hours after that, and right after the setting changes. A folder that cannot be deleted SHALL be logged and SHALL NOT stop the others. The team administration page SHALL show 紀錄保存期限 with the number of days, a way to change it and the note 即時翻譯與即時口譯紀錄超過天數會自動刪除. `GET /api/interpret/config` SHALL include `retentionDays`, and 我的紀錄 SHALL read 紀錄保存 <n> 天，到期自動刪除.

#### Scenario: Old records are removed

- **WHEN** today is 2026-11-17, the setting is 90 days, and the sweep runs
- **THEN** the folders are kept or deleted as in the example table

##### Example: which folders a 90-day sweep deletes on 2026-11-17

| Folder | Result |
| ------ | ------ |
| `20260818-235959` | deleted (2026-11-17 − 90 days = 2026-08-19; this date is earlier) |
| `20260819-000000` | kept |
| `20261117-101500` | kept |
| `.recording-20261115-…` changed 2 days ago | deleted |
| `.recording-20261117-…` changed 1 hour ago | kept |

#### Scenario: An administrator shortens the period

- **WHEN** an administrator sets 紀錄保存期限 to 30 days on 2026-11-17
- **THEN** `GET /api/admin/records-retention` answers `{"days": 30}`, records dated before 2026-10-18 are deleted right away, and 我的紀錄 reads 紀錄保存 30 天，到期自動刪除

#### Scenario: Invalid number of days

- **WHEN** an administrator sends `{"days": 0}` or `{"days": "90"}`
- **THEN** the answer is 422 and the setting is unchanged


<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: My records page

`GET /interpret` SHALL return the page 我的紀錄 to every signed-in user and the sign-in redirect to a visitor. It SHALL list only the user's own saved sessions of both kinds, newest first, with time, kind (即時翻譯 or 即時口譯), languages, length, cost and the start of the text, each with 載入, 原音, 譯音 (for 即時口譯 only), 文字 and 刪除 (which asks for confirmation). Opening `/interpret?id=<id>` SHALL load that session. The page SHALL NOT offer starting a session. The live page SHALL show a link 我的紀錄 to `/interpret`.

#### Scenario: A member's records

- **WHEN** member carol, never granted, has used 即時翻譯 twice and opens `/interpret`
- **THEN** the page lists her two 即時翻譯 sessions and no one else's, and 只聽譯音 and 播放整段（原音＋譯音） are disabled for them

<!-- @trace
source: interpret-mode-on-home
updated: 2026-11-17
code:
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/interpret-mode.js
  - lab/realtime-translate/index.html
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/admin.css
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/records_retention.py
  - bench/privacy_e2e.mjs
  - webapp/interpret_usage.py
  - webapp/static/interpret-langs.js
  - bench/translate_e2e.mjs
  - webapp/server.py
  - webapp/interpret.py
  - webapp/static/review.html
  - lab/realtime-translate/server.py
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/ask.html
  - bench/interpret_e2e.mjs
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/admin.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/metrics.html
  - webapp/static/interpret.css
  - README.md
  - webapp/static/index.html
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/account.js
  - webapp/static/actions.html
  - webapp/static/search.html
  - lab/realtime-translate/sessions/20261116-232831/input.wav
tests:
  - webapp/test_server.py
-->