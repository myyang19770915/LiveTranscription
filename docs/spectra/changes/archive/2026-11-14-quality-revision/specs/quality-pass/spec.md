## ADDED Requirements

### Requirement: Quality sentences carry an id

Every sentence of a quality event SHALL carry an integer `id` that is unique within the stream and grows by one with each sentence, starting at 1, whether or not revision is enabled.

#### Scenario: Two events

- **WHEN** a stream's quality events hold 2 sentences and then 1 sentence
- **THEN** their ids are 1, 2 and 3

### Requirement: Shown sentences are revised with more context

When `TRANSLATE_QUALITY_REVISE` is `1` and the quality pass is on for a stream, the gateway SHALL revise the sentences it has sent, in order, in windows of 6: a window SHALL be revised once the 3 sentences after it have been sent, or when the stream ends. For each window the gateway SHALL ask the quality text model (`TRANSLATE_QUALITY_URL`, `TRANSLATE_QUALITY_MODEL`, with `TRANSLATE_QUALITY_REVISE_EXTRA` merged into the request in place of `TRANSLATE_QUALITY_EXTRA`) with: the notes returned by the previous window, up to 6 sentences before the window as revised, the numbered sentences of the window with their translations, the source text of up to 3 sentences after it, the live engine's text for the window's time span, the meeting's terms when given, and the translation language. The answer SHALL give, for every sentence of the window, its source text and translation, and the updated notes. The gateway SHALL send a `revision` event holding only the sentences whose source or translation changed, each with its `id`, `source` and `target`; when nothing changed no event SHALL be sent. Chinese text SHALL be converted to Traditional characters as in quality events. Revision SHALL NOT delay quality events. When `TRANSLATE_QUALITY_REVISE` is not `1` no revision request SHALL be made.

#### Scenario: A window is revised when three more sentences exist

- **WHEN** 8 sentences have been sent and revision is enabled
- **THEN** no revision request has been made
- **WHEN** the 9th sentence is sent
- **THEN** one revision request is made for sentences 1 to 6, with the source text of sentences 7 to 9 as what follows

#### Scenario: Only changed sentences are sent

- **WHEN** the answer for sentences 1 to 6 changes the source of sentence 3 and the translation of sentence 5 and repeats the others unchanged
- **THEN** one `revision` event is sent with exactly sentences 3 and 5

#### Scenario: Notes are carried to the next window

- **WHEN** the answer for the first window returns the notes `Patient: a woman`
- **THEN** the request for the second window contains `NOTES: Patient: a woman`

#### Scenario: Revision is off

- **WHEN** `TRANSLATE_QUALITY_REVISE` is not set and 20 sentences are sent
- **THEN** only chunk requests reach the text model and no `revision` event is sent

##### Example: the request for a window

- **GIVEN** sentence 2 is `跟先生的感情變得穩定。` / `Her relationship with her husband became stable.` and the live engine heard `跟先生的感情变得不稳定` in that span
- **WHEN** the window is revised and the answer gives sentence 2 as `跟先生的感情變得不穩定。` / `Her relationship with her husband became unstable.`
- **THEN** the request contained `2. SRC: 跟先生的感情變得穩定。` and `ALT:` followed by the live engine's text
- **AND** the `revision` event holds `{"id": 2, "source": "跟先生的感情變得不穩定。", "target": "Her relationship with her husband became unstable."}`

### Requirement: A revision accounts for every sentence

A revision answer SHALL be used only when it gives each sentence of the window exactly once, in order, with non-empty source and translation, and the units of all its source text together (words for text in words, otherwise characters, as in the coverage check of chunks) are at least 80% and at most 125% plus 5 of the units of the window's source text. Any other answer, a failed request, or no answer within 60 seconds SHALL be asked for once more; when the second attempt fails too, the sentences of that window SHALL stay as they were, no event SHALL be sent for it, the notes SHALL stay as they were, and the next window SHALL be revised as usual. When more than 30 sentences are waiting to be revised, the gateway SHALL give up the oldest waiting windows until at most 30 sentences wait.

#### Scenario: The answer drops a sentence

- **WHEN** both answers for a window of 6 give only 5 sentences
- **THEN** no `revision` event is sent for that window and the next window is revised

#### Scenario: The answer shortens the text

