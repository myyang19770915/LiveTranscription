# progress-detection Specification

## Purpose

During a meeting of a series, what people say about earlier action items becomes suggested status changes with evidence, which a person applies or dismisses; applied changes enter the item's status history with the meeting and segments that support them.

## Requirements

### Requirement: Opting in to progress detection

The meeting page SHALL offer progress detection only when the selected meeting has a series and a minutes model is configured; it SHALL be off until the user turns it on, SHALL state that meeting content is sent to an external model service, and SHALL remember the choice in the browser.

#### Scenario: Default off

- **WHEN** a user selects a series for the first time in a browser
- **THEN** progress detection is offered but off, with the notice that meeting content is sent to an external model service


<!-- @trace
source: meeting-series
updated: 2026-11-06
code:
  - bench/series_e2e.mjs
  - docs/roadmap.md
  - webapp/static/meetings.html
  - webapp/static/review.js
  - webapp/server.py
  - webapp/migrations/006_series.sql
  - webapp/static/meeting-nav.js
  - webapp/static/review.css
  - webapp/static/series.css
  - bench/README.md
  - webapp/static/minutes.html
  - webapp/team_access.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/review.html
  - webapp/static/series.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/index.html
  - webapp/static/app.js
  - README.md
  - webapp/actions.py
  - webapp/static/actions.html
  - webapp/static/minutes.css
  - webapp/series.py
  - webapp/minutes.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Detecting progress during the meeting

With detection on, while the meeting runs, the system SHALL send the meeting's newly finalized segments together with the unfinished action items of the series to the minutes model after at least 3 new segments and 45 seconds since the previous check, one check at a time, and once more when the meeting ends. The server SHALL turn the model's answer into suggestions only after validation: the item SHALL be one of the listed unfinished items; the suggested status SHALL be doing, done or cancelled and differ from the item's status; evidence SHALL keep only segments sent in this check and an update without evidence SHALL be dropped; a cancellation without a note SHALL be dropped; a suggestion SHALL be created at most once per meeting, item and status. The model SHALL NOT be called when the meeting has no series, the series has no unfinished items, or there are no new segments. When the model fails, the check SHALL report the failure without losing the segments, so the next check covers them.

#### Scenario: Validating the model answer

##### Example: unfinished items #11 (todo) and #12 (doing); this check sent segments 31–35

| Model update | Suggestion |
| --- | --- |
| item 11, done, note 合約已寄出, evidence [33] | created: #11 → done, evidence 33 |
| item 12, doing, evidence [34] | dropped: status unchanged |
| item 99, done, evidence [33] | dropped: not an unfinished item |
| item 11, doing, evidence [12] | dropped: no evidence among 31–35 |
| item 12, cancelled, note (empty), evidence [35] | dropped: cancellation without a note |
| item 11, done, evidence [34] (a later check) | dropped: already suggested in this meeting |

#### Scenario: Nothing to check

- **WHEN** a check runs for a meeting without a series
- **THEN** the model is not called and no suggestion is created

#### Scenario: Model failure

- **WHEN** the model times out on segments 31–35
- **THEN** the check reports the failure, creates no suggestion, and the next check sends segments 31 onward again


<!-- @trace
source: meeting-series
updated: 2026-11-06
code:
  - bench/series_e2e.mjs
  - docs/roadmap.md
  - webapp/static/meetings.html
  - webapp/static/review.js
  - webapp/server.py
  - webapp/migrations/006_series.sql
  - webapp/static/meeting-nav.js
  - webapp/static/review.css
  - webapp/static/series.css
  - bench/README.md
  - webapp/static/minutes.html
  - webapp/team_access.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/review.html
  - webapp/static/series.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/index.html
  - webapp/static/app.js
  - README.md
  - webapp/actions.py
  - webapp/static/actions.html
  - webapp/static/minutes.css
  - webapp/series.py
  - webapp/minutes.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Applying a suggestion

A member of the meeting's team SHALL be able to apply or dismiss a pending suggestion, during the meeting on the meeting page or afterwards on that meeting's minutes page. Applying SHALL change the item's status as an action-tracking status change does and record in the item's history the meeting, the evidence segments and the suggestion's note; when the item already has the suggested status, applying SHALL only mark the suggestion applied. Applying SHALL also dismiss the other pending suggestions for the same item in that meeting, since they are out of date. Each suggestion SHALL show the item's current status next to the suggested one. Dismissing SHALL mark it dismissed so it is not suggested again in that meeting. A suggestion that is no longer pending SHALL be refused with 409; an item that is no longer a confirmed action SHALL be refused with 409. Users outside the team SHALL receive 404.

#### Scenario: Applying during the meeting

- **WHEN** alice applies the suggestion #11 → done with evidence segment 33 in the 11/13 meeting
- **THEN** item #11 is done, its history shows todo → done by alice with note 合約已寄出, meeting 11/13 and evidence 33, and the suggestion is applied

#### Scenario: Left for after the meeting

- **WHEN** a meeting ends with two pending suggestions
- **THEN** its minutes page lists both with apply and dismiss

#### Scenario: Out-of-date suggestions

- **WHEN** the meeting has pending suggestions #11 → doing and #11 → done, and alice applies #11 → done
- **THEN** item #11 is done and the suggestion #11 → doing is dismissed, so it can no longer move the item back to doing

#### Scenario: Handled twice

- **WHEN** bob applies a suggestion that alice already dismissed
- **THEN** the system responds 409 這則提示已處理 and the item is unchanged

<!-- @trace
source: meeting-series
updated: 2026-11-06
code:
  - bench/series_e2e.mjs
  - docs/roadmap.md
  - webapp/static/meetings.html
  - webapp/static/review.js
  - webapp/server.py
  - webapp/migrations/006_series.sql
  - webapp/static/meeting-nav.js
  - webapp/static/review.css
  - webapp/static/series.css
  - bench/README.md
  - webapp/static/minutes.html
  - webapp/team_access.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/review.html
  - webapp/static/series.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/index.html
  - webapp/static/app.js
  - README.md
  - webapp/actions.py
  - webapp/static/actions.html
  - webapp/static/minutes.css
  - webapp/series.py
  - webapp/minutes.py
tests:
  - webapp/test_server.py
-->