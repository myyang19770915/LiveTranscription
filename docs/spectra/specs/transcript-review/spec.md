# transcript-review Specification

## Purpose

After a meeting, team members review the transcript against the recording, correct recognition errors, and get the translation corrected the same way live refinement does it. Every change is kept so the corrections can later train the ASR model.

## Requirements

### Requirement: Meeting list

The system SHALL provide a meeting list page showing, newest first, the meetings of the teams the signed-in user belongs to, with team, start time, duration, creator, language, number of segments, and number of reviewed segments. Meetings without stored segments SHALL be listed without a review link.

#### Scenario: Two teams

- **WHEN** a user in teams "研發" and "業務" opens the meeting list
- **THEN** meetings of both teams appear, newest first, and no meeting of any other team appears


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Review page shows aligned segments

The review page of a meeting SHALL show every stored segment in order with its time span, current source text and current translation side by side, and SHALL mark each segment as unreviewed, confirmed, or edited. When the meeting has speakers, each segment SHALL also show its speaker's name (or 說話者 N), and the page SHALL show the meeting's diarization status (queued, running, done or failed with its message) and the list of its speakers.

#### Scenario: Opening a meeting

- **WHEN** a team member opens the review page of a meeting with 42 segments
- **THEN** 42 rows appear in order, each with its time span formatted as mm:ss, its source and its translation

#### Scenario: Opening a diarized meeting

- **WHEN** a team member opens the review page of a meeting whose diarization is done with speakers 林怡安 and 說話者 2
- **THEN** each row shows 林怡安, 說話者 2 or no speaker before its text, and the speaker list shows both speakers with their segment counts


<!-- @trace
source: speaker-diarization
updated: 2026-11-08
code:
  - bench/diarize/run_moss.py
  - bench/diarize/score.py
  - 20261029_185428.mp4
  - README.md
  - webapp/diarize.py
  - bench/diarize/tcpp_parse.py
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/speakers.js
  - bench/diarize/segment_eval.mjs
  - webapp/static/review.html
  - bench/diarize/Dockerfile.eval
  - webapp/server.py
  - compose.yaml
  - bench/diarize/prep.py
  - bench/diarize/segment_eval.py
  - bench/speakers_e2e.mjs
  - docker/diarize/Dockerfile
  - bench/README.md
  - bench/diarize/run_tcpp.sh
  - webapp/meeting_audio.py
  - bench/diarize/metrics.py
  - bench/diarize/run_sherpa.py
  - docker/diarize/server.py
  - docs/roadmap.md
  - webapp/minutes.py
  - webapp/review.py
  - webapp/static/review.js
  - 20261108_143903.mp4
  - webapp/team_access.py
  - .env.example
  - webapp/migrations/012_speakers.sql
  - webapp/static/speakers.css
tests:
  - docker/diarize/test_server.py
  - webapp/test_server.py
-->

---
### Requirement: Segment playback

Selecting a segment SHALL play the recording for that segment's playback window. For a segment marked as timed (speaker-diarization "Segment times follow the recording") the window SHALL run from 300 ms before its start to 300 ms after its end; for any other segment it SHALL run from 3000 ms before its start to 500 ms after its end. The window SHALL stay inside the recording. The reviewer SHALL be able to extend the window by 2 seconds at the start or at the end, and to replay it. The play control SHALL pause the segment while it plays and resume it from the same position while it is paused; once the clip has ended, or when another segment's clip is loaded, it SHALL play the segment from the start of its window. Next to the control the page SHALL show the current position and the end of the window as mm:ss on the meeting timeline. With a segment open and the focus not on an input, select, button or link, the space bar SHALL play or pause that segment. While the speaker timeline plays, the segment marked at the play position SHALL be found with the same lead: 300 ms before the start of a timed segment, 3000 ms before the start of any other. The audio SHALL be served only to members of the meeting's team, as WAV for the requested range.

#### Scenario: Playing a segment

- **WHEN** a reviewer selects the segment spanning 4200–9100 that is not marked as timed
- **THEN** the page plays the recording from 1200 to 9600

#### Scenario: Playing a timed segment

- **WHEN** a reviewer selects the segment spanning 4200–9100 that is marked as timed
- **THEN** the page plays the recording from 3900 to 9400

