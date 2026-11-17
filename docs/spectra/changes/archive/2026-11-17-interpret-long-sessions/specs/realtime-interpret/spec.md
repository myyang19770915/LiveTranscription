## MODIFIED Requirements

### Requirement: The source text comes from 語橋's recognition

While a session is connected the interpret page SHALL also send the same audio, at 16 kHz, to `/ws/transcribe` with the start message `{"mode":"translate","language":<sourceLang>,"engine":<engine>}`, where the engine is `local` for 中文 (`zh`), 中英混合 (`auto`) and 粵語 (`yue`) and `mai` for every other speaking language, and SHALL show the recognized text in the 原文 column with the engine named (本機辨識 or 雲端辨識). Each time the settled source text changes the page SHALL send only the change on `/ws/interpret` as `{"type":"source","keep":<n>,"text":<rest>}`, where `n` is the length of the part shared with the text sent before and `rest` is the new text after it. The server SHALL keep the first `n` characters of the source text it holds, append `rest`, and keep at most 200000 characters; a message without `keep` SHALL replace the whole source text, and a message whose `keep` is not an integer from 0 to the length of the held text SHALL be ignored. When `/ws/transcribe` fails the page SHALL show the reason and the translation SHALL continue.

#### Scenario: English speech

- **WHEN** an administrator chooses 說話語言 English and connects
- **THEN** `/ws/transcribe` receives engine `mai`, the 原文 column is labelled 雲端辨識, and the audio sent there is recorded under the MAI usage purpose `live`

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

### Requirement: Sessions are saved for their owner

While a session runs the server SHALL write the audio to disk as it arrives and SHALL NOT keep the whole session's audio in memory: from the first audio sent or received it SHALL write into a working folder under `output/interpret/<username>/` whose name starts with `.`, and when the session ends it SHALL rename that folder to `<id>`, where `<id>` is the start time `YYYYMMDD-HHMMSS` (with `-2`, `-3`… when taken). A saved session SHALL hold `input.wav` (the audio sent, 24 kHz mono), `output.wav` (the translated audio, each piece placed at the time it arrived on the session clock and never overlapping the previous one, with silence between), `session.json` (`id`, `startedAt`, `target`, `sourceLang`, `engine`, `inputSeconds`, `outputSeconds`, `sourceText`, `translation`, `usd`), `transcript.txt` and `bars.json` (the waveform: `{"step":0.1,"input":[…],"output":[[t,v],…]}`, one RMS value from 0 to 1 per 0.1 second of `input.wav`, and for the translated audio one `[t, v]` per 0.1 second of each piece at its time `t` in `output.wav`, leaving out silent values). A session with no audio either way SHALL NOT be saved and SHALL leave no folder. A working folder SHALL NOT be listed or readable through the API. `GET /api/interpret/sessions` SHALL list only the requesting administrator's sessions, newest first; `GET /api/interpret/sessions/<id>`, `GET /api/interpret/sessions/<id>/bars`, `GET /api/interpret/sessions/<id>/<input.wav|output.wav|transcript.txt>` and `DELETE /api/interpret/sessions/<id>` SHALL act only on the requester's own session and SHALL answer 404 for another user's id, for an id not matching `^\d{8}-\d{6}(-\d+)?$`, and for any other file name. For a session saved without `bars.json`, `GET /api/interpret/sessions/<id>/bars` SHALL compute the waveform from the two WAV files, with the translated audio in 0.1-second steps from the start of `output.wav`, so the values are the same when every piece starts on a 0.1-second step.

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

#### Scenario: Audio is on disk during the session

- **WHEN** an administrator has sent three chunks of 0.1 second (4800 bytes each) and the session is still open
- **THEN** a folder starting with `.` holds `input.wav` of 44 + 14400 bytes, and `GET /api/interpret/sessions` lists nothing for it

#### Scenario: The waveform of a session

- **WHEN** a session sends 0.3 second of audio at full scale (every sample 32767) and receives one translated piece of 0.2 second at full scale at 1.0 second followed by 0.1 second of silence
- **THEN** `bars` answers `input` `[1.0, 1.0, 1.0]` and `output` `[[1.0, 1.0], [1.1, 1.0]]`, and after `bars.json` is removed it answers the same

### Requirement: Saved sessions can be replayed from any point

The page SHALL list the administrator's sessions under 我的紀錄 with time, languages, length, cost and the start of the text, each with 載入, 原音, 譯音, 文字 and 刪除 (which asks for confirmation). 載入 SHALL restore the waveform (from `GET /api/interpret/sessions/<id>/bars`), the source text and the translation, without downloading the audio files first. The buttons 播放整段（原音＋譯音）, 只聽譯音 and 只聽原音 SHALL play the session's `input.wav` and `output.wav` from the server on the session's own clock with a moving playhead, and the last one used SHALL be marked as the current mode (整段 when none was used). Clicking or dragging on the waveform SHALL move the playhead with the pointer and, on release, play from that point in the current mode; doing so during playback SHALL keep the mode of that playback. While a session runs the page SHALL keep only the waveform values, not the audio; when the session ends and is saved the page SHALL show the saved session so it can be replayed, and when it is not saved the replay buttons SHALL stay disabled.

#### Scenario: Seeking in translation-only mode

- **WHEN** an administrator plays 只聽譯音, stops it, and drags on the waveform to 7.6 seconds
- **THEN** only the translated audio plays, starting at 7.6 seconds

#### Scenario: Replaying right after a session

- **WHEN** an administrator stops a session and the server reports it saved as 20261117-180000
- **THEN** the page shows 已存檔：20261117-180000, the waveform and texts come from that saved session, and 播放整段（原音＋譯音） plays it
