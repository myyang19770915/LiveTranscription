## MODIFIED Requirements

### Requirement: Segment playback

Selecting a segment SHALL play the recording for that segment's playback window. The reviewer SHALL be able to extend the window by 2 seconds at the start or at the end, and to replay it. The play control SHALL pause the segment while it plays and resume it from the same position while it is paused; once the clip has ended, or when another segment's clip is loaded, it SHALL play the segment from the start of its window. Next to the control the page SHALL show the current position and the end of the window as mm:ss on the meeting timeline. With a segment open and the focus not on an input, select, button or link, the space bar SHALL play or pause that segment. The audio SHALL be served only to members of the meeting's team, as WAV for the requested range.

#### Scenario: Playing a segment

- **WHEN** a reviewer selects the segment spanning 4200–9100
- **THEN** the page plays the recording from 1200 to 9600

#### Scenario: Extending the start

- **WHEN** the reviewer extends the start of that segment once and replays
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