#### Scenario: Extending the start

- **WHEN** the reviewer extends the start of the segment spanning 4200–9100 that is not marked as timed once and replays
- **THEN** playback runs from 0 to 9600

#### Scenario: Pausing and resuming

- **WHEN** the reviewer presses 暫停 while that segment plays at 3.4 seconds into the clip, waits, and presses 繼續
- **THEN** playback stops, the position stays at 3.4 seconds while paused, the control reads 繼續, and playback continues from 3.4 seconds

#### Scenario: Space bar

- **WHEN** a segment is open and playing, the focus is on the page, and the reviewer presses the space bar
- **THEN** playback pauses

#### Scenario: Audio range of another team

- **WHEN** a user requests an audio range of a meeting of a team they are not in
- **THEN** the system responds 404

#### Scenario: The segment marked while the timeline plays

- **WHEN** the timeline plays at 21500 and the timed segments are 12811–17578 and 21330–27040
- **THEN** the segment 21330–27040 is the one marked


<!-- @trace
source: segment-audio-times
updated: 2026-11-24
code:
  - webapp/static/timeline.js
  - webapp/static/review.js
  - webapp/static/speakers.js
  - webapp/static/evidence-panel.js
  - webapp/static/review.html
  - webapp/static/minutes.html
  - webapp/static/ask.html
  - webapp/static/index.html
tests:
  - bench/timelinecheck.js
  - bench/segment_times_e2e.mjs
-->

---
### Requirement: Correcting a transcript segment retranslates it

When a reviewer saves a changed source text for a segment, the system SHALL store the new source and then retranslate the segment with the same request the live refinement pass builds: up to two previous segments' source and translation as context (same direction only in 中日雙向 mode), the first 120 characters of the next segment as following context, the meeting glossary, the meeting's learned terms, and the cloud refinement choice shown on the review page. The repetition check used by live refinement SHALL apply; a rejected retranslation SHALL keep the previous translation and show 重譯結果重複了前後文，已保留原譯文. A failed retranslation SHALL keep the new source, keep the previous translation, and show a retry action.

#### Scenario: Corrected word

- **WHEN** a reviewer changes "城市設計" to "程式設計" in segment 12 and saves
- **THEN** segment 12's source is "程式設計…", a retranslation request is sent containing segments 10 and 11 as history and the start of segment 13 as following context, and the new translation replaces the old one

#### Scenario: Translation service unavailable

- **WHEN** the retranslation request fails
- **THEN** the corrected source is kept, the old translation stays, and the segment shows 重譯失敗 with a retry action


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Retranslating the next segment

After a segment's source is corrected, the review page SHALL offer to retranslate the next segment, because its context changed. It SHALL NOT retranslate other segments automatically.

#### Scenario: Offer after a correction

- **WHEN** segment 12 is corrected and retranslated
- **THEN** the page offers 一併重譯下一段 for segment 13, and segment 13 is unchanged until the reviewer accepts


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Edit history

Every saved correction and every retranslation SHALL be recorded as a new history entry with the reviewer, the time, the source before and after, and the translation before and after; entries SHALL never be modified or deleted through the app. The original ASR text SHALL remain retrievable after any number of edits. The review page SHALL show a segment's history on request.

#### Scenario: Two edits of one segment

- **WHEN** alice edits segment 5 and later bob edits segment 5 again
- **THEN** segment 5 has two history entries in order, the first by alice and the second by bob, and the original ASR text is unchanged


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Confirming a segment without changes

A reviewer SHALL be able to mark a segment as confirmed correct without changing it; the confirmation SHALL be recorded with the reviewer and time. Editing a confirmed segment SHALL make it edited.

#### Scenario: Confirming

- **WHEN** a reviewer confirms segment 3 unchanged
- **THEN** segment 3 shows as confirmed and a history entry records the confirmation


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Concurrent edits are detected

Each segment SHALL carry a version number that every save increments. A save based on an older version SHALL be refused with 409, the review page SHALL show 這段已被其他人修改，已重新載入 and SHALL reload that segment. A retranslation SHALL be saved against the version the segment had when the retranslation started, so an edit made while the translation was running makes the save refused rather than overwritten; when the segment's original text changed while the translation was running, the review page SHALL discard the result without saving and show 原文已再次修改，略過這次重譯.

