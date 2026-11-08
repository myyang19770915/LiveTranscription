## MODIFIED Requirements

### Requirement: Review page shows aligned segments

The review page of a meeting SHALL show every stored segment in order with its time span, current source text and current translation side by side, and SHALL mark each segment as unreviewed, confirmed, or edited. When the meeting has speakers, each segment SHALL also show its speaker's name (or 說話者 N), and the page SHALL show the meeting's diarization status (queued, running, done or failed with its message) and the list of its speakers.

#### Scenario: Opening a meeting

- **WHEN** a team member opens the review page of a meeting with 42 segments
- **THEN** 42 rows appear in order, each with its time span formatted as mm:ss, its source and its translation

#### Scenario: Opening a diarized meeting

- **WHEN** a team member opens the review page of a meeting whose diarization is done with speakers 林怡安 and 說話者 2
- **THEN** each row shows 林怡安, 說話者 2 or no speaker before its text, and the speaker list shows both speakers with their segment counts
