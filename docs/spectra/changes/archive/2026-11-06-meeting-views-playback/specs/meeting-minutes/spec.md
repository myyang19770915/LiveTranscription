## ADDED Requirements

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
