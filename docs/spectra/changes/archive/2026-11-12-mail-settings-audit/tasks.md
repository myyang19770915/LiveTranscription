## 1. 紀錄與顯示

- [x] 1.1 新增 `webapp/migrations/017_mail_setting_changes.sql`（`team_mail_changes`：團隊、時間、修改者、是否成員、修改前後的對象／地址／自動寄送），`webapp/mailer.py` 的 `change_settings` 在設定實際變動時寫入一筆，`mail_state` 回傳 `lastChange`（時間、修改者顯示名稱、是否成員、修改後設定），實現 Mail settings changes are recorded。驗證：`test_server` 逐列斷言規格「what is recorded」範例（含未變動不記錄、非成員管理員的 `member` 為 false）；以 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過。
- [x] 1.2 [after: 1.1] `webapp/static/minutes.js` 的寄送區塊顯示最近一次修改；修改者不是成員時以警示樣式顯示並寫出新設定，`minutes.html` 更新 `minutes.js` 的快取版本號。驗證：新增 `bench/mailchangecheck.js`，取出 `minutes.js` 的訊息組字函式，斷言規格兩個情境的文字（成員一般樣式、非成員警示樣式與新設定），失敗時以非 0 結束。
