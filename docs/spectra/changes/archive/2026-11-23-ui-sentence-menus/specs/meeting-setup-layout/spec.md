## ADDED Requirements

### Requirement: Microphone names are readable

The live page SHALL show each microphone by its device name without the trailing USB code (four hexadecimal digits, a colon and four more, in parentheses). A name that starts with `Default - ` SHALL be shown in the microphone menu as the rest of the name followed by （系統預設）, and one that starts with `Communications - ` as the rest followed by （通訊）. The setup sentence SHALL use the name without these marks. The microphone chosen and remembered SHALL NOT change.

#### Scenario: A Windows USB microphone

- **WHEN** the browser lists the microphones of the example table
- **THEN** the microphone menu and the sentence show the names of the example table

##### Example: microphone names

| Device label | Menu | Sentence |
| ------------ | ---- | -------- |
| Default - 麥克風 (IPEVO V4K PRO) (1778:d002) | 麥克風 (IPEVO V4K PRO)（系統預設） | 麥克風 (IPEVO V4K PRO) |
| Communications - 麥克風 (IPEVO V4K PRO) (1778:d002) | 麥克風 (IPEVO V4K PRO)（通訊） | 麥克風 (IPEVO V4K PRO) |
| 麥克風 (Realtek(R) Audio) | 麥克風 (Realtek(R) Audio) | 麥克風 (Realtek(R) Audio) |

## MODIFIED Requirements

### Requirement: Sentence words open their setting

Each setting named in the sentence SHALL be a `button` element in the sentence whose accessible name names the setting (for example 更改語音語言), with `aria-haspopup="listbox"`, unless that setting's control is disabled, in which case the word SHALL be plain text. Pressing it SHALL open a menu (`#sentenceMenu`, `role="listbox"`) directly below the word that lists the options of that setting's control — 語音語言 (`#language`), 翻譯成 (`#targetLanguage`), 音訊來源 (`#audioSource`), 麥克風來源 (`#microphone`), 團隊 (`#team`), or 同步播放譯音 (`#interpretPlay`) with the two options 同步播放譯音 and 不播放譯音 — with the group headings of the control, the current option marked `aria-selected="true"` and focused. The arrow keys SHALL move between enabled options, Home and End SHALL go to the first and last, Enter, Space or a click SHALL choose an option, and Escape, Tab or a click outside SHALL close the menu without a change. Choosing SHALL set that control exactly as choosing it in the settings area would, close the menu, update the sentence and return the focus to the same setting word. Opening the menu SHALL NOT unfold the settings area. The native controls SHALL stay in the settings area with their labels.

#### Scenario: Changing the team from the sentence

- **WHEN** the settings area is folded and the user presses the team name in the sentence on `/` at 1440px
- **THEN** `#sentenceMenu` is visible below the word and lists every option of `#team`, the current team has `aria-selected="true"` and the focus, and `#setupMore` still shows `aria-expanded="false"`

#### Scenario: Choosing with the keyboard

- **WHEN** the team menu is open on a list of at least two teams and the user presses the down arrow and then Enter
- **THEN** `#team` holds the second option, the sentence names it, the menu is closed and the focus is on the team word

#### Scenario: Closing without a change

- **WHEN** a sentence menu is open and the user presses Escape
- **THEN** the menu is closed, the setting is unchanged and the focus is on the word that opened it

#### Scenario: The spoken language menu

- **WHEN** the user presses 中文和日文 in the sentence
- **THEN** the menu lists the groups 語言與對話模式 and 其他語言 · 效果可能因語言而異 with their options, and 中日雙向自動 is selected
