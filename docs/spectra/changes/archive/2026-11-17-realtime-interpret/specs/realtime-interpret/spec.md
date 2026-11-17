## Purpose

即時口譯 (`/interpret`) lets system administrators try Azure GPT-Realtime-Translate inside 語橋: speech goes in, translated speech and text come back, the source text is recognized by 語橋's own engines, and every session is saved for its owner to replay. The translation cost is recorded next to the MAI usage.

## ADDED Requirements

### Requirement: The interpret page is for system administrators

`GET /interpret` SHALL return the interpret page to a system administrator, the 沒有權限 page with status 403 to a signed-in user who is not one, and the usual sign-in redirect to a visitor who is not signed in. The WebSocket `/ws/interpret` SHALL close with code 4401 when the connection has no session and with code 4403 when its user is not a system administrator, in both cases before any connection to Azure is made. Every `/api/interpret/*` endpoint SHALL answer 401 without a session and 403 for a user who is not a system administrator. The team administration page (`/admin`) SHALL show administrators a link to `/interpret` named 即時口譯.

#### Scenario: Who can open the page

- **WHEN** the given user requests `/interpret`
- **THEN** the response is the one in the example table

##### Example: access

| User | Response |
| ---- | -------- |
| administrator t05313 | 200, the interpret page |
| member alice | 403, 沒有權限 |
| not signed in | redirect to `/login?next=%2Finterpret` |

#### Scenario: A member opens the WebSocket

- **WHEN** member alice opens `/ws/interpret`
- **THEN** it closes with code 4403 and no connection to Azure is opened

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
- **THEN** `GET /api/interpret/config` returns `"configured": false`, the page shows 尚未設定 Azure 即時口譯 with the 連線 button disabled, and `/ws/interpret` closes with code 4503

### Requirement: The source text comes from 語橋's recognition

While a session is connected the interpret page SHALL also send the same audio, at 16 kHz, to `/ws/transcribe` with the start message `{"mode":"translate","language":<sourceLang>,"engine":<engine>}`, where the engine is `local` for 中文 (`zh`), 中英混合 (`auto`) and 粵語 (`yue`) and `mai` for every other speaking language, and SHALL show the recognized text in the 原文 column with the engine named (本機 Confucius or 雲端 MAI). Each time the settled source text changes the page SHALL send it on `/ws/interpret` as `{"type":"source","text":<text>}`, and the server SHALL save the last one received. When `/ws/transcribe` fails the page SHALL show the reason and the translation SHALL continue.

#### Scenario: English speech

- **WHEN** an administrator chooses 說話語言 English and connects
- **THEN** `/ws/transcribe` receives engine `mai`, the 原文 column is labelled 雲端 MAI, and the audio sent there is recorded under the MAI usage purpose `live`

### Requirement: Playing the translation aloud is optional

The page SHALL offer a checkbox 同步播放譯音, checked by default and remembered in the browser. When it is unchecked the translated speech SHALL NOT be heard while the session runs, including audio already scheduled; checking it again SHALL make the following speech heard. The checkbox SHALL NOT change what is saved or drawn.

#### Scenario: Reading only

- **WHEN** an administrator unchecks 同步播放譯音 and speaks for 10 seconds
- **THEN** nothing is played, the translation text and the output waveform still appear, and the saved session contains the translated audio

### Requirement: Sessions are saved for their owner

When a session ends with any audio sent or received, the server SHALL save it under `output/interpret/<username>/<id>/`, where `<id>` is the start time `YYYYMMDD-HHMMSS` (with `-2`, `-3`… when taken), as `input.wav` (the audio sent, 24 kHz mono), `output.wav` (the translated audio, each piece placed at the time it arrived on the session clock and never overlapping the previous one, with silence between), `session.json` (`id`, `startedAt`, `target`, `sourceLang`, `engine`, `inputSeconds`, `outputSeconds`, `sourceText`, `translation`, `usd`) and `transcript.txt`. A session with no audio either way SHALL NOT be saved. `GET /api/interpret/sessions` SHALL list only the requesting administrator's sessions, newest first; `GET /api/interpret/sessions/<id>`, `GET /api/interpret/sessions/<id>/<input.wav|output.wav|transcript.txt>` and `DELETE /api/interpret/sessions/<id>` SHALL act only on the requester's own session and SHALL answer 404 for another user's id, for an id not matching `^\d{8}-\d{6}(-\d+)?$`, and for any other file name.

#### Scenario: Another administrator's session

- **WHEN** administrator t05313 requests `/api/interpret/sessions/20261117-174651` that belongs to administrator myyang
- **THEN** the response is 404 and the file is not read

#### Scenario: A saved session

- **WHEN** an administrator sends 10 seconds of audio and the translation arrives as two pieces of 3 seconds each, at 2.0 and 4.0 seconds
- **THEN** `input.wav` lasts 10.0 seconds, `output.wav` lasts 8.0 seconds with audio from 2.0 to 5.0 and 5.0 to 8.0 seconds, and `outputSeconds` is 6.0

##### Example: placing translated audio

| Arrivals (time, length) | output.wav pieces |
| ----------------------- | ----------------- |
| (2.0 s, 3 s), (4.0 s, 3 s) | 2.0–5.0, 5.0–8.0 |
| (1.0 s, 1 s), (5.0 s, 2 s) | 1.0–2.0, 5.0–7.0 |
| (0.5 s, 2 s) | 0.5–2.5 |

### Requirement: Saved sessions can be replayed from any point

The page SHALL list the administrator's sessions under 我的紀錄 with time, languages, length, cost and the start of the text, each with 載入, 原音, 譯音, 文字 and 刪除 (which asks for confirmation). 載入 SHALL restore the waveform, the source text and the translation. The buttons 播放整段（原音＋譯音）, 只聽譯音 and 只聽原音 SHALL play the session on its own clock with a moving playhead, and the last one used SHALL be marked as the current mode (整段 when none was used). Clicking or dragging on the waveform SHALL move the playhead with the pointer and, on release, play from that point in the current mode; doing so during playback SHALL keep the mode of that playback.

#### Scenario: Seeking in translation-only mode

- **WHEN** an administrator plays 只聽譯音, stops it, and drags on the waveform to 7.6 seconds
- **THEN** only the translated audio plays, starting at 7.6 seconds

### Requirement: Translation cost is recorded for administrators

When a session ends the server SHALL add its translated audio seconds to today's row (date in `MEETING_TIMEZONE`) of the table `interpret_usage (day, purpose, seconds)` with purpose `live`; the saved session's `usd` SHALL be those seconds / 3600 × `INTERPRET_USD_PER_HOUR` (default 2.04). A failure to write the usage SHALL be logged and SHALL NOT stop the session from being saved. `GET /api/admin/interpret-usage` SHALL require a system administrator and SHALL return `seconds`, `usd` (rounded to 2 decimals), `usdPerHour` and `byPurpose`. The team administration page SHALL show these figures in a card 即時口譯（GPT-Realtime-Translate）用量. The translation cost SHALL NOT be added to the MAI budget. `python -m interpret_usage add <seconds> <purpose>` SHALL add usage by hand with the same purpose rules as `mai_usage` (1–40 of `a-z`, `0-9`, `-`; seconds more than 0 and finite), and `python -m interpret_usage` SHALL print the total.

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
