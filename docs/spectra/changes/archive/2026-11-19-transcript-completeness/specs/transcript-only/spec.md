## ADDED Requirements

### Requirement: Nothing said is silently left out without translation

When the stream's target is `none`, 精準模式 SHALL compare, character by character in order, the text it gave the text model (the carried text and the new text, with filler words such as 嗯, 呃, 那個, 就是, 然後, 的話 removed, both in Traditional characters) with the text of the answer (every sentence and the carry, before repeated sentences are removed). When a run of at least 8 consecutive letters or digits (6 words for text written mostly in Latin script) of the given text has no counterpart in the answer (nothing in its place, or a stand-in under a third of its length), and is not merely moved within the answer or said again elsewhere in the given text (fewer than 8 of its letters or digits are new when runs of 3 or more shared with the rest of the given text are discounted), the request SHALL be sent once more with that run named as left out, and of the two answers the one whose longest left-out run is shorter SHALL be used; a failed second request SHALL keep the first answer. 回顧修訂 SHALL make the same comparison for each item of an answer against the sentences it stands for, and an answer that leaves out such a run SHALL be unusable (asked once more, then the window stays as it was). Logs SHALL record only how many characters were left out, never the text. A translated stream SHALL NOT make these comparisons.

#### Scenario: A dropped sentence is asked for again

- **WHEN** a chunk without translation gives 「回到家裡跟家人起了爭執對方就會說你不要這麼情緒化好不好」 and the first answer's sentences leave that out
- **THEN** the request is sent once more naming the left-out text, and the second answer, which includes it, is used

##### Example: what counts as left out

| Given (after fillers removed) | Answer | Left out |
| ----------------------------- | ------ | -------- |
| 我們下週要把待辦事項整理一下 | 我們下週要把待辦事項整理一下。 | nothing |
| 那個我們就是下週要把代辦事項整理一下 | 我們下週要把待辦事項整理一下。 | nothing (fillers, one corrected character) |
| 那是在職場上回到家裡跟家人起了爭執 | 那是在職場上。 | 回到家裡跟家人起了爭執 (11 characters) |
| 這是對的嗎他問 | 這是對的嗎？ | nothing (2 characters is below 8) |
| 我們下週要把待辦事項我們下週要把待辦事項整理一下 | 我們下週要把待辦事項整理一下。 | nothing (said twice) |
| 我們下個禮拜要去台北不是我們下個禮拜要去台中 | 我們下個禮拜要去台中。 | nothing (a false start: what it adds is under 8 characters) |
| 這件事情我們要先跟客戶確認時間 | 我們要先跟客戶確認時間這件事情。 | nothing (moved) |

### Requirement: Without translation the wording follows the evidence and names learned so far

When the stream's target is `none`, the instructions to the text model (for chunks and for 回顧修訂) SHALL state that a content word is changed only when it sounds similar and the context or the other recognizer supports the change, never only to make the sentence read better; that a short answer by another person is its own item; that quotation marks cover only the quoted words; and that 然後, 就是 and 的話 stay where they carry time order, a condition or a definition. Each chunk request SHALL include the notes 回顧修訂 has gathered so far (people, names and terms of this meeting), labelled as hints for spelling names and terms and never as content, once there are any.

#### Scenario: Names learned in revision reach the next chunk

- **WHEN** 回顧修訂 has returned notes naming 阿總 as a participant and the next chunk is sent to the text model
- **THEN** that request contains those notes under NOTES, and a translated stream's request contains no NOTES
