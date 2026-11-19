## MODIFIED Requirements

### Requirement: 精準模式 without translation

When the stream's target is `none`, 精準模式 SHALL repair, segment and settle the spoken text as with a translation but SHALL NOT translate: the text model SHALL be given instructions without a translation step and SHALL NOT be told a language to translate into, an answer without translations SHALL be accepted, and every sentence SHALL have an empty translation. 回顧修訂 SHALL likewise correct and merge the spoken text only.

Without translation, the instructions to the text model (for chunks and for 回顧修訂) SHALL ask for a clean, readable transcript as an editor of meeting minutes would write it: fix recognition errors and wrong characters, use the standard written form of words and terms with Taiwan usage, remove filler words that carry no meaning (嗯, 呃, 欸, 那個, 就是, 然後, 的話, 對對對 used as fillers), stutters, false starts and words said twice by mistake, and make each sentence read smoothly. The same instructions SHALL state these limits: every point that was said is kept (facts, numbers, names, negations, conditions, hedges, questions) and nothing is summarized or added; speech in English or another language is kept as spoken and not translated; a direct quote stays a direct quote; a sentence the speaker left unfinished is not completed or paraphrased and the speaker's meaning is not changed; each item holds one complete thought; and 回顧修訂 leaves a sentence that already reads well word for word. The instructions for a translated stream SHALL NOT change.

#### Scenario: 精準模式 in a Chinese meeting

- **WHEN** a meeting with 不翻譯（只整理原文） and 精準模式 runs
- **THEN** its sentences replace the live text as corrected Chinese sentences, and no request to the text model asks for a translation

#### Scenario: Polished, not translated

- **WHEN** the system prompt for a Chinese stream with target `none` is built, and the 回顧修訂 prompt for a stream without translation
- **THEN** both ask to remove filler words such as 那個 and 就是, and both state that English speech is kept as spoken, a direct quote stays direct, an unfinished sentence is not completed, and nothing is added or summarized
- **AND** the system prompt for a Chinese stream translated into English, and the 回顧修訂 prompt with translation, are unchanged by this requirement

##### Example: a polished sentence

| Recognized | Polished |
| ---------- | -------- |
| 那個我們就是下週要把代辦事項整理一下 | 我們下週要把待辦事項整理一下。 |
| 他說：「OK, thank you，我們再看看」 | 他說：「OK, thank you，我們再看看。」 |
