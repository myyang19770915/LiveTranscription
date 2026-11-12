# meeting-timeline Specification

## Purpose

A meeting's transcript, translation and recording share one timeline, so any finalized segment can be played back and corrected after the meeting. This capability covers the server-side recording, the audio time attached to recognition events, and the stored segments.

## Requirements

### Requirement: Server-side meeting recording

The gateway SHALL write every PCM16 audio frame it forwards to ASR or MAI for a meeting into that meeting's WAV file (16 kHz, 16-bit, mono) at `output/teams/<team id>/<meeting id>/audio.wav`, in arrival order, for both the local and the MAI engine. The WAV header SHALL be valid when the meeting ends normally and SHALL be repaired from the file size when the gateway next opens or serves a file left without a final header.

#### Scenario: Local engine meeting

- **WHEN** a meeting on the local engine receives 10 seconds of audio and ends
- **THEN** audio.wav exists, its header states 16 kHz mono 16-bit, and its duration is 10 seconds

#### Scenario: MAI engine meeting

- **WHEN** a meeting on the MAI engine receives audio
- **THEN** the same frames are written to audio.wav as are sent to MAI

#### Scenario: Gateway stopped mid-meeting

- **WHEN** the app stops during a meeting and the meeting audio is requested later
- **THEN** the header is repaired from the file size and the recorded audio plays


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Recognition events carry audio time

Every recognition event the gateway sends to the browser SHALL include `audioMs`, the number of milliseconds of meeting audio the gateway had received when the event was sent, computed as received PCM bytes divided by 32.

#### Scenario: Event after three seconds of audio

- **WHEN** the gateway has received 96000 bytes of PCM and forwards a recognition event
- **THEN** the event sent to the browser contains `audioMs: 3000`


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Segments record their time span

Each finalized translation segment SHALL record `endMs` as the `audioMs` of the first recognition event whose text reached the segment's end, and `startMs` as the previous segment's `endMs` (0 for the first segment). Because recognized text arrives after its audio, playback SHALL begin 3000 ms before `startMs` (not before 0) and end 500 ms after `endMs` (not after the recording's end); these padding values SHALL be constants set from the measured lag (bench/lagcheck.py: median 0.5–3.8 s for Chinese and Japanese).

#### Scenario: Consecutive segments

- **WHEN** segment 1 ends at an event with `audioMs` 4200 and segment 2 ends at an event with `audioMs` 9100
- **THEN** segment 1 spans 0–4200 and segment 2 spans 4200–9100

##### Example: playback window

| startMs | endMs | Recording length | Played range |
| ------- | ----- | ---------------- | ------------ |
| 0 | 4200 | 60000 | 0–4700 |
| 4200 | 9100 | 60000 | 1200–9600 |
| 58000 | 59800 | 60000 | 55000–60000 |


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Segments are stored with the meeting

The system SHALL store each finalized segment of a meeting with its sequence number, `startMs`, `endMs`, the original ASR text, the current source text, the live translation, the current translation, and the detected language. The meeting SHALL store its glossary and its learned terms. The browser SHALL save segments during the meeting at most every 10 seconds when segments changed and SHALL save all segments when the meeting ends and after each background refinement that changes a translation. Saving SHALL update existing segments by sequence number and SHALL NOT change the original ASR text or the live translation once stored, nor overwrite a segment that has a review edit.

#### Scenario: Refinement after the meeting ended

- **WHEN** a background refinement changes segment 7's translation after the meeting ended and segment 7 has no review edit
- **THEN** the stored current translation of segment 7 is the refined text and its live translation is unchanged

#### Scenario: Save after a reviewer already edited

- **WHEN** a late save from the meeting page arrives for a segment that a reviewer has already edited
- **THEN** the stored segment keeps the reviewer's text

<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Unsaved segments are shown and retried

When saving a meeting's segments fails, the live page SHALL retry with the latest segments after 5, 15 and 30 seconds and then every 60 seconds until a save succeeds, and SHALL show next to the status 段落尚未儲存，<n> 秒後重試 as a warning. After a successful save it SHALL show 段落已儲存 <HH:MM:SS>. When the server answers 401 the page SHALL stop retrying and show 登入已失效，段落尚未儲存，請重新登入. While segments are waiting to be saved or a save has failed, closing or reloading the page SHALL ask for confirmation. Retries SHALL only send segments for the meeting they belong to; once another meeting has started, retries for the previous one SHALL stop.

#### Scenario: The network drops during a meeting

- **WHEN** two saves in a row fail and the third succeeds
- **THEN** the page shows 段落尚未儲存，5 秒後重試, then 段落尚未儲存，15 秒後重試, then 段落已儲存 with the time, and the third request carries the segments finalized up to that moment

##### Example: retry schedule

| Failures in a row | Next retry after | Shown |
| ----------------- | ---------------- | ----- |
| 1 | 5 s | 段落尚未儲存，5 秒後重試 |
| 2 | 15 s | 段落尚未儲存，15 秒後重試 |
| 3 | 30 s | 段落尚未儲存，30 秒後重試 |
| 4 or more | 60 s | 段落尚未儲存，60 秒後重試 |
| answered 401 | none | 登入已失效，段落尚未儲存，請重新登入 |

#### Scenario: Leaving with unsaved segments

- **WHEN** a save has failed and the user closes the tab
- **THEN** the browser asks for confirmation before leaving

<!-- @trace
source: segment-save-retry
updated: 2026-11-12
code:
  - test_asr_session.py
  - bench/closecheck.js
  - docker/asr/constraints.txt
  - webapp/.dockerignore
  - bench/checks.js
  - webapp/static/index.html
  - webapp/static/minutes.js
  - webapp/static/styles.css
  - webapp/server.py
  - webapp/reminders.py
  - webapp/static/app.js
  - asr_session.py
  - webapp/auth.py
  - ws_server.py
  - webapp/static/review.js
  - bench/contextcheck.js
  - webapp/mailer.py
  - webapp/qa.py
  - webapp/migrations/016_reminder_claims.sql
  - bench/savecheck.js
  - README.md
  - webapp/stream_limits.py
  - webapp/Dockerfile
  - webapp/static/review.html
  - bench/catalogcheck.js
  - bench/reviewcheck.js
  - webapp/migrations/017_mail_setting_changes.sql
  - webapp/static/minutes.html
  - bench/mailchangecheck.js
  - docker/asr/entrypoint.sh
  - compose.yaml
  - bench/guardcheck.js
tests:
  - webapp/test_server.py
-->