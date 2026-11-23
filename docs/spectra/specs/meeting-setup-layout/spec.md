# meeting-setup-layout Specification

## Purpose

The meeting page puts the settings people change for each meeting first and folds away the advanced options most meetings leave alone, so the live transcript appears sooner on screen without hiding which advanced options are on.

## Requirements

### Requirement: Advanced settings fold away by default

On the meeting page (`/`) on a window wider than 760px, the 進階 heading SHALL be a button with `aria-expanded` and `aria-controls` that shows or hides the advanced settings it introduces: 雲端精修 and 精準模式. On a first visit the group SHALL be folded. The chosen state SHALL be stored in localStorage under `setupAdvancedOpen` and used on later visits; when storage is unavailable the group SHALL start folded. 會議情境 is not an advanced setting and SHALL stay visible. When none of the advanced settings is offered, the heading SHALL stay hidden as before. Folding SHALL NOT change any setting's value or what is sent when a meeting starts.

#### Scenario: First visit

- **WHEN** a user with no stored preference opens `/` on a 1280px window and the server offers at least one advanced setting
- **THEN** the 進階 button shows `aria-expanded="false"`, 雲端精修 and 精準模式 are not visible, and 會議情境 is visible

#### Scenario: Unfold and remember

- **WHEN** the user presses 進階 and reloads the page
- **THEN** the advanced settings are visible after the reload and the button shows `aria-expanded="true"`

#### Scenario: Folding keeps the settings

- **WHEN** 精準模式 is checked, the group is folded and a meeting is started
- **THEN** the meeting starts with 精準模式 on, exactly as with the group unfolded


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: Folded heading names the advanced options in use

While folded, the 進階 button SHALL show a short summary of the offered advanced choices that differ from their defaults, joined with 、, or 預設 when none differ. The choices are 雲端精修 (listed when it is checked, offered and 精準模式 is not checked) and 精準模式 (listed when it is checked and offered). The recognition engine SHALL NOT appear in the summary, because it is decided by the spoken language and is not a choice. The summary SHALL update when a setting changes.

#### Scenario: Summary text

- **WHEN** the group is folded with the given settings
- **THEN** the button's summary reads as in the example table

##### Example: summary

| Spoken language | 雲端精修 | 精準模式 | Summary |
| --------------- | -------- | -------- | ------- |
| 中文 | off | off | 預設 |
| 日本語 | off | off | 預設 |
| 中文 | off | on | 精準模式 |
| 日本語 | on | off | 雲端精修 |
| 日本語 | on | on | 精準模式 |


<!-- @trace
source: engine-auto-and-mode-help
updated: 2026-11-15
code:
  - bench/README.md
  - webapp/static/refine.css
  - bench/translate_e2e.mjs
  - webapp/static/app.js
  - bench/ui_polish_e2e.mjs
  - webapp/static/index.html
  - chang01.png
-->

---
### Requirement: Narrow screens keep the settings dialog unchanged

At 760px or less the meeting page SHALL show every advanced setting the server offers (雲端精修 and 精準模式) unfolded inside the settings dialog, in that order, and the 進階 heading there SHALL NOT act as a fold button. At that width the setup area above the transcript SHALL hold only the language row (語音語言, the swap button and 翻譯成) in a single grid row; no advanced setting SHALL remain in it. Returning to a wider window SHALL put each moved setting back in its original place.

#### Scenario: Phone width

- **WHEN** `/` is opened at 500px while the server offers cloud refinement, and the settings dialog is opened
- **THEN** 雲端精修 appears in the dialog without pressing 進階, and no 辨識引擎 row is shown

#### Scenario: 精準模式 offered on a phone

- **WHEN** `/` is opened at 390px in 即時翻譯 mode while the server offers 精準模式
- **THEN** 語音語言 and 翻譯成 are each at least 120px wide and share one row, 精準模式 is not in the setup area, and the settings dialog shows 精準模式 after 雲端精修

#### Scenario: Back to a wide window

- **WHEN** the page is resized from 390px to 1280px
- **THEN** 精準模式 is back inside the 進階 group next to 雲端精修


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: The spoken language decides the recognition engine

The meeting page (both 會議 and 即時翻譯 modes) SHALL NOT offer a recognition engine selector and SHALL NOT show a 辨識引擎 row, at any width. When `/api/config` reports `mai` true, the engine SHALL be `local` for the spoken languages `zh`, `yue`, `auto` and `zh_ja` and `mai` for every other spoken language; when `mai` is false or `/api/config` cannot be read, the engine SHALL be `local`. This engine SHALL be the `engine` sent in `POST /api/meetings` and in the stream header, and a value stored under the localStorage key `asrEngine` by earlier versions SHALL have no effect. Where the audio goes SHALL be stated by the data destination notice (`#privacyNote` and the footer), which names 雲端辨識 when the engine is `mai`, and SHALL update as soon as the spoken language changes, including through the swap button.

