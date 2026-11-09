## Why

待辦看板詳細面板仍然沒有對齊：三個輸入框（狀態、負責人、到期日）寬度不一，負責人頭像放在選單前面把選單往右推，「原話」擠在日期那一行，「Email 提醒」的開關比標籤高。

## What Changes

- 面板內的狀態、負責人、到期日控制項統一 220px 寬、靠左對齊；頭像、到期標籤等附加資訊放在控制項右邊。
- 每個標籤與內容的第一行同為 40px 高並置中，標籤欄加寬到 84px 且不換行。
- 「原話」與 Email 提醒的說明都改成控制項下方的小字（`.field-hint`）。

## Non-Goals

- 不改面板的欄位、行為與權限。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none)

## Impact

- Affected specs: none
- webapp/static/actions.js、webapp/static/actions.css、webapp/static/actions.html、webapp/static/minutes.html（資產版本）、bench/reminders_e2e.mjs（說明文字的選擇器）
