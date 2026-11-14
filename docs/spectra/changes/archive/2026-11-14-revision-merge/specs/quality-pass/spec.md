## MODIFIED Requirements

### Requirement: Shown sentences are revised with more context

When `TRANSLATE_QUALITY_REVISE` is `1` and the quality pass is on for a stream, the gateway SHALL revise the sentences it has sent, in order, in windows of 6: a window SHALL be revised once the 3 sentences after it have been sent, or when the stream ends. For each window the gateway SHALL ask the quality text model (`TRANSLATE_QUALITY_URL`, `TRANSLATE_QUALITY_MODEL`, with `TRANSLATE_QUALITY_REVISE_EXTRA` merged into the request in place of `TRANSLATE_QUALITY_EXTRA`) with: the notes returned by the previous window, up to 6 sentences before the window as revised, the numbered sentences of the window with their translations, the source text of up to 3 sentences after it, the live engine's text for the window's time span, the meeting's terms when given, and the translation language. The answer SHALL give, for every sentence of the window, its source text and translation, either on its own or merged with the sentences next to it into one sentence, and the updated notes. The gateway SHALL send a `revision` event holding only the sentences whose source or translation changed, each with its `id`, `source` and `target`; a sentence that other sentences were merged into SHALL keep the `id` of the first of them and SHALL also carry `merged`, the ids of the sentences merged into it, and `endMs`, the end of the last of them. When nothing changed no event SHALL be sent. Chinese text SHALL be converted to Traditional characters as in quality events. Revision SHALL NOT delay quality events. When `TRANSLATE_QUALITY_REVISE` is not `1` no revision request SHALL be made.

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

#### Scenario: Merged sentences are context for the next window

- **WHEN** the answer for sentences 1 to 6 merges sentences 2 and 3 and the next window is revised
- **THEN** the request for the next window lists 5 sentences before it, the merged sentence among them once

##### Example: the request for a window

- **GIVEN** sentence 2 is `跟先生的感情變得穩定。` / `Her relationship with her husband became stable.` and the live engine heard `跟先生的感情变得不稳定` in that span
- **WHEN** the window is revised and the answer gives sentence 2 as `跟先生的感情變得不穩定。` / `Her relationship with her husband became unstable.`
- **THEN** the request contained `2. SRC: 跟先生的感情變得穩定。` and `ALT:` followed by the live engine's text
- **AND** the `revision` event holds `{"id": 2, "source": "跟先生的感情變得不穩定。", "target": "Her relationship with her husband became unstable."}`

##### Example: a sentence cut in two is merged

- **GIVEN** sentence 2 is `所以我們決定` / `So we decided` ending at 9000 ms and sentence 3 is `在下個月開始。` / `Start next month.` ending at 12000 ms
- **WHEN** the answer gives one item with `"ids": [2, 3]`, `所以我們決定在下個月開始。` and `So we decided to start next month.`
- **THEN** the `revision` event holds `{"id": 2, "source": "所以我們決定在下個月開始。", "target": "So we decided to start next month.", "merged": [3], "endMs": 12000}`

### Requirement: A revision accounts for every sentence

A revision answer SHALL be used only when its items, each naming one sentence (`id`) or 2 consecutive sentences of the same language (`ids`), together name each sentence of the window exactly once, in order, every item has a non-empty source and translation, and the units of all its source text together (words for text in words, otherwise characters, as in the coverage check of chunks) are at least 80% and at most 125% plus 5 of the units of the window's source text. Any other answer, a failed request, or no answer within 60 seconds SHALL be asked for once more; when the second attempt fails too, the sentences of that window SHALL stay as they were, no event SHALL be sent for it, the notes SHALL stay as they were, and the next window SHALL be revised as usual. When more than 30 sentences are waiting to be revised, the gateway SHALL give up the oldest waiting windows until at most 30 sentences wait.

#### Scenario: The answer drops a sentence

- **WHEN** both answers for a window of 6 give only 5 sentences and name sentences 1 to 5
- **THEN** no `revision` event is sent for that window and the next window is revised

#### Scenario: The answer shortens the text

