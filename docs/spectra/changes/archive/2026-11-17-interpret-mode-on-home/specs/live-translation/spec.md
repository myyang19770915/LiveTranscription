## MODIFIED Requirements

### Requirement: Translate-only sessions

The live page SHALL offer a mode switch between 開會, 即時翻譯 and 即時口譯 (realtime-interpret), remembered in the browser. In 即時翻譯 mode the team, topic and series fields and the series panel SHALL be hidden, the start button SHALL read 開始翻譯, and starting SHALL NOT require membership of any team. A translate-only session SHALL create no meeting record and SHALL NOT appear in the meeting list; it SHALL be saved as the user's own record (realtime-interpret, `kind` `translate`) holding the audio sent, the source text and the translation, and the page SHALL say so with 存成你的紀錄，只有你看得到 instead of saying that nothing is kept. The transcript and the browser-side recording SHALL stay available for download from the page until the next session starts. The mode SHALL NOT change while a session is running.

In 即時翻譯 mode, continuous Chinese or Japanese speech without a sentence end or pause SHALL be finalized for translation at the last settled clause boundary (a comma followed by at least 8 further characters) once the untranslated text reaches 40 characters, each segment at least 16 characters, while clauses the segmentation rules consider unfinished (connectives such as 因為, 如果; open endings such as 的, 就) stay joined. 開會 mode SHALL keep the 100-character threshold.

The `/ws/transcribe` handshake SHALL accept `mode: "translate"` and `mode: "interpret"` without a `meeting_id`: the gateway SHALL forward audio to the chosen engine and return recognition events without `audioMs`, SHALL write nothing under `output/teams`, and SHALL still require a signed-in user and a same-origin request. With `mode: "translate"` the gateway SHALL write the audio it forwards, as it arrives, into a working folder under `output/interpret/<username>/` and keep the last `displayText` it sent as the source text; when it starts writing it SHALL send `{"record": <token>}`, a random token valid for this connection only, and when the connection ends with any audio it SHALL save the record, with the last translation received for the token, and send `{"saved": <id>}` before closing. With `mode: "interpret"` it SHALL save nothing, since `/ws/interpret` saves that session. While the session runs the page SHALL send its translation every 30 seconds when it has changed with `PUT /api/interpret/live/<token>/translation` (`{"text"}`, at most 200000 characters; 404 for a token that is unknown or another user's); a failed request SHALL be retried at the next 30 seconds without stopping the session. After `saved` the page SHALL send its full translation once more with `PUT /api/interpret/sessions/<id>/translation`; when that fails the page SHALL say 譯文沒有存到紀錄，可以先匯出. A handshake without `mode` SHALL keep the existing meeting checks.

#### Scenario: Translating a video

- **WHEN** a user switches to 即時翻譯, chooses 分頁／系統聲音, presses 開始翻譯 and later stops
- **THEN** the transcript and translation appear as during a meeting, the meeting list has no new entry afterwards, 匯出逐字稿 downloads the text, and 我的紀錄 lists a 即時翻譯 record with that source text and translation

#### Scenario: Continuous speech is finalized in subtitle-sized segments

- **WHEN** in 即時翻譯 mode the untranslated transcript is 他說我們今天要討論的是這個新的工作流，因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明 with no sentence end or pause
- **THEN** the next finalized segment ends at a comma and is between 16 and 60 characters long, and the same text in 開會 mode is not finalized yet

#### Scenario: User without a team

- **WHEN** a user who belongs to no team switches to 即時翻譯 and presses 開始翻譯
- **THEN** the session starts

#### Scenario: Translate handshake saves a record, not a meeting

- **WHEN** a signed-in client opens `/ws/transcribe` with `{"mode": "translate", "language": "zh"}`, sends one second of audio and ends the stream
- **THEN** recognition events come back without `audioMs`, the client receives `{"saved": <id>}`, `output/interpret/<username>/<id>/input.wav` lasts 1.0 second, no row is added to `meetings`, and no file is written under `output/teams`

#### Scenario: The translation is saved during the session

- **WHEN** a 即時翻譯 session runs for 70 seconds and its tab is closed without stopping
- **THEN** the page has sent the translation at 30 and 60 seconds, and the saved record holds the translation as of 60 seconds

#### Scenario: Interpret handshake saves nothing

- **WHEN** a signed-in client opens `/ws/transcribe` with `{"mode": "interpret", "language": "en", "engine": "mai"}` and sends audio
- **THEN** recognition events come back, no `saved` event is sent, and no folder is written under `output/interpret`

#### Scenario: Meeting handshake unchanged

- **WHEN** a client opens `/ws/transcribe` with `{"language": "zh"}` and no `meeting_id`
- **THEN** the connection is closed with 4404 before any audio is forwarded

##### Example: Live profile segment lengths

| Untranslated text (live profile) | Finalized segment |
| --- | --- |
| 他說我們今天要討論的是這個新的工作流，因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明 | ends at a comma, 16–60 characters |
| 因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明 | never ends right after 因為很多同事都還不熟悉， |
