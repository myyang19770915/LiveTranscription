# meeting-minutes Specification

## Purpose

A meeting's decisions, action items, open questions and risks become an actionable record: a model proposes them from the reviewed transcript with evidence, and team members confirm, correct or reject each one before it counts. This is the base for follow-up in later meetings.

## Requirements

### Requirement: Generating minutes

A team member SHALL be able to start minutes generation for a meeting that has stored segments. The whole meeting SHALL be sent to the configured minutes model in one request, as numbered lines `[seq] source text` in order, together with the meeting date, topic and the team's members; a segment that has a speaker SHALL be sent as `[seq] name：source text`, where name is the speaker's shown name, and the instructions SHALL say that these names come from voice recognition and can be wrong. The meeting SHALL NOT be split into parts. The minutes model is set by `MINUTES_URL`, `MINUTES_MODEL` and `MINUTES_KEY`, falling back to the cloud refinement model (`TRANSLATE_REFINE_*`). Generation SHALL run in the background, SHALL report its status (running, done or failed), and SHALL refuse a second start while one is running (409). A failed model call SHALL end generation as failed with a message and SHALL keep every existing item.

#### Scenario: Generation finishes

- **WHEN** a member starts generation for a meeting with 42 segments
- **THEN** one model request carries segments 1 to 42, the status is running until it answers, then done with the number of items stored and dropped

#### Scenario: Segments with speakers

- **WHEN** segment 3 reads 我來處理報價 and its speaker is named 林怡安, and segment 4 has no speaker
- **THEN** the request carries `[3] 林怡安：我來處理報價` and `[4]` followed by segment 4's text alone

#### Scenario: Second start while running

- **WHEN** generation is running and a member starts it again
- **THEN** the system responds 409 and the running generation continues

#### Scenario: Model unavailable

- **WHEN** the model call fails
- **THEN** the status is failed with a message and the meeting's existing items are unchanged

#### Scenario: Minutes model not configured

- **WHEN** neither `MINUTES_URL` nor `TRANSLATE_REFINE_URL` is set and a member starts generation
- **THEN** the system responds 400 with 紀要功能尚未設定 and does not start


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


<!-- @trace
source: plain-wording-no-tech-names
updated: 2026-11-17
code:
  - webapp/static/ask.js
  - webapp/static/privacy-note.js
  - bench/interpret_e2e.mjs
  - bench/series_e2e.mjs
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - bench/README.md
  - README.md
  - webapp/static/meetings.html
  - webapp/static/admin.html
  - lab/realtime-translate/index.html
  - webapp/server.py
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - bench/qa_e2e.mjs
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/interpret.css
  - webapp/static/metrics.js
  - webapp/static/refine.css
  - webapp/static/index.html
  - bench/translate_e2e.mjs
  - webapp/migrations/019_interpret_usage.sql
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - chang01.png
  - webapp/static/minutes.js
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/interpret.py
  - bench/ui_polish_e2e.mjs
  - webapp/interpret_usage.py
  - .env.example
  - webapp/static/admin.css
  - webapp/static/ask.html
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/qa.py
  - lab/realtime-translate/costs.jsonl
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - webapp/minutes.py
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - compose.yaml
  - lab/realtime-translate/server.py
  - webapp/static/metrics.html
  - lab/realtime-translate/sessions/20261117-174651/output.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Items carry evidence

Each proposed item SHALL be one of decision, action, question or risk, and SHALL cite at least one segment of the meeting by sequence number. Cited numbers that are not segments of the meeting SHALL be removed; an item left without evidence SHALL NOT be stored. Items with the same kind and the same content after removing spaces and punctuation SHALL be stored once, with their evidence merged.

#### Scenario: Invented evidence

- **WHEN** the model proposes an item citing only segment 99 while the meeting has segments 1–20
- **THEN** the item is not stored

##### Example: evidence filtering

| Meeting segments | Cited | Stored evidence | Stored |
| -------------- | ----- | --------------- | ------ |
| 1–20 | [3, 7] | [3, 7] | yes |
| 1–20 | [7, 99] | [7] | yes |
| 1–20 | [99] | — | no |
| 1–20 | [] | — | no |


