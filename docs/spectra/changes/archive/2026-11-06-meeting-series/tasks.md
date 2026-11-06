## 1. 系列

- [x] 1.1 系列資料表：新增 `webapp/migrations/006_series.sql`（`meeting_series`、`meetings.series_id`、`progress_suggestions` 與唯一限制）。驗證：`test_server` 遷移測試確認三者存在、同團隊同名（不分大小寫）被唯一限制擋下
- [x] 1.2 Team series，依「系列 API 與會議的系列」：`GET|POST /api/teams/{teamId}/series`，同名回既有（200）、新建 201、名稱驗證 422、非成員 404。驗證：`test_server` 涵蓋範例表「series names in team 研發部」五列與「Another team's series」[after: 1.1]
- [x] 1.3 Choosing a series for a meeting（後端）：`POST /api/meetings` 接受 `series_id`；`PATCH /api/meetings/{id}` 改為部分更新 `title`／`series_id`；他團隊系列 422；`GET /api/meetings`、`GET /api/meetings/{id}` 回傳 `seriesId`、`series`。驗證：`test_server`「Starting a meeting in a series」「Series of another team」（建立與修改皆 422 且不變）「Clearing the series」（主題不變），既有修改主題測試維持通過 [after: 1.2]
- [x] 1.4 Unfinished actions before the meeting（後端），依「會前帶出未完成事項」：`GET /api/series/{seriesId}/actions?exclude=` 只回傳同系列其他會議已確認、未完成的待辦，排序同看板；非成員 404。驗證：`test_server` 涵蓋範例表「series 研發週會 before the 11/13 meeting」六列（以固定今天 2026-11-13）[after: 1.3]

## 2. 主頁與會議頁

- [x] 2.1 主頁系列選單與未完成清單，依「會前帶出未完成事項」：「主題」旁的系列選單（不屬於系列／系列／＋ 新增系列…就地輸入）、依團隊記住選擇、建立會議帶 `series_id`；選了系列時面板列出未完成待辦（內容、負責人、到期、逾期紅字），會議中持續顯示，沒有時顯示「這個系列沒有未完成的待辦」。驗證：`bench/series_e2e.mjs` 新增系列、面板列出待辦、開會後該會議屬於該系列；400px 無水平捲動 [after: 1.4]
- [x] 2.2 顯示與修改系列，依「顯示系列」：會議列表團隊標籤旁顯示系列；會議頁標頭團隊標籤為「團隊 · 系列」；校對頁「修改主題」表單加系列選單。驗證：`bench/series_e2e.mjs` 列表與標頭顯示系列、校對頁改成「不屬於系列」後標頭不再顯示；`bench/minutes_e2e.mjs` 標頭檢查維持通過 [after: 1.3]

## 3. 會中進度偵測

- [x] 3.1 Detecting progress during the meeting（後端），依「會中進度偵測」：`POST /api/meetings/{id}/progress/check` 讀新段落與同系列未完成待辦、行程內鎖、以紀要模型（逾時 60 秒）取得更新並驗證、去重；不呼叫模型的三種情況；模型失敗回 `error` 且不前進。驗證：`test_server` 以假模型涵蓋範例表「unfinished items #11 (todo) and #12 (doing)」六列、「Nothing to check」（模型未被呼叫）、「Model failure」（`checkedThrough` 不前進、下次重送）、模型未設定 400 [after: 1.4]
- [x] 3.2 Applying a suggestion（後端），依「套用與略過提示」：`accept`／`dismiss`／`GET …/progress`，`actions.apply_status` 與狀態 API 共用，歷程寫入 `meeting_id` 與 `evidence`。驗證：`test_server`「Applying during the meeting」（歷程含會議與證據 33）、待辦已是該狀態時只標記、「Handled twice」409、待辦被駁回後 409、非成員 404、略過後同一狀態不再產生；既有 `ActionTrackingTests` 維持通過 [after: 3.1]
- [x] 3.3 Opting in to progress detection 與主頁提示：勾選框（模型未設定或沒選系列時不顯示、預設關閉、記在瀏覽器、註明會傳送到外部服務）；會議中段落存檔後依門檻（3 段、45 秒、同時一個）呼叫偵測、會議結束再呼叫一次；提示顯示在對應待辦下（建議狀態、說明、證據原文與時間、套用、略過），套用後清單更新；偵測失敗顯示一行訊息。驗證：`bench/series_e2e.mjs` 以 `page.route` 回應假的偵測結果：預設未勾選、勾選後重新整理仍保留、提示出現、套用後看板該待辦變成已完成、略過後提示消失 [after: 2.1, 3.2]
- [x] 3.4 紀要頁處理剩下的提示：有待處理提示時在摘要下方顯示「會中進度提示（N）」區塊，可套用、略過、點證據開側欄；全部處理完不顯示。驗證：`bench/series_e2e.mjs`「Left for after the meeting」兩則提示出現在紀要頁並可處理 [after: 3.2]

## 4. 文件

- [x] 4.1 README.md 新增「系列會議與進度提示」段落與 API 表；bench/README.md 列出 `series_e2e.mjs`；docs/roadmap.md 更新 P3 狀態。驗證：內容檢查，名稱與實作一致；`python -m unittest test_server`、`bench/*check.js`、`bench/actions_e2e.mjs`、`bench/minutes_e2e.mjs` 全數通過 [after: 2.2, 3.3, 3.4]
