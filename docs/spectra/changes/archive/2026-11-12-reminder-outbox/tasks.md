## 1. 資料與佔位

- [x] 1.1 依「佔位與寄出分成兩個欄位」新增 `webapp/migrations/016_reminder_claims.sql`：`sent_at` 改為可為空、新增 `claimed_at`（既有列以 `sent_at` 回填）。驗證：重啟 app 後 migration 套用成功（`schema_migrations` 有 016），`\d reminder_log` 顯示兩個欄位；`test_server` 全部通過。
- [x] 1.2 [after: 1.1] 並依「排程也接手手動執行留下的佔位」處理被殺掉的手動執行與沒人接手的逾時佔位； 依「逾時 10 分鐘的佔位可被接手」與「寄出後才寫入 sent_at，pending 也觸發重試」修改 `webapp/reminders.py`：`claim()` 可接手逾時佔位並區分 pending、寄出成功後寫入 `sent_at`、`run()` 回傳 `pending`、`worker()` 在 `failed` 或 `pending` 時排 30 分鐘後重試，實現 Reminder timing 規格的「A killed run is recovered」情境。驗證：`ActionReminderTests` 新增被殺掉的執行測試與「claims seen by a later run」範例逐列斷言、已寄出不重寄測試、worker 在 pending 時設定重試的測試；以 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過。