<!-- @trace
source: meeting-minutes
updated: 2026-11-05
code:
  - bench/README.md
  - docs/roadmap.md
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/minutes.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/minutes.py
  - webapp/static/meetings.html
  - webapp/static/minutes.js
  - webapp/static/review.css
  - webapp/static/review.js
  - bench/minutes_e2e.mjs
  - compose.yaml
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/004_minutes.sql
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Owners and due dates

An action item's owner SHALL be a member of the meeting's team, matched case-insensitively against usernames and display names; a name that matches no member SHALL be kept as an owner hint with no owner. A due date SHALL be stored only when it is a valid calendar date; the phrase the meeting used SHALL be kept with it.

#### Scenario: Name not in the team

- **WHEN** the model names "小王" as owner and no member of the team has that name
- **THEN** the item has no owner, shows 未指派, and keeps 小王 as the owner hint

##### Example: owner and due date

| Model owner | Team members | Stored owner | Hint |
| ----------- | ------------ | ------------ | ---- |
| "Alice" | alice (王愛麗) | alice | — |
| "王愛麗" | alice (王愛麗) | alice | — |
| "小王" | alice (王愛麗) | none | 小王 |

| Meeting date | Model due_text / due_date | Stored due date | Stored phrase |
| ------------ | ------------------------- | --------------- | ------------- |
| 2026-11-04 (Wed) | 下週五 / 2026-11-13 | 2026-11-13 | 下週五 |
| 2026-11-04 | 月底前 / 2026-11-31 | none | 月底前 |


<!-- @trace
source: meeting-minutes
updated: 2026-11-05
code:
  - bench/README.md
  - docs/roadmap.md
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/minutes.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/minutes.py
  - webapp/static/meetings.html
  - webapp/static/minutes.js
  - webapp/static/review.css
  - webapp/static/review.js
  - bench/minutes_e2e.mjs
  - compose.yaml
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/004_minutes.sql
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Human confirmation

Generated items SHALL start as proposed. A team member SHALL be able to change an item's kind, content, owner (a team member or none) and due date, to confirm it, to reject it, and to add an item by hand; a hand-added item SHALL be confirmed. The summary SHALL be editable. Each item and the summary SHALL carry a version that every change increments; a change based on an older version SHALL be refused with 409 and the current value.

#### Scenario: Confirming an edited proposal

- **WHEN** a member changes a proposed action's owner to bob and confirms it
- **THEN** the item is confirmed with owner bob and records who confirmed it and when

#### Scenario: Owner outside the team

- **WHEN** a member sets an item's owner to a user who is not in the meeting's team
- **THEN** the system responds 422 and the owner is unchanged

#### Scenario: Stale edit

- **WHEN** two members edit the same item from the same version
- **THEN** the second change is refused with 409 and receives the item as changed by the first


<!-- @trace
source: meeting-minutes
updated: 2026-11-05
code:
  - bench/README.md
  - docs/roadmap.md
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/minutes.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/minutes.py
  - webapp/static/meetings.html
  - webapp/static/minutes.js
  - webapp/static/review.css
  - webapp/static/review.js
  - bench/minutes_e2e.mjs
  - compose.yaml
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/004_minutes.sql
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Regenerating keeps human decisions

Generating again SHALL replace only the AI items that are still proposed. Confirmed, rejected and hand-added items SHALL be kept, and a newly generated item with the same kind and content as a kept item SHALL NOT be stored again. The summary SHALL be replaced only if nobody has edited it.

#### Scenario: Second generation

- **WHEN** a meeting has one confirmed decision, one rejected risk and two proposed actions, and generation runs again proposing the same decision and one new action
- **THEN** the meeting has the confirmed decision, the rejected risk and the one new proposed action


<!-- @trace
source: meeting-minutes
updated: 2026-11-05
code:
  - bench/README.md
  - docs/roadmap.md
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/minutes.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/minutes.py
  - webapp/static/meetings.html
  - webapp/static/minutes.js
  - webapp/static/review.css
  - webapp/static/review.js
  - bench/minutes_e2e.mjs
  - compose.yaml
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/004_minutes.sql
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Exporting minutes

