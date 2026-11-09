## 1. 資料與提醒核心

- [x] 1.1 migration `webapp/migrations/015_action_reminders.sql` 新增 `minute_items.remind` 與 `reminder_log`（設計：提醒種類與去重鍵；關閉提醒存在 minute_items.remind）；驗證：單元測試啟動時 migration 套用成功
- [x] 1.2 [after: 1.1] Requirement「Reminder timing」與「One reminder mail per owner」：`webapp/reminders.py` 的 `reminder_kind`、篩選條件、先佔位再寄失敗撤銷、一位負責人一封（設計：先佔位再寄，失敗撤銷；一位負責人一封）、`run(today)` 與 CLI；驗證：`ActionReminderTests` 的 timing example 表、同日重跑、逾期每天、失敗重試、無法聯絡的負責人、digest 主旨與跳脫測試通過
- [x] 1.3 [after: 1.2] 排程：`next_run` 與 `worker` 在 lifespan 啟動、過了提醒時間啟動時補做、例外不中止（設計：排程在 lifespan，啟動時補做）；驗證：`next_run` 單元測試通過，app 啟動 log 顯示排程

## 2. 個別關閉提醒

- [x] 2.1 [after: 1.1] Requirement「Reminders per item」API：看板 `remind` 欄位、`POST /api/actions/{id}/remind`（負責人或管理員，否則 403／404）、看板與紀要頁換負責人時恢復提醒；驗證：`ActionReminderTests` 的切換權限與換負責人測試通過，全部單元測試不退步
- [x] 2.2 [after: 2.1] 看板詳細面板「Email 提醒」欄與按鈕、卡片 🔕 標示、我的 Email 說明提到提醒；驗證：`bench/reminders_e2e.mjs` 的看板檢查與截圖通過

## 3. 文件與端到端

- [x] 3.1 compose 與 `.env.example` 增加 `REMIND_AT`；README 新增待辦提醒說明、設定與端點；驗證：內容檢視
- [x] 3.2 [after: 1.3, 2.2, 3.1] 端到端 `bench/reminders_e2e.mjs`：以 CLI 指定日期執行，在 Mailpit 收到一封合併提醒、主旨與分組正確、同日重跑不再寄、關閉提醒後不寄；測試資料事後清除；驗證：腳本輸出 all ok