#### Scenario: Language picks the engine

- **WHEN** the server offers MAI and the user picks a spoken language and starts a meeting
- **THEN** the `engine` sent is as in the example table and no 辨識引擎 row is visible

##### Example: engine by language

| Spoken language | `mai` in `/api/config` | `engine` sent |
| --------------- | ---------------------- | ------------- |
| zh | true | local |
| yue | true | local |
| auto | true | local |
| zh_ja | true | local |
| ja | true | mai |
| en | true | mai |
| ja | false | local |

#### Scenario: Old stored choice is ignored

- **WHEN** localStorage holds `asrEngine` = `mai`, the server offers MAI and the spoken language is 中文
- **THEN** the meeting starts with `engine` `local`

#### Scenario: Swapping the direction updates the data destination

- **WHEN** the server offers MAI and no external translation, the spoken language is 中文, the target is 日本語, and the user presses the swap button
- **THEN** the data destination notice names 雲端辨識 without reloading the page


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: Cloud refinement and 精準模式 state what each does

The 雲端精修 and 精準模式 checkboxes SHALL show only their names as visible text. What each does and what it sends SHALL be kept as the `title` of its row, with the wording of the example table. While 精準模式 is checked, 雲端精修 SHALL be disabled. What leaves the server SHALL be stated by the data destination notice, which SHALL change as soon as either box is checked or unchecked.

#### Scenario: Names only

- **WHEN** the server offers both and the user opens the advanced settings at 1280px, or the settings dialog at 390px
- **THEN** each row shows only 雲端精修 or 精準模式 as text, and its `title` holds both lines of the example table

##### Example: explanation wording

| Checkbox | First line | Second line |
| -------- | ---------- | ----------- |
| 雲端精修 | 只改寫譯文：每句定稿後幾秒內由雲端服務帶前後文重譯，原文不變 | 傳送文字到外部服務 · 適合辨識已正確、想要譯文更通順 |
| 精準模式 | 重新辨識再翻譯：語句結束後把音訊交給較準的辨識重新修字、斷句、翻譯，取代即時結果，約慢 10–25 秒 | 傳送音訊與文字到外部服務 · 適合重要會議、需要準確紀錄；已包含雲端精修 |

#### Scenario: 精準模式 covers cloud refinement

- **WHEN** the user checks 精準模式
- **THEN** 雲端精修 is disabled and the data destination notice reads 精準模式 with 音訊與文字會傳送到外部服務


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: Settings read as one sentence before a session

On the live page (`/`) on a window wider than 760px, before a session starts, the page title (`#setupSentence`, an `h1`) SHALL be one sentence that states the current settings for the selected mode, as composed by `SetupSentence.compose` with the wording of the example table: the parts are joined with 「，」 and the sentence ends without a full stop. A label that starts with a Latin letter SHALL be preceded by a space when it follows a Chinese character, and a label that ends with a Latin letter or a digit SHALL be followed by a space when a Chinese character follows. The sentence SHALL update as soon as the mode, 語音語言, 翻譯成, 音訊來源, 麥克風來源, 團隊 or 同步播放譯音 changes. The data destination notice (`#privacyNote`) SHALL stay visible next to the sentence. At 760px or less the sentence SHALL NOT be shown and the page SHALL look as before.

#### Scenario: The sentence follows the settings

- **WHEN** the settings of a row of the example table are chosen on `/` at 1440px
- **THEN** the text of `#setupSentence` is the sentence of that row

##### Example: sentence wording

| Mode | 語音語言 | 翻譯成 | 音訊來源 | 麥克風來源 | 團隊 | 同步播放譯音 | Sentence |
| ---- | -------- | ------ | -------- | ---------- | ---- | ------------ | -------- |
| 開會 | 中日雙向自動 | 中文 ⇄ 日文 | 麥克風 | 麥克風 1 | 智慧應用部 | — | 中文和日文互相翻譯，從麥克風 1 收音，記進智慧應用部的會議紀錄 |
| 開會 | 中文 | English | 麥克風 | 系統預設麥克風 | 智慧應用部 | — | 說中文，翻成 English，從系統預設麥克風收音，記進智慧應用部的會議紀錄 |
| 開會 | 中文 | 不翻譯（只整理原文） | 麥克風 | 麥克風 1 | 智慧應用部 | — | 說中文，只記錄原文，從麥克風 1 收音，記進智慧應用部的會議紀錄 |
| 開會 | 中文 | English | 麥克風 | 麥克風 1 | (none) | — | 說中文，翻成 English，從麥克風 1 收音，記進會議紀錄 |
| 即時翻譯 | 日本語 | 繁體中文 | 分頁／系統聲音 | — | — | — | 說日本語，翻成繁體中文，從分頁／系統聲音收音，存成你的紀錄 |
| 即時翻譯 | 中英自動偵測 | 日本語 | 麥克風＋系統聲音 | 麥克風 1 | — | — | 說中文或英文，翻成日本語，從麥克風 1 和分頁聲音收音，存成你的紀錄 |
| 即時口譯 | 中文 | English | 麥克風 | 麥克風 1 | — | on | 說中文，口譯成 English，從麥克風 1 收音，同步播放譯音，存成你的紀錄 |
| 即時口譯 | 中文 | English | 麥克風 | 麥克風 1 | — | off | 說中文，口譯成 English，從麥克風 1 收音，不播放譯音，存成你的紀錄 |

