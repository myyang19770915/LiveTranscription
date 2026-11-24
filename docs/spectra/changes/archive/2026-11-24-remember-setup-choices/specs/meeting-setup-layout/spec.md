## ADDED Requirements

### Requirement: The page remembers every sentence choice

The live page SHALL keep, in this browser, the last value the user chose for each setting named in the setup sentence, and SHALL show that value again after the page is loaded again, whether by a reload or by 清除: the mode, the team, the spoken language (one value for all three modes), 翻譯成 (one value for 開會, including 不翻譯, and one for 即時翻譯; 即時口譯 keeps its own output language), the audio source, the microphone and 同步播放譯音. A value SHALL be stored only when the user chooses it, never when the page adjusts a control by itself. A stored value that is not an available option when the page loads SHALL be ignored without being erased. The microphone SHALL be stored with its device id and its shown name and restored by the id, else by the name; when the device list has neither (the microphone is unplugged, or the browser has not yet given access to device names), the page SHALL use the first microphone and SHALL restore the stored one when a later device list has it, unless the user has chosen a microphone since the page loaded. When the browser's storage is unavailable the page SHALL work with its default values.

#### Scenario: The audio source after a reload

- **WHEN** the user chooses 分頁或系統聲音 as the audio source on `/` and reloads the page
- **THEN** `#audioSource` is `system` and the sentence names that source

#### Scenario: The microphone after a reload

- **WHEN** the user chooses the second of three microphones and reloads the page with microphone access granted
- **THEN** `#microphone` has the same device id selected and the sentence shows that microphone's name

#### Scenario: The stored microphone is unplugged

- **WHEN** the page loads and no microphone in the list has the stored id or the stored name
- **THEN** the first microphone is selected and the stored id and name are unchanged

#### Scenario: Choices made in 即時翻譯

- **WHEN** the user chooses 英文 as the spoken language and 日文 as 翻譯成 in 即時翻譯 and reloads the page
- **THEN** the page is in 即時翻譯 with `#language` `en` and `#targetLanguage` `ja`

#### Scenario: 清除

- **WHEN** the user presses 清除 in the footer
- **THEN** the mode, team, spoken language, 翻譯成, audio source and microphone are the ones chosen before

##### Example: 翻譯成 by mode

| Chosen in 開會 | Chosen in 即時翻譯 | After a reload in 開會 | After switching to 即時翻譯 |
| --- | --- | --- | --- |
| 不翻譯 (`none`) | 日文 (`ja`) | `none` | `ja` |
| 英文 (`en`) | (nothing chosen) | `en` | `en` |
