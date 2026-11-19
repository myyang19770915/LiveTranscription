## ADDED Requirements

### Requirement: Without translation speaker turns stay apart

When the stream's target is `none`, the instructions for chunks SHALL state that when the speaker changes (a question, an answer, a backchannel) a new item starts, that two people's words are never in one item, and that a tag question (對不對？) stays with the person who said it; the 回顧修訂 instructions, which may only merge items, SHALL state that items spoken by different people are never merged and that a tag question is never merged with another person's words. They SHALL NOT ask for names to be locked to their first spelling: measured on 8 clips (2026-11-19), that rule together with "keep unclear words" carried a misheard name (Keith Johnstone → Kiss Johnson) through a whole clip and merged two names into one. The instructions for a translated stream SHALL NOT change.

#### Scenario: A question and its answer

- **WHEN** the instructions for a stream without translation are built, for chunks and for 回顧修訂
- **THEN** both contain their rule on separate speaker turns and neither contains a rule locking names to their first spelling
- **AND** the instructions with translation contain no speaker-turn rule

##### Example: what the rule aims at

| Recognized | Expected in the transcript |
| ---------- | -------------------------- |
| 然後它就會在前面 廣告的前面嗎 還是自然搜尋結果的前面 (two speakers) | two items: the statement, then the question |
| 是羞辱彼此的角色嗎 對不對 不是羞辱彼此的角色 (two speakers) | 對不對 stays with the question |
