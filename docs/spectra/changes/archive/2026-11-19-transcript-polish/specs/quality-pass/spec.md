## MODIFIED Requirements

### Requirement: The text model's answer accounts for its input

The gateway SHALL compare the amount of source text in a text-model answer (its sentences plus its carry) with the amount it was given (the carried text plus the newly recognized text), counted in words for text written mostly in Latin script and in letters and digits otherwise. An answer SHALL be unusable when the input holds at least 12 units and the answer holds fewer than 70% of them, or more than 150% of them plus 10. An unusable answer SHALL be asked for once more. When the second answer is unusable too, the gateway SHALL show no sentence for that chunk and SHALL keep the carried text and the new text together as the carried text of the next chunk, so that they are asked again with what follows; only when the chunk is the last of the stream, or that text is longer than 800 characters, SHALL the chunk fail (the live result of its range stays). The instructions to the text model SHALL state that no content may be deleted, summarized or shortened. For a translated stream they SHALL state that only filler sounds and repeated false starts may be removed; for a stream without translation the removals and limits of the transcript-only requirement "精準模式 without translation" apply instead.

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
