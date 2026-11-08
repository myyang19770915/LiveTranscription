## Why

實際用「畫面＋字幕」看 YouTube 時（使用者截圖），字幕框沒有限制高度：兩句英文譯文加上暫譯常常七、八行，框往上長到畫面外，工具列與「原文」那一行被推出螢幕，使用者只看得到一大片英文譯文、找不到中文原文。使用者要的是字幕的尺寸：原文、譯文頂多多一兩句，自動捲到最新。

## What Changes

- 字幕框的原文行、譯文、暫譯各最多 2 行（各自字級），貼齊底部、超出時先掉最舊的字，每次更新捲到最底，所以進行中的原文與最新的暫譯一定看得到、長譯文不會把原文擠掉；整個框另加 `max-height: 50vh` 的硬上限。
- 譯文仍取最近兩句、原文最近一句，但被內容區裁掉時只剩最新的部分，符合「頂多多一兩句」。
- 「原文」在畫面＋字幕裡改為獨立設定（`localStorage.overlay.source`，預設**開啟**），不再與浮動字幕視窗共用；字級仍共用。
- 顏色對照：正在講的那段原文（還沒定稿翻譯的部分）與它的暫譯用同一個醒目色（暖黃 `--sub-now`），已定稿的原文與譯文用白色，使用者一眼看出「現在講的對應到哪段譯文」；浮動字幕視窗同樣套用。`app.js` 把 `transcript.slice(0, translationOffset)`（已定稿原文）與 `transcript.slice(translationOffset)`（進行中原文）分開交給兩個字幕介面。
- 每次重繪後重新夾回可見範圍（已有 `place()`），框變矮時位置跟著修正。
- `bench/translate_e2e.mjs` 補檢查：餵很長的譯文與暫譯後，內容區高度不超過 4 行、暫譯仍在可見範圍（捲到最底）、原文預設顯示；README 更新說明。

## Non-Goals (optional)

- 不改浮動字幕（PiP）視窗；不改切句規則。
- 不做字幕淡出或逐字動畫。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `live-translation`: Requirement「Screen view with subtitles」改為：內容區最多 4 行、貼齊底部捲到最新；原文開關為覆蓋層自己的設定且預設開啟（字級仍共用）；進行中的原文與暫譯同色、定稿為白色。Requirement「Floating subtitles window」加同樣的顏色對照。

## Impact

- webapp/static/app.js（`render`／`renderTranslation` 多傳 `done`／`pending` 原文）、webapp/static/subtitles.js 與 subtitles.css（原文行分已定稿／進行中、顏色）、webapp/static/overlay.js（`.ov-body` 捲到最底、`source` 設定、預設值）、webapp/static/overlay.css（`.ov-body` 高度限制與底部對齊、框的 `max-height`）、webapp/static/index.html（`.ov-body` 包裝、資產版本號）、bench/translate_e2e.mjs、README.md、docs/spectra/specs/live-translation（delta）。不改伺服器。
