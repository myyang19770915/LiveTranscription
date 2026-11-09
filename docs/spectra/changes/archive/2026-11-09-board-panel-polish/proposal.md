## Why

待辦看板詳細面板的排版有三個問題：「Email 提醒」欄的說明太長，把切換按鈕擠到第二行；純文字欄（Email 提醒、團隊、來源）的標籤與內容沒有對齊；會議產生的待辦在面板最下面多出一行「null」。

## What Changes

- 「Email 提醒」改成一行：開關（role=switch）加上「開啟／已關閉」，說明改成下方小字；不能切換的人看到狀態與「只有負責人或系統管理員可切換」。
- 每一欄的內容至少與 40px 的輸入框同高，標籤與內容對齊。
- 修正會議產生的待辦在面板最下面出現「null」：`replaceChildren` 會把 null 印成文字，改傳空字串。

## Non-Goals

- 不改提醒規則與權限（`action-reminders` 不變）。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none)

## Impact

- Affected specs: none
- webapp/static/actions.js、webapp/static/actions.css、webapp/static/actions.html、webapp/static/minutes.html（資產版本）、bench/reminders_e2e.mjs（改用開關檢查）
