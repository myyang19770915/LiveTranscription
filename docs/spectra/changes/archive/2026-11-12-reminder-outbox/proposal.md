## Problem

待辦到期提醒在寄出前先把每則提醒寫進 `reminder_log`（佔位），寄送失敗或一般中斷時會撤銷佔位。但如果 app 程序在寄送途中被強制結束（`docker kill`、主機斷電、容器被 OOM 殺掉），`finally` 不會執行，佔位就留在表裡，被當成「已寄出」：
- 「3 天內到期」「今天到期」的提醒以到期日為鍵，之後永遠不會再寄；
- 當天的「逾期」提醒也會被跳過。

## Root Cause

`reminder_log` 只有一種狀態：一筆存在就代表已寄出。佔位與寄出是同一件事，沒有欄位能區分「正在寄」與「已寄出」，所以佔位沒被撤銷時，無法分辨該不該重寄。

## Proposed Solution

- `reminder_log` 的 `sent_at` 改為可為空，新增 `claimed_at`。佔位時 `sent_at` 為空，信件被 SMTP 接受後才寫入 `sent_at`。
- 佔位超過 10 分鐘仍未寄出（`sent_at` 為空），視為前一次執行已中斷，下一次執行可以接手重寄。
- 執行時若遇到其他執行還在處理、未滿 10 分鐘的佔位，結果回報 `pending`，排程 30 分鐘後重試，與寄送失敗時相同。
- 一般失敗與中斷時撤銷佔位的現有行為不變。

## Non-Goals

- 不處理「SMTP 已接受、但還沒寫入 `sent_at` 時程序被殺掉」造成的重寄：這種極短窗口會在 10 分鐘後重寄一次，接受偶爾重複，不接受漏寄。
- 不改提醒的時機、對象、內容與每人一封的規則。

## Success Criteria

- 模擬程序被強制結束（佔位寫入後直接放棄，不撤銷）：10 分鐘內的下一次執行不重寄、回報 pending；超過 10 分鐘後的執行會寄出（`test_server`）。
- 寄出後 `sent_at` 有值；同日再次執行不重寄（既有測試維持通過）。
- 既有 `ActionReminderTests` 全部通過。

## Impact

- Affected specs: `action-reminders`（修改「Reminder timing」：佔位與寄出分開，逾時的佔位可被接手）
- Affected code:
  - Modified: webapp/reminders.py, webapp/test_server.py
  - New: webapp/migrations/016_reminder_claims.sql
  - Removed: 無
