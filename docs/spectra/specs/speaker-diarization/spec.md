# speaker-diarization Specification

## Purpose

Identifies who spoke each transcript segment after a meeting, using the local MOSS-Transcribe-Diarize model on CPU, and lets team members name and correct speakers, so the review page and the minutes model know who said what without using the GPU that live transcription needs.

## Requirements

### Requirement: Diarizing a meeting recording

The system SHALL diarize a meeting's recording (`audio.wav`) with the diarization service configured by `DIARIZE_URL` (MOSS-Transcribe-Diarize Q8_0 run by transcribe.cpp on CPU). A diarization SHALL be queued automatically when a meeting's recording is closed and holds at least 10 seconds of audio, and a team member SHALL be able to start one from the review page. The service SHALL process one meeting at a time; queued diarizations SHALL wait their turn. The status of a meeting's diarization SHALL be one of queued, running, done or failed; a failed diarization SHALL carry a message. A second start while one is queued or running SHALL be refused with 409; a start when `DIARIZE_URL` is empty SHALL be refused with 400 and the message 說話者辨識未設定; a start for a meeting without a recording SHALL be refused with 422. When the app restarts, diarizations that were queued or running SHALL be queued again. The service SHALL only read recordings given as `teams/<team>/<meeting>/audio.wav` under the shared output folder.

#### Scenario: Recording closes

- **WHEN** a meeting with 25 minutes of recording ends and `DIARIZE_URL` is set
- **THEN** its diarization is queued, then running, then done, without anyone starting it

#### Scenario: Short recording

- **WHEN** a meeting ends with 6 seconds of recording
- **THEN** no diarization is queued

#### Scenario: Start while running

- **WHEN** a diarization is running and a member starts it again
- **THEN** the system responds 409 and the running diarization continues

#### Scenario: Service fails

- **WHEN** the diarization service is unreachable or returns an error
- **THEN** the status becomes failed with a message, and segments, speaker names and manual speaker choices are unchanged

#### Scenario: Path outside a meeting folder

- **WHEN** the service is asked for `../../etc/passwd` or `teams/1/x/notes.txt`
- **THEN** it refuses with 400 and runs nothing


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
### Requirement: Labelling segments with speakers

When a diarization is done, the system SHALL store its speaker turns (start, end, speaker label, text) and SHALL label each segment with one speaker. A segment SHALL take the speaker whose turn text matches the most characters of the segment's source text, comparing after conversion to Traditional script with punctuation and spaces removed, among turns overlapping from 12 seconds before the segment's start to 3 seconds after its end; a match SHALL count only when the characters matched by all nearby speakers together are at least 30% of the segment's characters, and at least 2. Otherwise the segment SHALL take the speaker whose turns overlap its time span shifted 1 second earlier the most; with no overlapping turn the segment SHALL have no speaker. Speaker labels SHALL be numbered from 1 in order of first appearance. A finished diarization SHALL replace the meeting's previous speakers, names and manual choices. Segments stored after the diarization finished SHALL be labelled when they are stored, except segments whose speaker was chosen by hand.

#### Scenario: Segment text matches one speaker

- **WHEN** a segment reads 我們下週五前把報價單寄出去 and the turns near it are S1 「好那就這樣」 and S2 「我们下周五前把报价单寄出去吧」
- **THEN** the segment's speaker is the label of S2

#### Scenario: Text does not match

- **WHEN** a segment's text shares fewer than 30% of its characters with nearby turns and its time span, shifted 1 second earlier, overlaps S1 for 0.4 seconds and S3 for 2.1 seconds
- **THEN** the segment's speaker is the label of S3

##### Example: Choosing a segment's speaker

| Segment text | Nearby turns | Time overlap (shifted) | Speaker |
| --- | --- | --- | --- |
| 我們下週五前把報價單寄出去 | S1 好那就這樣；S2 我们下周五前把报价单寄出去吧 | S1 3.0 s | S2 |
| 嗯 | S1 嗯对 | S1 0.8 s | S1 |
| 這個先這樣 | S2 下一个议题 | S1 0.4 s, S3 2.1 s | S3 |
| 好 | （none） | （none） | none |

#### Scenario: Segments saved after diarization

- **WHEN** the meeting page stores segments 41 and 42 after the diarization is done
- **THEN** segments 41 and 42 are labelled from the stored turns, and a segment whose speaker was chosen by hand keeps it


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
### Requirement: Naming and correcting speakers

