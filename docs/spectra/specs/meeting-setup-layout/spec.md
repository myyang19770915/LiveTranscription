# meeting-setup-layout Specification

## Purpose

The meeting page puts the settings people change for each meeting first and folds away the advanced options most meetings leave alone, so the live transcript appears sooner on screen without hiding which advanced options are on.

## Requirements

### Requirement: Advanced settings fold away by default

On the meeting page (`/`) on a window wider than 760px, the 進階 heading SHALL be a button with `aria-expanded` and `aria-controls` that shows or hides the advanced settings it introduces: 辨識引擎 (a read-only statement of the engine in use), 雲端精修 and 精準模式. On a first visit the group SHALL be folded. The chosen state SHALL be stored in localStorage under `setupAdvancedOpen` and used on later visits; when storage is unavailable the group SHALL start folded. 會議情境 is not an advanced setting and SHALL stay visible. When none of the advanced settings is offered, the heading SHALL stay hidden as before. Folding SHALL NOT change any setting's value or what is sent when a meeting starts.

#### Scenario: First visit

- **WHEN** a user with no stored preference opens `/` on a 1280px window and the server offers at least one advanced setting
- **THEN** the 進階 button shows `aria-expanded="false"`, 辨識引擎, 雲端精修 and 精準模式 are not visible, and 會議情境 is visible

#### Scenario: Unfold and remember

- **WHEN** the user presses 進階 and reloads the page
- **THEN** the advanced settings are visible after the reload and the button shows `aria-expanded="true"`

#### Scenario: Folding keeps the settings

- **WHEN** 精準模式 is checked, the group is folded and a meeting is started
- **THEN** the meeting starts with 精準模式 on, exactly as with the group unfolded


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

At 760px or less the meeting page SHALL show every advanced setting the server offers (辨識引擎, 雲端精修 and 精準模式) unfolded inside the settings dialog, in that order, and the 進階 heading there SHALL NOT act as a fold button. At that width the setup area above the transcript SHALL hold only the language row (語音語言, the swap button and 翻譯成) in a single grid row; no advanced setting SHALL remain in it. Returning to a wider window SHALL put each moved setting back in its original place.

#### Scenario: Phone width

- **WHEN** `/` is opened at 500px while the server offers MAI and cloud refinement, and the settings dialog is opened
- **THEN** 辨識引擎 and 雲端精修 appear in the dialog without pressing 進階

#### Scenario: 精準模式 offered on a phone

- **WHEN** `/` is opened at 390px in 即時翻譯 mode while the server offers 精準模式
- **THEN** 語音語言 and 翻譯成 are each at least 120px wide and share one row, 精準模式 is not in the setup area, and the settings dialog shows 精準模式 after 雲端精修

#### Scenario: Back to a wide window

- **WHEN** the page is resized from 390px to 1280px
- **THEN** 精準模式 is back inside the 進階 group next to 雲端精修


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
### Requirement: The spoken language decides the recognition engine

The meeting page (both 會議 and 即時翻譯 modes) SHALL NOT offer a recognition engine selector. When `/api/config` reports `mai` true, the engine SHALL be `local` for the spoken languages `zh`, `yue`, `auto` and `zh_ja` and `mai` for every other spoken language; when `mai` is false or `/api/config` cannot be read, the engine SHALL be `local`. This engine SHALL be the `engine` sent in `POST /api/meetings` and in the stream header, and a value stored under the localStorage key `asrEngine` by earlier versions SHALL have no effect. When `mai` is true the 辨識引擎 row SHALL show, as text, 本機（語橋主機） for the `local` engine or 雲端辨識（音訊會傳送到外部服務） for the `mai` engine, and the note 依語音語言自動選擇：中文、粵語、中英、中日雙向用本機，其他語言用雲端 MAI. The text SHALL update as soon as the spoken language changes, including through the swap button. When `mai` is false the row SHALL stay hidden.

#### Scenario: Language picks the engine

- **WHEN** the server offers MAI and the user picks a spoken language and starts a meeting
- **THEN** the 辨識引擎 row text and the `engine` sent are as in the example table

##### Example: engine by language

| Spoken language | `mai` in `/api/config` | Row text | `engine` sent |
| --------------- | ---------------------- | -------- | ------------- |
| zh | true | 本機（語橋主機） | local |
| yue | true | 本機（語橋主機） | local |
| auto | true | 本機（語橋主機） | local |
| zh_ja | true | 本機（語橋主機） | local |
| ja | true | 雲端辨識（音訊會傳送到外部服務） | mai |
| en | true | 雲端辨識（音訊會傳送到外部服務） | mai |
| ja | false | (row hidden) | local |

