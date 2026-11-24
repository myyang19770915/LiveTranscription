## MODIFIED Requirements

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
