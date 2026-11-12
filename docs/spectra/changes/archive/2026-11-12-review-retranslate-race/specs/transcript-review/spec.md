## MODIFIED Requirements

### Requirement: Concurrent edits are detected

Each segment SHALL carry a version number that every save increments. A save based on an older version SHALL be refused with 409, the review page SHALL show 這段已被其他人修改，已重新載入 and SHALL reload that segment. A retranslation SHALL be saved against the version the segment had when the retranslation started, so an edit made while the translation was running makes the save refused rather than overwritten; when the segment's original text changed while the translation was running, the review page SHALL discard the result without saving and show 原文已再次修改，略過這次重譯.

#### Scenario: Two reviewers

- **WHEN** alice and bob both open segment 5 at version 2, alice saves first, then bob saves
- **THEN** alice's save succeeds with version 3, bob's save is refused with 409, and bob sees alice's text


#### Scenario: An edit during a retranslation

- **WHEN** a segment at version 4 is being retranslated after an edit, and before the translation finishes the segment is edited again to version 5
- **THEN** the finished translation is not saved, the segment keeps the version-5 text, and the page shows 原文已再次修改，略過這次重譯

##### Example: what a finished retranslation does

| Version at start | Text at finish | Version at finish | Result |
| ---------------- | -------------- | ----------------- | ------ |
| 4 | unchanged | 4 | saved with version 4 |
| 4 | changed | 5 | discarded, not sent |
| 4 | unchanged | 5 (confirmed by someone else) | sent with version 4, refused with 409, segment reloaded |