#### Scenario: Two reviewers

- **WHEN** alice and bob both open segment 5 at version 2, alice saves first, then bob saves
- **THEN** alice's save succeeds with version 3, bob's save is refused with 409, and bob sees alice's text


#### Scenario: An edit during a retranslation

- **WHEN** a segment at version 4 is being retranslated after an edit, and before the translation finishes the segment is edited again to version 5
- **THEN** the finished translation is not saved, the segment keeps the version-5 text, and the page shows 原文已再次修改，略過這次重譯

##### Example: what a finished retranslation does

| Version at start | Text at finish | Version at finish | Result |
| ---------------- | -------------- | ----------------- | ------ |
| 4 | unchanged | 4 | saved with version 4 |
| 4 | changed | 5 | discarded, not sent |
| 4 | unchanged | 5 (confirmed by someone else) | sent with version 4, refused with 409, segment reloaded |


<!-- @trace
source: review-retranslate-race
updated: 2026-11-12
code:
  - docker/asr/entrypoint.sh
  - webapp/migrations/017_mail_setting_changes.sql
  - webapp/server.py
  - bench/mailchangecheck.js
  - bench/closecheck.js
  - webapp/static/app.js
  - webapp/mailer.py
  - bench/savecheck.js
  - webapp/reminders.py
  - webapp/static/minutes.js
  - bench/contextcheck.js
  - webapp/.dockerignore
  - webapp/static/styles.css
  - ws_server.py
  - README.md
  - bench/catalogcheck.js
  - bench/reviewcheck.js
  - test_asr_session.py
  - webapp/qa.py
  - bench/guardcheck.js
  - docker/asr/constraints.txt
  - webapp/Dockerfile
  - compose.yaml
  - webapp/migrations/016_reminder_claims.sql
  - webapp/static/review.html
  - webapp/static/index.html
  - bench/checks.js
  - webapp/static/minutes.html
  - webapp/auth.py
  - asr_session.py
  - webapp/stream_limits.py
  - webapp/static/review.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Only team members review

Viewing, playing, editing, confirming and retranslating SHALL be allowed to every member of the meeting's team and to no one else; non-members SHALL receive 404.

#### Scenario: Member of another team edits

- **WHEN** a user who is not in the meeting's team sends a segment edit
- **THEN** the system responds 404 and stores nothing

<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Translation stays visible while correcting

While a reviewer edits a segment's source text on the review page, the segment's translation SHALL stay shown in the translation column next to the editor, so the reviewer can compare the two while typing. When the meeting has no translation column, or on a phone-width layout where the columns stack, the editor SHALL take the source text's place in that layout.

#### Scenario: Editing a translated segment

- **WHEN** a reviewer presses 修改原文 on a segment whose translation is "Hello everyone" in a 1280px wide window
- **THEN** the editor appears in the source column and "Hello everyone" is shown in the translation column with the same column width as before editing

<!-- @trace
source: ui-review-fixes
updated: 2026-11-15
code:
  - webapp/static/review.html
  - docs/ui-review-shots/qa-answer.jpeg
  - webapp/static/meetings.html
  - docs/ui-review-shots/minutes-empty.jpeg
  - docs/ui-review-shots/search-results.jpeg
  - webapp/static/accounts.css
  - webapp/static/not-found.html
  - docs/ui-review-shots/metrics.jpeg
  - webapp/static/search.html
  - docs/ui-review-shots/team-management.jpeg
  - docs/ui-review-codex.md
  - webapp/static/minutes.html
  - chang01.png
  - bench/ui_review_e2e.mjs
  - webapp/static/admin.css
  - docs/ui-review-shots/meetings-list.jpeg
  - docs/ui-review-shots/mobile-transcript-review.jpeg
  - webapp/static/account.js
  - docs/ui-review-shots/meeting-live.jpeg
  - webapp/static/ask.html
  - bench/README.md
  - webapp/static/actions.html
  - webapp/static/admin.html
  - docs/ui-review-shots/login-dark.jpeg
  - webapp/static/index.html
  - webapp/static/metrics.html
  - docs/ui-review-shots/404-page.jpeg
  - webapp/static/review.css
  - docs/ui-review-shots/actions-board.jpeg
tests:
  - webapp/test_server.py
-->