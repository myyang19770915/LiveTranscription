## 1. 產生紀要

- [x] 1.1 紀要資料表：新增 webapp/migrations/004_minutes.sql 建立 `minutes` 與 `minute_items`（含預留的 `status`、`external_ref`）。驗證：`test_migrations_apply_once` 確認兩張表存在且版本只套用一次
- [x] 1.2 Items carry evidence 與 Owners and due dates，驗證與對應在伺服器端：webapp/minutes.py 的純函式——組提示（整場「[seq] 原文」、會議日期與星期、主題、成員）、解析模型 JSON、證據過濾、去重合併、負責人與到期日對應。驗證：test_server 以 spec 三張範例表逐列測試，另測提示包含全部段落且沒有分段 [after: 1.1]
- [x] 1.3 Generating minutes，整場一次送給可設定的紀要模型、背景工作在程式內執行：`MINUTES_URL`／`MINUTES_MODEL`／`MINUTES_KEY`（未設定沿用 `TRANSLATE_REFINE_*`，compose 傳入），`POST /api/meetings/{id}/minutes/generate` 與 `GET /api/meetings/{id}/minutes`，搶佔式啟動（409）、失敗保留條目、模型未設定 400、沒有段落 422、app 啟動時把殘留 running 改為 failed，以 `response_format: json_object` 呼叫。驗證：以假模型 `minutes.call_model` 測 spec 四個 scenario [after: 1.2]
- [x] 1.4 Regenerating keeps human decisions，重新產生只動待確認的 AI 條目：產生完成時只替換 proposed 的 AI 條目、跳過與保留條目相同內容者、摘要未被編輯才覆寫。驗證：test_server「Second generation」與「已編輯摘要不被覆寫」[after: 1.3]

## 2. 確認與匯出

- [x] 2.1 Human confirmation，紀要 API：條目修改、確認、駁回、手動新增、摘要編輯，皆以版本號偵測（409 回傳目前值），負責人必須是團隊成員（422），條目必須屬於該會議（404）。驗證：test_server 涵蓋三個 scenario 與手動新增為已確認 [after: 1.3]
- [x] 2.2 Exporting minutes：`GET /api/meetings/{id}/minutes.md` 輸出主題、日期、團隊、摘要與已確認條目（待辦附負責人顯示名稱或未指派、到期日，證據為 mm:ss）。驗證：test_server「Only confirmed items」逐行比對 [after: 2.1]
- [x] 2.3 Only team members use minutes：所有紀要 API 以 `require_member` 檢查，非成員 404 且不啟動、不變更。驗證：test_server 逐一列出每個紀要 API 對非成員回 404，資料庫無變化 [after: 2.1]

## 3. 頁面與實測

- [x] 3.1 紀要頁：`/meetings/{id}/minutes` 依 design「紀要頁」一節實作（產生與狀態、外部服務提示、摘要編輯、四類條目的修改／確認／駁回、負責人選單與模型提示名字、到期日與原話、新增條目、下載 Markdown），409 時顯示訊息並重新載入。驗證：Playwright 在真實頁面完成產生、改負責人並確認、駁回、新增、下載 Markdown，桌面與 400px 截圖無水平捲動 [after: 2.2]
- [x] 3.2 入口與證據連結：會議紀錄列表與校對頁加上「紀要」入口；證據時間點連到校對頁 `#seg-N`，校對頁載入後捲到並展開該段（不自動播放）。驗證：Playwright 從紀要頁點證據，校對頁該段為展開狀態 [after: 3.1]
- [x] 3.3 真實模型實測：以目前的紀要模型（雲端 deepseek）對資料庫中一場已校對的會議產生紀要，記錄提示長度、耗時、條目數、捨棄數與內容觀察，並依實測調整頁面上的耗時提示。驗證：任務完成說明附上實測數據 [after: 1.4]
  - 實測（2026-11-05，deepseek-v4-flash）：以 15 段的「產品週會（測試資料）」產生；提示 1,104 字（含系統提示），約 9 秒完成；8 條（決議 2、待辦 3、待確認問題 2、風險 1），捨棄 0 條，每條都有證據。到期日換算正確（11/04 週三的「下週五」→ 11/13、「這週內」→ 11/08）；「bob」「小王」不是研發部成員，正確標為未指派並保留提示名字。重新產生時，已確認與已駁回的條目保留，只新增 7 條待確認。頁面耗時提示定為「數秒到一分鐘」。

## 4. 文件

- [x] 4.1 文件：README.md 新增「會議紀要」使用說明與 API，docs/roadmap.md 將 P2 標為完成並註明 P3 承接 `status`／`external_ref`。驗證：內容檢查，路徑與實作一致 [after: 3.2, 3.3]
