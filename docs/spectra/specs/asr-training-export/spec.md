# asr-training-export Specification

## Purpose

Reviewed segments pair real meeting audio with a verified transcript, which is the data needed to fine-tune the ASR model. This capability exports them per team.

## Requirements

### Requirement: Export reviewed segments for ASR training

A team member SHALL be able to export, for one of their teams and a date range of meeting start times, every segment that is confirmed or edited. The export SHALL be a zip file containing one WAV clip per segment cut at the segment's `startMs`–`endMs` (without playback padding) and a `manifest.jsonl` with one line per clip. Unreviewed segments SHALL NOT be exported.

#### Scenario: Mixed review states

- **WHEN** a team's meetings in the range have 3 edited, 2 confirmed and 10 unreviewed segments
- **THEN** the zip contains 5 clips and manifest.jsonl has 5 lines

#### Scenario: Another team

- **WHEN** a user requests an export for a team they are not in
- **THEN** the system responds 404


<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Manifest content

Each manifest line SHALL be a JSON object with `audio` (path of the clip inside the zip), `text` (the reviewed source text), `asr_text` (the original ASR text), `language`, `engine`, `meeting_id`, `seq`, `start_ms`, `end_ms`, `edited` (true when the text differs from the ASR text), and `reviewed_by`.

#### Scenario: Edited segment line

- **WHEN** segment 12 of meeting M was changed from "城市設計比賽" to "程式設計比賽" on the local engine
- **THEN** its manifest line has `text` "程式設計比賽", `asr_text` "城市設計比賽", `engine` "local" and `edited` true

##### Example: manifest line

- **GIVEN** meeting id `m1`, segment 12 spanning 4200–9100, language zh, reviewed by alice
- **WHEN** the export runs
- **THEN** the line is `{"audio": "clips/m1_0012.wav", "text": "程式設計比賽", "asr_text": "城市設計比賽", "language": "zh", "engine": "local", "meeting_id": "m1", "seq": 12, "start_ms": 4200, "end_ms": 9100, "edited": true, "reviewed_by": "alice"}`

<!-- @trace
source: meeting-review
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->