A team member SHALL be able to download the minutes as Markdown containing the meeting topic, date, team, the summary, and the confirmed items grouped as 決議, 待辦 (with owner display name or 未指派 and due date), 待確認問題 and 風險, each with its evidence as mm:ss timestamps. Proposed and rejected items SHALL NOT appear.

#### Scenario: Only confirmed items

- **WHEN** a meeting has 2 confirmed actions, 1 proposed decision and 1 rejected risk
- **THEN** the Markdown lists the 2 actions only, each with owner, due date and timestamps


<!-- @trace
source: meeting-minutes
updated: 2026-11-05
code:
  - bench/README.md
  - docs/roadmap.md
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/minutes.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/minutes.py
  - webapp/static/meetings.html
  - webapp/static/minutes.js
  - webapp/static/review.css
  - webapp/static/review.js
  - bench/minutes_e2e.mjs
  - compose.yaml
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/004_minutes.sql
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Only team members use minutes

Generating, viewing, editing, confirming, rejecting, adding and exporting minutes SHALL be allowed to every member of the meeting's team and to no one else; non-members SHALL receive 404 and change nothing.

#### Scenario: Member of another team

- **WHEN** a user who is not in the meeting's team requests the minutes or starts generation
- **THEN** the system responds 404 and nothing starts or changes

<!-- @trace
source: meeting-minutes
updated: 2026-11-05
code:
  - bench/README.md
  - docs/roadmap.md
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/minutes.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/minutes.py
  - webapp/static/meetings.html
  - webapp/static/minutes.js
  - webapp/static/review.css
  - webapp/static/review.js
  - bench/minutes_e2e.mjs
  - compose.yaml
  - 20261029_185428.mp4
  - README.md
  - webapp/migrations/004_minutes.sql
  - webapp/static/review.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Viewing evidence in place

On the minutes page, a plain click on an item's evidence time SHALL open a side panel without leaving the page. The panel SHALL show the item's kind and content, and the meeting's segments that the item cites together with one segment before and one after each, in timeline order, with a gap marker between segments that are not adjacent; cited segments SHALL be marked and the clicked one brought into view. Each segment SHALL show its time, source text and translation; when the meeting has a recording each segment SHALL have a play control that plays, pauses and resumes that segment's playback window. Each cited segment SHALL link to that segment on the review page. Escape or the close control SHALL close the panel. When a regeneration replaces the item, the panel SHALL close. The evidence time SHALL remain a link to the segment on the review page for opening it in a new browser tab.

#### Scenario: Opening the panel

- **WHEN** a member clicks the evidence time 00:18 of an action citing segments 4 and 5 in a meeting of 15 segments
- **THEN** the address stays on the minutes page and the panel shows segments 3, 4, 5 and 6 with 4 and 5 marked as cited

#### Scenario: Context and gaps

##### Example: segments shown

| Meeting segments | Cited | Shown | Gap marker |
| --- | --- | --- | --- |
| 1–15 | 4, 5 | 3, 4, 5, 6 | none |
| 1–15 | 1, 9 | 1, 2, 8, 9, 10 | between 2 and 8 |
| 1–15 | 15 | 14, 15 | none |

#### Scenario: Listening to evidence

- **WHEN** a member presses the play control of a cited segment in a meeting with a recording, then presses it again
- **THEN** the segment's recording plays and then pauses, and a third press resumes it from where it paused

#### Scenario: Going to correct the transcript

- **WHEN** a member presses 到校對頁修正 on cited segment 4
- **THEN** the review page opens with segment 4 open and scrolled into view

#### Scenario: Closing

- **WHEN** the panel is open and the member presses Escape
- **THEN** the panel closes and the minutes page is unchanged

<!-- @trace
source: meeting-views-playback
updated: 2026-11-06
code:
  - webapp/static/timeline.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/minutes.js
  - 20261029_185428.mp4
  - bench/timelinecheck.js
  - webapp/static/minutes.html
  - bench/README.md
  - bench/minutes_e2e.mjs
  - webapp/static/review.html
-->