## ADDED Requirements

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

### Requirement: Playing from the timeline

Selecting a turn bar SHALL play the recording from that turn's start and keep playing the following audio, loaded in parts of at most 5 minutes, until paused or the recording ends. While it plays, the timeline SHALL show the play position, the turn being played SHALL be emphasised, and a now-playing area SHALL show its speaker, time span and text, with the part of the text up to the play position (estimated in proportion to the turn's time) emphasised; when the play position enters the next turn the area SHALL show that turn. The transcript segment at the play position SHALL be marked and scrolled into view. A pause control SHALL pause and resume. Starting segment playback on the page SHALL stop timeline playback, and starting timeline playback SHALL stop segment playback.

#### Scenario: Playing a turn

- **WHEN** a member selects the bar of a turn from 1:20 to 1:32 by 林怡安 reading 我來處理報價
- **THEN** audio plays from 1:20, the now-playing area shows 林怡安, 01:20–01:32 and 我來處理報價, and at 1:26 the first half of the text is emphasised

#### Scenario: Continuing into the next turn

- **WHEN** playback started at a turn ending at 1:32 reaches 1:33, where the next turn by 說話者 2 starts
- **THEN** the now-playing area shows 說話者 2's turn without another selection

## MODIFIED Requirements

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
