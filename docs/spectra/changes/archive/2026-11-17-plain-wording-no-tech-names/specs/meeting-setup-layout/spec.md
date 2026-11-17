## MODIFIED Requirements

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
