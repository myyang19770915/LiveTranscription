## ADDED Requirements

### Requirement: Segment times follow the recording

When a diarization is done, the system SHALL correct the start and end time of each segment from the speaker turns. Each character of a turn's text (compared as in "Labelling segments with speakers") SHALL be given a time inside the turn in proportion to its position. A segment's text SHALL be matched against the turns from 12 seconds before its start to 3 seconds after its end; its start SHALL become the time of the first matched character and its end the time of the last matched character, counting only matched runs of 2 or more characters when there is one. Matched runs SHALL count outward from the longest one, for as long as the turn text skipped to reach the next run exceeds the segment's own text skipped there by no more than 4 characters or a quarter of the segment's characters, whichever is more; runs beyond that SHALL NOT count, so that the same words in the next sentence do not stretch a segment over it. Segments SHALL be handled in their order, and the turn text up to the last character taken by an earlier corrected segment SHALL NOT be matched again, so that a phrase said twice is not taken for its first time. A segment SHALL be corrected only when the matched characters are at least 50% of its characters and at least 2, and only when its new start is not before the corrected start of an earlier segment; its end SHALL be at least 200 ms after its start. A corrected segment SHALL be marked as timed, and correcting SHALL NOT change the segment's version, text, state or speaker. A segment that is not corrected SHALL keep its times and its mark. Running the diarization again SHALL correct the segments again. The system SHALL offer a command that corrects the meetings whose diarization was already done.

#### Scenario: A sentence after a pause

- **WHEN** a segment stored as 17578–27508 reads the words of a turn spanning 21330–27040
- **THEN** the segment becomes 21330–27040 and is marked as timed

#### Scenario: Two segments in one turn

- **WHEN** a turn spanning 10000–18000 holds 40 characters, the first 16 of them the text of one segment and the last 24 the text of the next
- **THEN** the first segment becomes 10000–13200, the next 13200–18000, and both are marked as timed

#### Scenario: A phrase said twice

- **WHEN** two turns spanning 1000–2000 and 5000–6000 both read 好的好的, and two segments in a row both read 好的好的
- **THEN** the first segment becomes 1000–2000 and the second 5000–6000

#### Scenario: A sentence that ends differently in the turn

- **WHEN** a turn spanning 0–4000 reads 我们今天先看报价单然后讨论, the next turn spanning 4200–8000 reads 报价单的部分我觉得还可以再谈, and two segments in a row read 我們今天先看報價單然後再談 and 報價單的部分我覺得還可以再談
- **THEN** the first segment becomes 0–3385 and the second 4200–8000

#### Scenario: Text that does not match

- **WHEN** fewer than half of a segment's characters are found in the turns near it
- **THEN** the segment keeps its start, its end and its mark

#### Scenario: Reviewed segments

- **WHEN** a reviewed segment is corrected
- **THEN** its times change and its version, text, state and speaker stay as they were

##### Example: Start times against the recording

Measured on a 71 second meeting; the speech onsets were found from the audio level.

| Segment | Stored start (ms) | Turn start (ms) | Speech onset in the audio (ms) | Start after correction (ms) |
| --- | --- | --- | --- | --- |
| 2 | 5448 | 7380 | 7460 | 7380 |
| 4 | 17578 | 21330 | 21380 | 21330 |
| 8 | 44040 | 45750 | 45800 | 45750 |
| 10 | 58237 | 59660 | 59540 | 59660 |
