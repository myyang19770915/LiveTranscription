## MODIFIED Requirements

### Requirement: The second recognition can use the app's own engines

When `TRANSLATE_QUALITY_ASR` is `local`, `mai` or `hybrid`, the gateway SHALL choose the recognizer of each stream as follows: `local` uses the local ASR engine and `mai` uses Azure MAI for every stream, neither requiring `TRANSLATE_QUALITY_ASR_MODEL`; `hybrid` uses the transcriptions API (`TRANSLATE_QUALITY_ASR_MODEL`) for streams whose language is `zh` or `yue` and Azure MAI for every other stream. With `local`, chunk audio SHALL NOT be sent to any external service. With `mai` or `hybrid`, the quality pass SHALL be configured only when MAI is configured, and `hybrid` SHALL also require `TRANSLATE_QUALITY_ASR_MODEL`. Any other non-empty value SHALL leave the quality pass not configured.

When a stream's recognizer is Azure MAI, the gateway SHALL open one MAI session for that stream, SHALL send the stream's audio to it as the audio arrives (never a whole chunk at once), and SHALL commit the MAI input at each chunk that contains speech; the text of a chunk SHALL be the transcript MAI completes for that commit, taken in order. When the MAI session cannot be opened or drops, the chunks waiting for a transcript SHALL fail (the live result of their range stays) and the gateway SHALL open a new session for the audio that follows. A chunk of which audible audio had already gone to the dropped session SHALL fail as well, and the transcript the new session completes for it SHALL be discarded. A transcript that arrives later than the time allowed for recognition SHALL fail its chunk without ending the quality pass for the stream.

#### Scenario: Local engine

- **WHEN** `TRANSLATE_QUALITY_ASR` is `local`, `TRANSLATE_QUALITY_MODEL` is set and a chunk is ready
- **THEN** the chunk audio goes to the local ASR engine on a connection of its own with `retain` false
- **AND** no request is made to `/audio/transcriptions`
- **AND** the recognized text goes to the text model as NEW

#### Scenario: MAI not configured

- **WHEN** `TRANSLATE_QUALITY_ASR` is `mai` and MAI is not configured
- **THEN** `/api/config` reports `quality` false

#### Scenario: Unknown engine name

- **WHEN** `TRANSLATE_QUALITY_ASR` is `whisper`
- **THEN** `/api/config` reports `quality` false

#### Scenario: MAI hears the audio as it arrives

- **WHEN** the recognizer of a stream is MAI and the stream sends three seconds of speech in 0.2-second messages, then ends
- **THEN** the MAI session received fifteen audio appends before its one commit, together holding exactly the audio sent
- **AND** the transcript MAI completes for that commit goes to the text model as NEW

#### Scenario: MAI session drops inside a chunk

- **WHEN** one second of speech of a chunk has gone to a MAI session that then closes, and the rest of the chunk goes to a new session
- **THEN** that chunk is reported as failed and the transcript the new session completes for it is not used
- **AND** the chunk after it gets the transcript of its own commit

#### Scenario: MAI answers too late

- **WHEN** the transcript of a commit arrives after the time allowed for recognition
- **THEN** that chunk is reported as failed
- **AND** the next chunk is processed as usual and the stream ends with a final event

#### Scenario: MAI session drops

- **WHEN** the MAI session closes while a chunk is waiting for its transcript
- **THEN** that chunk is reported as failed and the stream goes on
- **AND** audio that arrives afterwards goes to a new MAI session

##### Example: recognizer by setting and stream language

| `TRANSLATE_QUALITY_ASR` | Stream language | Recognizer |
| ----------------------- | --------------- | ---------- |
| (empty) | zh | transcriptions API |
| (empty) | ja | transcriptions API |
| mai | zh | MAI |
| hybrid | zh | transcriptions API |
| hybrid | yue | transcriptions API |
| hybrid | ja | MAI |
| hybrid | en | MAI |
| hybrid | auto | MAI |
| hybrid | zh_ja | MAI |
| local | ja | local ASR engine |

## ADDED Requirements

### Requirement: The text model's answer accounts for its input

The gateway SHALL compare the amount of source text in a text-model answer (its sentences plus its carry) with the amount it was given (the carried text plus the newly recognized text), counted in words for text written mostly in Latin script and in letters and digits otherwise. An answer SHALL be unusable when the input holds at least 12 units and the answer holds fewer than 70% of them, or more than 150% of them plus 10. An unusable answer SHALL be asked for once more. When the second answer is unusable too, the gateway SHALL show no sentence for that chunk and SHALL keep the carried text and the new text together as the carried text of the next chunk, so that they are asked again with what follows; only when the chunk is the last of the stream, or that text is longer than 800 characters, SHALL the chunk fail (the live result of its range stays). The instructions to the text model SHALL state that no content may be deleted, summarized or shortened, and that only filler sounds and repeated false starts may be removed.

#### Scenario: The carried sentence is dropped

- **WHEN** the carried text has 20 words, the new text has 10 words and the answer's sentences and carry hold only the 10 new words
- **THEN** the answer is unusable and the request is sent once more

#### Scenario: Fillers removed

- **WHEN** the input has 30 words and the answer holds 26 of them
- **THEN** the answer is accepted

#### Scenario: Both answers drop content

- **WHEN** two answers in a row hold fewer than 70% of the input and more audio follows
- **THEN** the event of that chunk has no sentences and is not a failure
- **AND** the next request carries the whole text as CARRY, once

#### Scenario: Both answers drop content at the end

- **WHEN** two answers in a row hold fewer than 70% of the input and the chunk is the last
- **THEN** the chunk is reported as failed

##### Example: usable or not

| Input units | Answer units | Usable |
| ----------- | ------------ | ------ |
| 30 | 26 | yes |
| 30 | 21 | yes |
| 30 | 20 | no |
| 30 | 10 | no |
| 30 | 55 | yes |
| 30 | 56 | no |
| 11 | 2 | yes |
| 12 | 8 | no |

### Requirement: A sentence is carried and shown once

When the gateway holds back the last sentence of an answer because the pause after the chunk was not long, and the answer's own carry already begins with that sentence, the carried text SHALL contain the sentence once. A sentence of an answer that says the same as the sentence before it, or as the sentence shown last for the stream, SHALL NOT be shown again. Two sentences say the same when their letters and digits are equal after Unicode NFKC normalization and case folding.

#### Scenario: The model names the held sentence in carry too

- **WHEN** the pause is short and the answer has the sentence `我們下週要上線` both as its last sentence and as its carry
- **THEN** the next request has `CARRY: 我們下週要上線`, not the sentence twice

#### Scenario: A sentence already shown comes back

- **WHEN** an answer begins with the sentence shown last for the stream, given twice
- **THEN** neither copy is shown again and the sentences after them are shown
