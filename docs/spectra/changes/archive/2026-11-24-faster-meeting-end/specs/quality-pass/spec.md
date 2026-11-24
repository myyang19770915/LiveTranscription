## MODIFIED Requirements

### Requirement: The stream closes after the final quality event

After the browser ends the session, the gateway SHALL process the remaining audio and carried text as the last chunk, send its event with `final: true`, and only then close the connection, waiting at most 25 seconds; on timeout it SHALL send a failed final event. With the app's own recognition engine the gateway SHALL start this last chunk as soon as the browser's end-of-stream message arrives, while the recognition engine is still finishing, and SHALL close the connection only when both are done. When revision is enabled, `revision` events MAY follow the final quality event before the connection closes. With the quality pass on, the page SHALL wait up to 70 seconds for the connection to close before finishing the session. From the moment 結束會議 is pressed until the session is finished, the button SHALL show 結束中… and be disabled, and with the quality pass on the status SHALL read 正在完成最後幾句….

#### Scenario: Ending mid-sentence

- **WHEN** the user ends the meeting while a sentence is carried
- **THEN** the browser receives a `final: true` event containing that sentence before the connection closes

#### Scenario: Revision events after the final event

- **WHEN** revision is enabled and the user ends the meeting with sentences not yet revised
- **THEN** the browser receives the `final: true` quality event, then the `revision` event of those sentences, and then the connection closes

#### Scenario: The recognition engine is slow to finish

- **WHEN** the user ends a meeting with the quality pass on and the recognition engine needs 5 seconds after the end-of-stream message to close
- **THEN** the final quality event is sent before the recognition engine closes, and the connection closes after the recognition engine has closed

### Requirement: Revision ends with the stream

After the final quality event the gateway SHALL revise the sentences not yet revised (in windows of at most 6; a remainder of at most 9 sentences as one window), asking for all of these windows at the same time and without waiting for a window that is still being revised, for at most 15 seconds in total, send their `revision` events, and then let the connection close. When the stream ends before the recognition engine has sent all its text, these last windows SHALL wait for that text up to 5 seconds, counted inside the 15 seconds, so that the recognition engine's text of their sentences goes with the request. Sentences not revised in that time SHALL stay as they were. When the browser has left, revision SHALL stop without sending anything.

#### Scenario: A short meeting

- **WHEN** a stream ends after 4 sentences were sent
- **THEN** one revision request is made for sentences 1 to 4 after the final quality event, and the connection closes after its `revision` event

#### Scenario: The text model is slow at the end

- **WHEN** the revision of the last sentences takes longer than 15 seconds
- **THEN** the connection closes without a `revision` event for them

#### Scenario: Several windows are left at the end

- **WHEN** a stream ends with 15 sentences not yet revised and every revision answer takes 10 seconds
- **THEN** requests for sentences 1 to 6 and 7 to 15 are made at the same time and both `revision` events are sent before the connection closes

#### Scenario: The recognition engine still sends its last text

- **WHEN** the stream ends while the recognition engine sends the text of the last seconds 0.05 seconds later
- **THEN** the request for the last sentences is made after that and carries that text

#### Scenario: The recognition engine does not finish

- **WHEN** the stream ends and the recognition engine has not finished 5 seconds later
- **THEN** the request for the last sentences is made with the text received so far, and all of it still ends within 15 seconds

#### Scenario: A window is being revised when the stream ends

- **WHEN** sentences 1 to 6 are being revised and the stream ends with sentences 7 to 13 not yet revised
- **THEN** the request for sentences 7 to 13 is made before the answer for sentences 1 to 6 arrives
