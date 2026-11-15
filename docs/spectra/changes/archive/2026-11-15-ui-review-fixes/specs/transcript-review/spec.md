## ADDED Requirements

### Requirement: Translation stays visible while correcting

While a reviewer edits a segment's source text on the review page, the segment's translation SHALL stay shown in the translation column next to the editor, so the reviewer can compare the two while typing. When the meeting has no translation column, or on a phone-width layout where the columns stack, the editor SHALL take the source text's place in that layout.

#### Scenario: Editing a translated segment

- **WHEN** a reviewer presses 修改原文 on a segment whose translation is "Hello everyone" in a 1280px wide window
- **THEN** the editor appears in the source column and "Hello everyone" is shown in the translation column with the same column width as before editing
