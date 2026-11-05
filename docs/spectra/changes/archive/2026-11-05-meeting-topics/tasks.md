## 1. 主題

- [x] 1.1 主題存在 meetings.title 與 Meeting topic：新增 webapp/migrations/003_topics.sql；`POST /api/meetings` 接受選填 `title`（去除前後空白、超過 100 字 422），`GET /api/meetings` 與 `GET /api/meetings/{id}` 回傳 `title`。驗證：test_server 涵蓋 spec 範例表三列（含 422 不建立會議），`test_migrations_apply_once` 確認 title 欄位存在
- [x] 1.2 主頁主題欄位：`#teamRow` 旁新增「主題」輸入框（最多 100 字、會議中停用、行動版設定視窗內也看得到），`createMeeting()` 一併送出。驗證：以 Playwright 帶主題「週會」開一場會議，資料庫該會議 title 為「週會」[after: 1.1]
- [x] 1.3 Changing a topic，修改主題用 PATCH：`PATCH /api/meetings/{id}` 由團隊成員修改（非成員 404、不變更），校對頁標題顯示主題或「MM/DD HH:mm 的會議」，旁邊「修改主題」可就地編輯與清除。驗證：test_server 涵蓋「Member renames」「Member of another team」，Playwright 在校對頁改主題後列表顯示新主題 [after: 1.1]

## 2. 篩選與分組

- [x] 2.1 Filtering and searching the meeting list，篩選在伺服器端以查詢參數完成：`GET /api/meetings` 接受 `team`、`from`、`to`、`creator`、`q`（關鍵字跳脫 `%`、`_`、`\`，不分大小寫），條件套用後才取 500 筆，非所屬團隊 404。驗證：test_server 涵蓋「Keyword」、範例表四列、「Older meetings beyond the limit」（建立 510 場會議，依最舊月份篩選仍找得到）、關鍵字含 `%` 不會比對全部 [after: 1.1]
- [x] 2.2 Creator choices，建立者選單另有端點：`GET /api/meetings/creators` 只列出使用者所屬團隊的建立者與顯示名稱。驗證：test_server「Creators of other teams stay hidden」[after: 2.1]
- [x] 2.3 Grouping by start date，分組在前端完成：列表頁新增篩選列（團隊、從、到、建立者、關鍵字、清除），條件寫入網址查詢字串；結果依今天／本週（週一起算）／更早分組、以主題為標題，空組不顯示，無結果顯示「沒有符合條件的會議」。分組函式抽成可在 node 執行的模組。驗證：node 檢查 spec「Three groups」（以 2026-11-04 週三為今天）與週一邊界；Playwright 以關鍵字找到 1.2 的會議，桌面與 400px 截圖無水平捲動 [after: 2.2]

## 3. 返回與文件

- [x] 3.1 Returning from the review page：校對頁「返回會議紀錄」從列表進入時回到上一頁（篩選條件保留），直接開啟時前往 `/meetings`。驗證：Playwright 兩種進入方式都回到 `/meetings`，且從篩選後的列表進入時返回仍保留查詢字串 [after: 2.3]
- [x] 3.2 文件：README.md「會後校對」補上主題與篩選的說明，API 表新增 `PATCH /api/meetings/{id}`、`GET /api/meetings/creators` 與列表查詢參數。驗證：內容檢查，路徑與參數名稱與實作一致 [after: 3.1]
