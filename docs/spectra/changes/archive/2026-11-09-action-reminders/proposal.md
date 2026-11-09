## Why

待辦看板能看到逾期，但負責人不一定每天打開看板，常到會議上才發現事情過期。roadmap P5 ②「寄送」的另一半是到期提醒：系統在到期前、到期當天與逾期期間主動寄 Email 給負責人。寄信基礎（SMTP、成員 Email）已由 `minutes-mail` 完成。

## What Changes

- **每日提醒**：背景每天在 `REMIND_AT`（預設 09:00，`MEETING_TIMEZONE` 時間）檢查一次；app 在當天提醒時間之後才啟動時立刻補做一次。
- **寄給負責人的時機**：到期前 3 天內提醒一次、到期當天一次、逾期後每天一次。只處理已確認、狀態「未開始」或「進行中」、有負責人、有到期日、負責人仍是該團隊成員且有 Email 的待辦。
- **一人一封**：同一位負責人當天的提醒合併成一封，依「逾期」「今天到期」「即將到期」分組，每件附看板連結。
- **不重複**：每件事項的每種提醒都記錄在新資料表，同一天重啟或重跑不會再寄；寄送失敗會撤銷紀錄，下次檢查重試。
- **個別關閉提醒**：看板事項的詳細面板新增「Email 提醒」開關，只有負責人與系統管理員能切換；關閉的事項在卡片上顯示 🔕。負責人換人時提醒自動恢復開啟。
- **手動執行**：`python -m reminders run [--today YYYY-MM-DD]` 立即執行一次（測試與補寄用）。

## Non-Goals

- 提醒寄給負責人以外的人（例如會議主持人、團隊信箱）、可自訂提醒天數或時間（每人／每團隊）。
- Teams／Slack 等其他通知管道；站內通知。
- 沒有到期日或沒有負責人的待辦（不寄）。

## Capabilities

### New Capabilities

- `action-reminders`: 待辦到期前、到期當天、逾期每天寄 Email 提醒給負責人，以及個別關閉提醒。

### Modified Capabilities

(none)

## Impact

- 新增 webapp/reminders.py（篩選、分組、寄送、排程、CLI）與 webapp/migrations/015_action_reminders.sql。
- 修改 webapp/actions.py（看板帶出 `remind`、`POST /api/actions/{id}/remind`、換負責人恢復提醒）、webapp/minutes.py（紀要頁換負責人同樣恢復提醒）、webapp/server.py（lifespan 啟動排程）、webapp/mailer.py（共用寄送）。
- 前端：webapp/static/actions.js、webapp/static/actions.css、webapp/static/actions.html（資產版本）、webapp/static/account.js（我的 Email 說明文字提到提醒）。
- 設定：compose.yaml、.env.example（`REMIND_AT`）、README.md。
- 測試：webapp/test_server.py、新增 bench/reminders_e2e.mjs。