- **WHEN** both answers give sources that together hold less than 80% of the window's units
- **THEN** no `revision` event is sent for that window

#### Scenario: The second answer is usable

- **WHEN** the first request fails and the second answer is usable
- **THEN** its changed sentences are sent

#### Scenario: Sentences of two languages are not merged

- **WHEN** sentence 2 is Chinese and sentence 3 is Japanese and both answers give one item for sentences 2 and 3
- **THEN** no `revision` event is sent for that window

##### Example: usable or not

| Window units | Answer units | Sentences named by the items | Used |
| ------------ | ------------ | ---------------------------- | ---- |
| 100 | 100 | 1, 2, 3, 4, 5, 6 | yes |
| 100 | 80 | 1, 2, 3, 4, 5, 6 | yes |
| 100 | 79 | 1, 2, 3, 4, 5, 6 | no |
| 100 | 130 | 1, 2, 3, 4, 5, 6 | yes |
| 100 | 131 | 1, 2, 3, 4, 5, 6 | no |
| 100 | 100 | 1, 2, 3, 4, 5 | no |
| 100 | 100 | 1, 2, 2, 4, 5, 6 | no |
| 100 | 100 | 1, [2, 3], 4, 5, 6 | yes |
| 100 | 100 | 1, [2, 3, 4], 5, 6 | no |
| 100 | 100 | 1, [2, 4], 3, 5, 6 | no |

### Requirement: Revision ends with the stream

After the final quality event the gateway SHALL revise the sentences not yet revised (in windows of at most 6; a remainder of at most 9 sentences as one window), asking for all of these windows at the same time and without waiting for a window that is still being revised, for at most 30 seconds in total, send their `revision` events, and then let the connection close. Sentences not revised in that time SHALL stay as they were. When the browser has left, revision SHALL stop without sending anything.

#### Scenario: A short meeting

- **WHEN** a stream ends after 4 sentences were sent
- **THEN** one revision request is made for sentences 1 to 4 after the final quality event, and the connection closes after its `revision` event

#### Scenario: The text model is slow at the end

- **WHEN** the revision of the last sentences takes longer than 30 seconds
- **THEN** the connection closes without a `revision` event for them

#### Scenario: Several windows are left at the end

- **WHEN** a stream ends with 15 sentences not yet revised and every revision answer takes 20 seconds
- **THEN** requests for sentences 1 to 6 and 7 to 15 are made at the same time and both `revision` events are sent before the connection closes

#### Scenario: A window is being revised when the stream ends

- **WHEN** sentences 1 to 6 are being revised and the stream ends with sentences 7 to 13 not yet revised
- **THEN** the request for sentences 7 to 13 is made before the answer for sentences 1 to 6 arrives

### Requirement: The page replaces revised sentences

On a `revision` event the live page SHALL replace the source text and translation of each kept segment whose `id` is in the event, keep its position and language, and redraw both panes. For a sentence that carries `merged`, the page SHALL also remove the kept segments with those ids and set the end of the segment's time span to `endMs`. A sentence whose `id` is not among the kept segments SHALL be ignored, and so SHALL an id in `merged` that is not among them. Revised segments SHALL be saved with the next save of the meeting's segments.

#### Scenario: A sentence is revised

- **WHEN** kept segments 1 to 3 are shown and a `revision` event holds id 2 with a new source and translation
- **THEN** segment 2 shows the new text at the same position, and segments 1 and 3 are unchanged

#### Scenario: An unknown id

- **WHEN** a `revision` event holds id 9 and only 3 segments are kept
- **THEN** nothing changes

#### Scenario: Two sentences are merged

- **WHEN** kept segments 1 to 4 are shown and a `revision` event holds id 2 with a new source and translation, `merged` `[3]` and `endMs` 12000
- **THEN** three segments are shown: 1, the merged text ending at 12000 ms, and 4

### Requirement: Kept segments are stored as the meeting segments