#### Scenario: Phone width

- **WHEN** `/` is opened at 390px
- **THEN** `#setupSentence` is not visible and the language row, the settings dialog and the bottom start button are where they were before this change


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: Sentence words open their setting

Each setting named in the sentence SHALL be a `button` element in the sentence whose accessible name names the setting (for example 更改語音語言), and pressing it SHALL move the focus to that setting's own control: 語音語言 (`#language`), 翻譯成 (`#targetLanguage`), 音訊來源 (`#audioSource`), 麥克風來源 (`#microphone`), 團隊 (`#team`) or 同步播放譯音 (`#interpretPlay`). When the control is a `select` and the browser offers `showPicker()`, its list SHALL open; when `showPicker()` is missing or fails, only the focus SHALL move and no error SHALL be shown. The native controls SHALL stay in the settings area with their labels.

#### Scenario: Changing the team from the sentence

- **WHEN** the user presses 智慧應用部 in the sentence on `/` at 1440px
- **THEN** `document.activeElement` is `#team`

#### Scenario: Changing the spoken language from the sentence

- **WHEN** the user presses 中文和日文 in the sentence
- **THEN** `document.activeElement` is `#language`


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: A session folds the settings into a floating recorder bar

On a window wider than 760px, while a session runs (from the moment the controls are locked until they are unlocked after the session is saved), the settings area (`section.controls`) SHALL be hidden, `#setupSentence` SHALL show the same sentence as plain text without buttons, `body` SHALL have the class `live-session`, and the live bar (`#liveBar`) SHALL stay fixed at the bottom of the window and hold the end button (`#start`, reading 結束會議, 結束翻譯 or 結束口譯, and 結束中… while the session is being saved). The end button SHALL be at least 16px from the other items of the bar. When the page is scrolled to the end, the bottom edges of both transcript cards and the footer buttons (複製, 浮動字幕, 畫面＋字幕, 清除, 匯出) SHALL be above the top edge of the bar. When the session ends, the class SHALL be removed, the settings area SHALL show again and the button SHALL return to its place in the settings area. The page SHALL NOT offer a pause button. At 760px or less the live bar and the start button SHALL stay where they are today.

#### Scenario: A meeting starts at 1440px

- **WHEN** the controls are locked for a session on `/` at 1440 × 900
- **THEN** `section.controls` is not visible, `#start` is inside `#liveBar`, `#liveBar` has a computed `position` of `fixed`, and after scrolling to the end the bottom of each `.transcript-card` and of every footer button is above the top of `#liveBar`

#### Scenario: The session ends

- **WHEN** the controls are unlocked after the session
- **THEN** `body` has no `live-session` class, `section.controls` is visible and `#start` is inside `section.controls` again

#### Scenario: A session on a phone

- **WHEN** the controls are locked for a session on `/` at 390px
- **THEN** `#start` is inside `#mobileActionSlot` and `#liveBar` does not have a computed `position` of `fixed`


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: The setup shows no explanatory small print

The live page's setup SHALL NOT show explanatory small print, at any width: no mode note (`#modeNote`), no 選填 or 例行會議 next to a field label, no second line in the start button (`#start`) or the audio test button (`#testMic`) other than the audio test status (`#micStatus`), no note on the right of a transcript card's footer, and no headphone tip when the audio source is 麥克風. The page SHALL keep the reason 即時口譯 is unavailable (`#interpretLocked`), the sharing steps shown for 分頁／系統聲音 and 麥克風＋系統聲音, the data destination notice and the footer's storage note.

#### Scenario: A quiet setup

- **WHEN** `/` is opened at 1440px in 開會 mode with the microphone as audio source, and at 390px with the settings dialog open
- **THEN** `#modeNote`, the label notes, `#start small`, the `small` of `#testMic` outside `#micStatus`, the right note of each `.card-foot` and `#sourceHint` are not visible, while `#privacyNote` is visible at 1440px

#### Scenario: Sharing a tab still explains how

- **WHEN** the audio source is 分頁／系統聲音
- **THEN** `#sourceHint` is visible and tells the user to tick 分享分頁音訊 or 分享系統音訊 in the Chrome share dialog

<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->