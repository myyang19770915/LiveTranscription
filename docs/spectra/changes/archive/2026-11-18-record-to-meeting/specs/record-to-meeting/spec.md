## Purpose

A 即時翻譯 or 即時口譯 record in 我的紀錄 can become a team meeting in one step, with its sentences, translations and recording, so that it can be reviewed, played back and summarized like any meeting.

## ADDED Requirements

### Requirement: 即時翻譯 records keep their sentences

When a 即時翻譯 session sends its translation to its record (every 30 seconds and once more after saving), the page SHALL also send the finished sentences as `segments`, each with `startMs`, `endMs`, `source`, `target` and `detected`, on the same timeline as the record's audio. The server SHALL store them with the record and SHALL answer 422 when there are more than 5000 sentences, a text longer than 2000 characters, a negative time or `endMs` before `startMs`. A request without `segments` SHALL keep only the text, as before.

#### Scenario: A translated session is saved

- **WHEN** a 即時翻譯 session with three finished sentences is stopped
- **THEN** the record's `session.json` holds three `segments` with their times, source and translation

##### Example: segment checks

| segments | Answer |
| -------- | ------ |
| `[{startMs:0,endMs:1200,source:"大家好",target:"Hello everyone",detected:"zh"}]` | stored |
| `[{startMs:1200,endMs:800,…}]` | 422 |
| 5001 sentences | 422 |

### Requirement: Turning a record into a meeting

Each record in 我的紀錄 SHALL offer 轉成會議紀錄, which asks for one of the user's teams and a title (by default 即時翻譯 or 即時口譯 followed by the start time) and creates a meeting of that team, created by the user, starting at the record's start, with the record's languages and recording (16 kHz; a 24 kHz 即時口譯 recording is converted). A record with sentences SHALL become the meeting's segments directly and at once. Only the owner SHALL convert a record; a team the user does not belong to SHALL answer 404. The record SHALL be kept, marked 已轉成會議紀錄 with a link to the meeting, and a second conversion SHALL answer 409 with the meeting's id.

#### Scenario: Converting a translated session

- **WHEN** alice converts her 即時翻譯 record with three sentences into team 產品部 with the title 週會
- **THEN** 產品部 has a meeting 週會 with the three sentences at their times and the recording, and 我的紀錄 shows the record as 已轉成會議紀錄 linking to it

#### Scenario: Converting twice

- **WHEN** alice converts the same record again
- **THEN** the server answers 409 with the existing meeting's id and no second meeting is created

### Requirement: Records without sentences go through 精準模式

A 即時口譯 record, or a 即時翻譯 record saved without sentences, SHALL be converted by passing its whole recording through 精準模式, with every language recognized by the offline transcription model (Qwen3-ASR) rather than a real-time one, then segmented and translated by 精準模式's text model; its sentences become the meeting's segments. The page SHALL say before starting that 精準模式 will recognize and translate again, that audio and text are sent to an external service, and how long it is expected to take, and SHALL show the progress (processed time of the total) until the meeting is ready. The meeting SHALL be created only when every part succeeded; when any part fails no meeting is created and the page says 部分內容處理失敗，請再試一次. When the transcription model or 精準模式's text model is not configured these records SHALL NOT be converted and the page SHALL say why. A user SHALL run at most one conversion at a time and the server at most two (429 beyond).

#### Scenario: Converting an interpreted session

- **WHEN** alice converts her 即時口譯 record of 2 minutes into 產品部
- **THEN** the page shows the external-service note and the progress, and when it finishes 產品部 has a meeting whose segments are 精準模式's sentences and whose recording is the 16 kHz version of the record's audio

#### Scenario: A part fails

- **WHEN** one part of a 精準模式 conversion fails
- **THEN** no meeting is created, the record is not marked, and the page says 部分內容處理失敗，請再試一次