#### Scenario: Old stored choice is ignored

- **WHEN** localStorage holds `asrEngine` = `mai`, the server offers MAI and the spoken language is 中文
- **THEN** the row shows 本機（語橋主機） and the meeting starts with `engine` `local`

#### Scenario: Swapping the direction updates the engine

- **WHEN** the spoken language is 中文, the target is 日本語, and the user presses the swap button
- **THEN** the row shows 雲端辨識（音訊會傳送到外部服務） without reloading the page


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


<!-- @trace
source: plain-wording-no-tech-names
updated: 2026-11-17
code:
  - webapp/static/ask.js
  - webapp/static/privacy-note.js
  - bench/interpret_e2e.mjs
  - bench/series_e2e.mjs
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - bench/README.md
  - README.md
  - webapp/static/meetings.html
  - webapp/static/admin.html
  - lab/realtime-translate/index.html
  - webapp/server.py
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - bench/qa_e2e.mjs
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/interpret.css
  - webapp/static/metrics.js
  - webapp/static/refine.css
  - webapp/static/index.html
  - bench/translate_e2e.mjs
  - webapp/migrations/019_interpret_usage.sql
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - chang01.png
  - webapp/static/minutes.js
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/interpret.py
  - bench/ui_polish_e2e.mjs
  - webapp/interpret_usage.py
  - .env.example
  - webapp/static/admin.css
  - webapp/static/ask.html
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/qa.py
  - lab/realtime-translate/costs.jsonl
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - webapp/minutes.py
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - compose.yaml
  - lab/realtime-translate/server.py
  - webapp/static/metrics.html
  - lab/realtime-translate/sessions/20261117-174651/output.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: Cloud refinement and 精準模式 state what each does

Each of the 雲端精修 and 精準模式 checkboxes SHALL show, as visible text next to the checkbox and not only as a tooltip, two lines: what it does and how fast, and what it sends and when to use it, with the wording of the example table. The text SHALL be visible at 1280px when 進階 is unfolded and at 390px inside the settings dialog. While 精準模式 is checked, the second line of 雲端精修 SHALL read 精準模式已包含，不需另外開啟, and SHALL return to its normal wording when 精準模式 is unchecked.

#### Scenario: Both explanations visible

- **WHEN** the server offers both and the user opens the advanced settings at 1280px, or the settings dialog at 390px
- **THEN** both checkboxes show both lines of the example table

##### Example: explanation wording

| Checkbox | First line | Second line |
| -------- | ---------- | ----------- |
| 雲端精修 | 只改寫譯文：每句定稿後幾秒內由雲端服務帶前後文重譯，原文不變 | 傳送文字到外部服務 · 適合辨識已正確、想要譯文更通順 |
| 精準模式 | 重新辨識再翻譯：語句結束後把音訊交給較準的辨識重新修字、斷句、翻譯，取代即時結果，約慢 10–25 秒 | 傳送音訊與文字到外部服務 · 適合重要會議、需要準確紀錄；已包含雲端精修 |

#### Scenario: 精準模式 covers cloud refinement

- **WHEN** the user checks 精準模式
- **THEN** 雲端精修 is disabled and its second line reads 精準模式已包含，不需另外開啟, and after unchecking 精準模式 it reads 傳送文字到外部服務 · 適合辨識已正確、想要譯文更通順 again

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

<!-- @trace
source: plain-wording-no-tech-names
updated: 2026-11-17
code:
  - webapp/static/ask.js
  - webapp/static/privacy-note.js
  - bench/interpret_e2e.mjs
  - bench/series_e2e.mjs
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - bench/README.md
  - README.md
  - webapp/static/meetings.html
  - webapp/static/admin.html
  - lab/realtime-translate/index.html
  - webapp/server.py
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - bench/qa_e2e.mjs
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/interpret.css
  - webapp/static/metrics.js
  - webapp/static/refine.css
  - webapp/static/index.html
  - bench/translate_e2e.mjs
  - webapp/migrations/019_interpret_usage.sql
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - chang01.png
  - webapp/static/minutes.js
  - webapp/static/interpret.js
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/interpret.py
  - bench/ui_polish_e2e.mjs
  - webapp/interpret_usage.py
  - .env.example
  - webapp/static/admin.css
  - webapp/static/ask.html
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/qa.py
  - lab/realtime-translate/costs.jsonl
  - webapp/static/minutes.html
  - webapp/static/interpret.html
  - webapp/minutes.py
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - compose.yaml
  - lab/realtime-translate/server.py
  - webapp/static/metrics.html
  - lab/realtime-translate/sessions/20261117-174651/output.wav
tests:
  - webapp/test_server.py
-->