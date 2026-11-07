## 1. 資料與 API

- [x] 1.1 新增 webapp/migrations/008_board_items.sql：`minute_items.team_id` 回填並 NOT NULL、`series_id`、`meeting_id` 可空、CHECK 限制沒有會議的列、BEFORE INSERT trigger 自動帶入團隊；webapp/actions.py `action_rows` 改以待辦的 `team_id` 判斷權限並回傳 `origin`、可空的會議欄位、會議或待辦本身的系列；看板 `team` 篩選改用 `i.team_id`；webapp/minutes.py 的項目內容 helper 支援沒有會議的待辦。驗證：既有單元測試全部通過，`ActionMigrationTests` 類測試確認回填。（Board-created action items；設計：待辦帶自己的 team_id，meeting_id 可為空）
- [x] 1.2 webapp/actions.py 新增 `POST /api/actions`、`PATCH /api/actions/{id}`、`POST /api/actions/{id}/status`、`GET /api/actions/{id}/updates`、`DELETE /api/actions/{id}`，權限以待辦團隊判斷、回傳看板列格式 [after: 1.1]。驗證：webapp/test_server.py `BoardItemTests` 涵蓋建立、驗證錯誤（404／422）、改狀態、改內容、歷程、版本衝突 409、刪除看板待辦 204 與會議待辦 409。（設計：以待辦為主的 API，看板統一使用；看板建立的待辦可刪，會議待辦不行）
- [x] 1.3 webapp/series.py 系列未完成事項包含 `series_id` 為該系列的看板待辦，進度提示的套用以待辦團隊判斷、`itemMeetingId` 可為空 [after: 1.1]。驗證：`BoardItemTests` 系列未完成事項包含看板待辦、套用進度提示改變看板待辦狀態並記錄會議。

## 2. 看板前端

- [x] 2.1 webapp/static/action-status.js `control`／`send` 改收待辦網址；webapp/static/minutes.js 傳入紀要網址、進度提示的原待辦連結在沒有會議時改連到看板；webapp/static/board.js 依來源會議分組時看板待辦歸「看板新增」泳道並排最後 [after: 1.2]。驗證：bench/boardcheck.js 新檢查；bench/minutes_e2e.mjs 照常通過。（設計：沒有會議的待辦在各處的顯示）
- [x] 2.2 webapp/static/actions.js、actions.html、actions.css：「＋ 新增待辦」按鈕與 `c` 快捷鍵開啟面板新增模式（內容、團隊、負責人、到期日、系列、建立），看板改用 `/api/actions` 系列 API，面板可編輯內容，看板待辦可刪除（兩次確認），卡片與面板來源顯示看板新增 [after: 2.1]。驗證：bench/actions_e2e.mjs 新增、編輯、刪除的檢查與既有檢查全部通過。

## 3. 文件

- [x] 3.1 README「待辦追蹤」段落與 API 表、bench/README 補上看板新增待辦 [after: 2.2]。驗證：內容檢查。
