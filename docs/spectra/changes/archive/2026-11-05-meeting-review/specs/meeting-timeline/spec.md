## Purpose

A meeting's transcript, translation and recording share one timeline, so any finalized segment can be played back and corrected after the meeting. This capability covers the server-side recording, the audio time attached to recognition events, and the stored segments.

## ADDED Requirements

### Requirement: Server-side meeting recording

The gateway SHALL write every PCM16 audio frame it forwards to ASR or MAI for a meeting into that meeting's WAV file (16 kHz, 16-bit, mono) at `output/teams/<team id>/<meeting id>/audio.wav`, in arrival order, for both the local and the MAI engine. The WAV header SHALL be valid when the meeting ends normally and SHALL be repaired from the file size when the gateway next opens or serves a file left without a final header.

#### Scenario: Local engine meeting

- **WHEN** a meeting on the local engine receives 10 seconds of audio and ends
- **THEN** audio.wav exists, its header states 16 kHz mono 16-bit, and its duration is 10 seconds

#### Scenario: MAI engine meeting

- **WHEN** a meeting on the MAI engine receives audio
- **THEN** the same frames are written to audio.wav as are sent to MAI

#### Scenario: Gateway stopped mid-meeting

- **WHEN** the app stops during a meeting and the meeting audio is requested later
- **THEN** the header is repaired from the file size and the recorded audio plays

### Requirement: Recognition events carry audio time

Every recognition event the gateway sends to the browser SHALL include `audioMs`, the number of milliseconds of meeting audio the gateway had received when the event was sent, computed as received PCM bytes divided by 32.

#### Scenario: Event after three seconds of audio

- **WHEN** the gateway has received 96000 bytes of PCM and forwards a recognition event
- **THEN** the event sent to the browser contains `audioMs: 3000`

### Requirement: Segments record their time span

Each finalized translation segment SHALL record `endMs` as the `audioMs` of the first recognition event whose text reached the segment's end, and `startMs` as the previous segment's `endMs` (0 for the first segment). Because recognized text arrives after its audio, playback SHALL begin 3000 ms before `startMs` (not before 0) and end 500 ms after `endMs` (not after the recording's end); these padding values SHALL be constants set from the measured lag (bench/lagcheck.py: median 0.5–3.8 s for Chinese and Japanese).

#### Scenario: Consecutive segments

- **WHEN** segment 1 ends at an event with `audioMs` 4200 and segment 2 ends at an event with `audioMs` 9100
- **THEN** segment 1 spans 0–4200 and segment 2 spans 4200–9100

##### Example: playback window

| startMs | endMs | Recording length | Played range |
| ------- | ----- | ---------------- | ------------ |
| 0 | 4200 | 60000 | 0–4700 |
| 4200 | 9100 | 60000 | 1200–9600 |
| 58000 | 59800 | 60000 | 55000–60000 |

### Requirement: Segments are stored with the meeting

The system SHALL store each finalized segment of a meeting with its sequence number, `startMs`, `endMs`, the original ASR text, the current source text, the live translation, the current translation, and the detected language. The meeting SHALL store its glossary and its learned terms. The browser SHALL save segments during the meeting at most every 10 seconds when segments changed and SHALL save all segments when the meeting ends and after each background refinement that changes a translation. Saving SHALL update existing segments by sequence number and SHALL NOT change the original ASR text or the live translation once stored, nor overwrite a segment that has a review edit.

#### Scenario: Refinement after the meeting ended

- **WHEN** a background refinement changes segment 7's translation after the meeting ended and segment 7 has no review edit
- **THEN** the stored current translation of segment 7 is the refined text and its live translation is unchanged

#### Scenario: Save after a reviewer already edited

- **WHEN** a late save from the meeting page arrives for a segment that a reviewer has already edited
- **THEN** the stored segment keeps the reviewer's text