A team member SHALL be able to name each speaker of a meeting either as a team member (shown with the member's display name) or with free text of at most 40 characters; a speaker without a name SHALL be shown as 說話者 N. A member SHALL also be able to give a speaker a role of at most 40 characters (for example 主持人), shown on the speaker's card. Naming a speaker SHALL apply to all of that speaker's segments. A member SHALL be able to set one segment's speaker to another speaker of the meeting, to a newly added speaker, or to no speaker; such a choice SHALL be kept when later segments are labelled. Naming a speaker as someone who is not a member of the meeting's team SHALL be refused with 422. Starting a new diarization when the meeting already has speakers SHALL require confirmation on the page, because it replaces names, roles and manual choices.

#### Scenario: Naming a speaker as a member

- **WHEN** a member names 說話者 2 of a meeting as team member amy (display name 林怡安)
- **THEN** every segment of speaker 2 shows 林怡安

#### Scenario: Giving a role

- **WHEN** a member gives 說話者 1 the role 主持人
- **THEN** the speaker's card shows 主持人 under its name, and a role of 41 characters is refused with 422

#### Scenario: Correcting one segment

- **WHEN** a member sets segment 17's speaker from 說話者 1 to 說話者 3
- **THEN** segment 17 shows 說話者 3 and keeps it when segments are stored or labelled again without a new diarization

#### Scenario: Naming a speaker as a non-member

- **WHEN** a member names a speaker as account bob who is not in the meeting's team
- **THEN** the system responds 422 and the speaker's name is unchanged


<!-- @trace
source: speaker-timeline
updated: 2026-11-08
code:
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/013_speaker_notes.sql
  - meeting-2026-11-01T00-16-53.txt
  - bench/speakers_e2e.mjs
  - webapp/static/speakers.js
  - 20261108_143903.mp4
  - webapp/static/speakers.css
  - webapp/static/review.js
  - webapp/diarize.py
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Only team members see and change speakers

Every speaker endpoint SHALL require membership of the meeting's team; others SHALL get 404, as for the meeting itself.

#### Scenario: Another team's meeting

- **WHEN** a user who is not in the meeting's team requests its speakers or starts its diarization
- **THEN** the system responds 404

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
### Requirement: Speaker timeline

When a meeting's diarization is done, the review page SHALL show a speaker timeline: one card per speaker (colour, shown name, and its role, or its number of turns and total speaking time when it has no role, as N 次發言 · 共 mm:ss) and one lane per speaker spanning the whole recording, with a bar for each of the speaker's turns placed by its start and end. Hovering a bar SHALL show its time span and text. The speakers endpoint SHALL return the turns as `[startMs, endMs, label, text]` with Chinese text in Traditional script, the recording length as `durationMs`, and each speaker's total turn time as `turnMs`. Selecting a card SHALL emphasise that speaker's lane and open its editor. A speaker added by hand SHALL have an empty lane.

#### Scenario: Timeline of a diarized meeting

- **WHEN** a member opens the review page of a 10-minute meeting whose diarization found speakers 1 and 2, with speaker 1 talking from 0:00 to 2:00 and speaker 2 from 2:00 to 2:30
- **THEN** the page shows two cards and two lanes, the bar of speaker 1 spans the first 20% of its lane and the bar of speaker 2 spans 20% to 25% of its lane

##### Example: Turns returned by the speakers endpoint

| Stored turn | Returned turn |
| --- | --- |
| [0, 1660, 1, "好那就这样"] | [0, 1660, 1, "好那就這樣"] |
| [1800, 5200, 2, "Quarterly numbers"] | [1800, 5200, 2, "Quarterly numbers"] |


<!-- @trace
source: speaker-timeline
updated: 2026-11-08
code:
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/013_speaker_notes.sql
  - meeting-2026-11-01T00-16-53.txt
  - bench/speakers_e2e.mjs
  - webapp/static/speakers.js
  - 20261108_143903.mp4
  - webapp/static/speakers.css
  - webapp/static/review.js
  - webapp/diarize.py
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Playing from the timeline

Selecting a turn bar SHALL play the recording from that turn's start and keep playing the following audio, loaded in parts of at most 5 minutes, until paused or the recording ends. While it plays, the timeline SHALL show the play position, the turn being played SHALL be emphasised, and a now-playing area SHALL show its speaker, time span and text, with the part of the text up to the play position (estimated in proportion to the turn's time) emphasised; when the play position enters the next turn the area SHALL show that turn. The transcript segment at the play position SHALL be marked and scrolled into view. A pause control SHALL pause and resume. Starting segment playback on the page SHALL stop timeline playback, and starting timeline playback SHALL stop segment playback.

#### Scenario: Playing a turn

- **WHEN** a member selects the bar of a turn from 1:20 to 1:32 by 林怡安 reading 我來處理報價
- **THEN** audio plays from 1:20, the now-playing area shows 林怡安, 01:20–01:32 and 我來處理報價, and at 1:26 the first half of the text is emphasised

#### Scenario: Continuing into the next turn

- **WHEN** playback started at a turn ending at 1:32 reaches 1:33, where the next turn by 說話者 2 starts
- **THEN** the now-playing area shows 說話者 2's turn without another selection

<!-- @trace
source: speaker-timeline
updated: 2026-11-08
code:
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/013_speaker_notes.sql
  - meeting-2026-11-01T00-16-53.txt
  - bench/speakers_e2e.mjs
  - webapp/static/speakers.js
  - 20261108_143903.mp4
  - webapp/static/speakers.css
  - webapp/static/review.js
  - webapp/diarize.py
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->