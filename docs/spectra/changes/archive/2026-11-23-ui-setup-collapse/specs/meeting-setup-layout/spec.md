## ADDED Requirements

### Requirement: The setup folds behind 更多設定 before a session

On the live page (`/`) on a wide window (when the phone layout query `mobileQuery` does not match), before a session starts, the settings area (`section.controls`) SHALL start folded on a first visit: it SHALL show only the mode buttons (`#modeRow`), a 更多設定 button (`#setupMore`) and the start button (`#start`), on one row, and SHALL hide every other setting. `#setupMore` SHALL have `aria-expanded`, and pressing it SHALL show or hide the other settings. The chosen state SHALL be stored in localStorage under `setupMoreOpen` and used on later visits; when storage is unavailable the area SHALL start folded. Folding SHALL NOT change any setting's value or what is sent when a session starts. With the phone layout, `#setupMore` SHALL NOT be shown and the settings dialog SHALL be as before.

#### Scenario: First visit at 1440px

- **WHEN** a user with no stored preference opens `/` at 1440 × 900
- **THEN** `#setupMore` shows `aria-expanded="false"`, the mode buttons and `#start` are visible, `#team`, `#language` and `#testMic` are not visible, and the bottom edge of each `.transcript-card .card-head` is within the window

#### Scenario: Unfold and remember

- **WHEN** the user presses 更多設定 and reloads the page
- **THEN** `#team`, `#language` and `#testMic` are visible after the reload and `#setupMore` shows `aria-expanded="true"`

#### Scenario: A phone

- **WHEN** `/` is opened at 390px
- **THEN** `#setupMore` is not visible and the language row, the settings dialog and the bottom start button are as before this change

---

### Requirement: The sentence breaks only between its clauses

`#setupSentence` SHALL put each part between two 「，」 in its own element with the class `sentence-clause`, ending with its 「，」, and SHALL break lines only between these elements, unless one clause is wider than the line.

#### Scenario: A long team name

- **WHEN** the team is named 智慧應用部跨國客戶服務暨品質管理推動小組 at 1440px
- **THEN** every `.sentence-clause` of `#setupSentence` lies on one line and the page has no horizontal scroll

---

### Requirement: Advanced options are compact switches on one row

On a wide window, 雲端精修 (`#cloudRefineRow`) and 精準模式 (`#qualityRow`) SHALL be shown side by side on one row when 進階 is unfolded, each as a 36px-high rounded switch showing its name, with the switch drawn from its checkbox. Checking, disabling and the `title` SHALL behave as stated by "Cloud refinement and 精準模式 state what each does". The settings dialog on a phone SHALL keep its own rows.

#### Scenario: Both offered

- **WHEN** the server offers both and the user unfolds 進階 at 1440px
- **THEN** `#cloudRefineRow` and `#qualityRow` have the same top and a height of 36px

---

### Requirement: Setup details read in full

On the live page the data destination notice (`.privacy`) SHALL use 13px text; on a wide window the two language tags of the swap button (`#swap`) SHALL be on one line; the audio test status (`#micStatus`) SHALL NOT be cut off with an ellipsis; and the language mark of a transcript card (`.language-dot`, for example 中⇄日) SHALL be on one line at every width.

#### Scenario: The setup at 1440px

- **WHEN** `/` is opened at 1440px with 更多設定 unfolded and the language 中日雙向自動
- **THEN** the computed font size of `.privacy` is 13px, the two `#swap .lang-tag` have the same top, `#micStatus` has a `scrollWidth` no larger than its `clientWidth`, and each `.language-dot` is one line high

#### Scenario: The language mark on a phone

- **WHEN** `/` is opened at 390px with the language 中日雙向自動
- **THEN** the translation card's `.language-dot` reads 中⇄日 on one line

## MODIFIED Requirements

### Requirement: Sentence words open their setting

Each setting named in the sentence SHALL be a `button` element in the sentence whose accessible name names the setting (for example 更改語音語言), and pressing it SHALL move the focus to that setting's own control: 語音語言 (`#language`), 翻譯成 (`#targetLanguage`), 音訊來源 (`#audioSource`), 麥克風來源 (`#microphone`), 團隊 (`#team`) or 同步播放譯音 (`#interpretPlay`). When the settings area is folded behind 更多設定, pressing a sentence word SHALL first unfold it and store `setupMoreOpen` as open. When the control is a `select` and the browser offers `showPicker()`, its list SHALL open; when `showPicker()` is missing or fails, only the focus SHALL move and no error SHALL be shown. The native controls SHALL stay in the settings area with their labels.

#### Scenario: Changing the team from the sentence

- **WHEN** the user presses 智慧應用部 in the sentence on `/` at 1440px
- **THEN** `document.activeElement` is `#team`

#### Scenario: Changing the spoken language from the sentence

- **WHEN** the user presses 中文和日文 in the sentence
- **THEN** `document.activeElement` is `#language`

#### Scenario: A sentence word while the setup is folded

- **WHEN** the settings area is folded and the user presses 智慧應用部 in the sentence at 1440px
- **THEN** `#setupMore` shows `aria-expanded="true"`, `#team` is visible and `document.activeElement` is `#team`