- **WHEN** both answers give sources that together hold less than 80% of the window's units
- **THEN** no `revision` event is sent for that window

#### Scenario: The second answer is usable

- **WHEN** the first request fails and the second answer is usable
- **THEN** its changed sentences are sent

##### Example: usable or not

| Window units | Answer units | Sentences given | Used |
| ------------ | ------------ | --------------- | ---- |
| 100 | 100 | 1..6 | yes |
| 100 | 80 | 1..6 | yes |
| 100 | 79 | 1..6 | no |
| 100 | 130 | 1..6 | yes |
| 100 | 131 | 1..6 | no |
| 100 | 100 | 1..5 | no |
| 100 | 100 | 1,2,2,4,5,6 | no |

### Requirement: Revision ends with the stream

After the final quality event the gateway SHALL revise the sentences not yet revised (in windows of at most 6; a remainder of at most 9 sentences as one window) for at most 30 seconds in total, send their `revision` events, and then let the connection close. Sentences not revised in that time SHALL stay as they were. When the browser has left, revision SHALL stop without sending anything.

#### Scenario: A short meeting

- **WHEN** a stream ends after 4 sentences were sent
- **THEN** one revision request is made for sentences 1 to 4 after the final quality event, and the connection closes after its `revision` event

#### Scenario: The text model is slow at the end

- **WHEN** the revision of the last sentences takes longer than 30 seconds
- **THEN** the connection closes without a `revision` event for them

### Requirement: The page replaces revised sentences

On a `revision` event the live page SHALL replace the source text and translation of each kept segment whose `id` is in the event, keep its position, time span and language, and redraw both panes. A sentence whose `id` is not among the kept segments SHALL be ignored. Revised segments SHALL be saved with the next save of the meeting's segments.

#### Scenario: A sentence is revised

- **WHEN** kept segments 1 to 3 are shown and a `revision` event holds id 2 with a new source and translation
- **THEN** segment 2 shows the new text at the same position, and segments 1 and 3 are unchanged

#### Scenario: An unknown id

- **WHEN** a `revision` event holds id 9 and only 3 segments are kept
- **THEN** nothing changes

### Requirement: A revised source text is saved for unreviewed segments

When the live page saves a meeting's segments and a segment already stored has a different source text or translation, the gateway SHALL store the new source text and translation and add 1 to its version, provided the segment is unreviewed and has no edit history; the recognizer text stored when the segment was first saved (`asr_text`) and its live translation (`live_target`) SHALL stay as they were. A segment a reviewer has handled SHALL NOT change.

#### Scenario: The revision arrives after the first save

- **WHEN** segment 2 was saved as `跟先生的感情變得穩定。` and the page saves it again as `跟先生的感情變得不穩定。` with a new translation
- **THEN** the stored source and translation are the new ones, `asr_text` is still `跟先生的感情變得穩定。` and the version is 2

#### Scenario: A reviewer already corrected the segment

- **WHEN** a reviewer has edited segment 2 and the page saves it again with another source text
- **THEN** the stored segment is unchanged

### Requirement: Revision logs contain no meeting text

For every revised window the gateway SHALL log one line with the number of sentences, the number changed, the time taken and the outcome (`ok`, `failed:<reason>` or `skipped`), and SHALL NOT log source text, translations or notes.

#### Scenario: A window is revised

- **WHEN** a window of 6 sentences is revised and 2 change
- **THEN** one log line holds `sentences=6 changed=2` and no text of the meeting

## MODIFIED Requirements

### Requirement: The stream closes after the final quality event

After the browser ends the session, the gateway SHALL process the remaining audio and carried text as the last chunk, send its event with `final: true`, and only then close the connection, waiting at most 25 seconds; on timeout it SHALL send a failed final event. When revision is enabled, `revision` events MAY follow the final quality event before the connection closes. With the quality pass on, the page SHALL wait up to 70 seconds for the connection to close before finishing the session.

#### Scenario: Ending mid-sentence

- **WHEN** the user ends the meeting while a sentence is carried
- **THEN** the browser receives a `final: true` event containing that sentence before the connection closes

#### Scenario: Revision events after the final event

- **WHEN** revision is enabled and the user ends the meeting with sentences not yet revised
- **THEN** the browser receives the `final: true` quality event, then the `revision` event of those sentences, and then the connection closes