With the quality pass on, the segments the live page saves for a meeting SHALL be the kept segments in order, each with its `startMs`, `endMs`, source text, translation and language, using the existing save endpoint and schedule. Every kept segment SHALL get its sequence number when it is first kept, one more than the segment kept before it, and SHALL keep that number: the sequence number of a kept segment SHALL NOT change, also when other segments are merged. Every save SHALL also list the merges so far as pairs of sequence numbers: the segment merged into and the segment that was merged.

#### Scenario: Save during the meeting

- **WHEN** three quality events with 2, 0 and 3 sentences have arrived
- **THEN** the next save sends 5 segments with sequence numbers 1 to 5

#### Scenario: Save after a merge

- **WHEN** 5 segments are kept and a `revision` event merges the third into the second
- **THEN** the next save sends 4 segments with sequence numbers 1, 2, 4 and 5 and the merge `{"into": 2, "from": 3}`

### Requirement: Revision logs contain no meeting text

For every revised window the gateway SHALL log one line with the number of sentences, the number changed, the number merged into another sentence, the time taken and the outcome (`ok`, `failed:<reason>` or `skipped`), and SHALL NOT log source text, translations or notes.

#### Scenario: A window is revised

- **WHEN** a window of 6 sentences is revised, 2 change and 1 of them takes in the sentence after it
- **THEN** one log line holds `sentences=6 changed=2 merged=1` and no text of the meeting

## ADDED Requirements

### Requirement: Merged segments are stored as one

When a save of a meeting's segments lists a merge of segment `from` into segment `into` and both are stored, unreviewed, without edit history and without a speaker chosen by a person, the gateway SHALL, before storing the segments of that save, append the recognizer text (`asr_text`) and the live translation (`live_target`) of `from` to those of `into` (the recognizer texts joined without a space when the segment's language is Chinese or Japanese and with one space otherwise; the translations with one space), set the end of `into` to the later of the two ends, and delete `from`. When `from` is not stored the merge SHALL change nothing, and the end of `into` SHALL become the later of its stored end and the end sent with that save. When several segments are merged into one `into` and any of the stored ones cannot be merged, none of them SHALL be merged. When a merge cannot be made, the segments SHALL stay as they are and that save SHALL NOT change the text of `into`. A merge whose `from` is not greater than its `into` SHALL be refused with status 422.

#### Scenario: Both segments were saved before the merge

- **WHEN** segments 2 (`所以我們決定`, 6000 to 9000 ms) and 3 (`在下個月開始。`, 9000 to 12000 ms) are stored and a save sends segment 2 as `所以我們決定在下個月開始。` with the merge `{"into": 2, "from": 3}`
- **THEN** segment 3 is no longer stored, and segment 2 has the source `所以我們決定在下個月開始。`, the `asr_text` `所以我們決定在下個月開始。` and ends at 12000 ms

#### Scenario: The merge is sent again

- **WHEN** the same save is sent a second time
- **THEN** the stored segments are unchanged

#### Scenario: A reviewer already corrected the merged segment

- **WHEN** a reviewer has edited segment 3 and a save sends segment 2 with the merged text and the merge `{"into": 2, "from": 3}`
- **THEN** segments 2 and 3 are both stored as they were

#### Scenario: The merged segment was never saved

- **WHEN** only segments 1 and 2 are stored and a save sends segment 2 with the merged text and the merge `{"into": 2, "from": 3}`
- **THEN** segment 2 has the merged text as its source, ends where the save says it ends, and no segment 3 is stored

#### Scenario: One of three parts was handled by a reviewer

- **WHEN** segments 1, 2 and 3 are stored, a reviewer has confirmed segment 3, and a save lists the merges of 2 into 1 and of 3 into 1
- **THEN** all three segments are stored as they were

##### Example: joining the first-saved texts

| Language of `into` | `asr_text` of `into` | `asr_text` of `from` | `asr_text` after the merge |
| ------------------ | -------------------- | -------------------- | -------------------------- |
| zh | 所以我們決定 | 在下個月開始。 | 所以我們決定在下個月開始。 |
| ja | それで私たちは | 来月から始めます。 | それで私たちは来月から始めます。 |
| en | So we decided | to start next month. | So we decided to start next month. |
