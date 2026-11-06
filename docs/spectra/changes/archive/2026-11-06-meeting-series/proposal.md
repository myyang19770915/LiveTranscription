## Why

`action-tracking` 讓待辦可以追蹤，但追蹤仍要靠人記得去看板更新。例行會議（週會、專案會）本來就是回報進度的場合：開會前該先看到上次還沒完成的事，會議中有人說「報表上週交了」時，系統應該能提醒把對應待辦標成完成。這是 roadmap P3 閉環的最後一段：會前帶出、會中偵測、會後追蹤。

使用者決定：系列由開會前選擇（不依主題自動歸類）；進度偵測做在會議中即時提示，由人確認後才更新狀態。

## What Changes

- **系列會議**：每個團隊可以有多個系列（例如「研發週會」）。開會前在主頁「主題」旁選擇系列，或當場新增；名稱在團隊內不分大小寫唯一。之後可在逐字稿校對頁修改主題時一併修改系列。會議列表與會議頁標頭在團隊旁顯示系列名稱。
- **會前帶出未完成事項**：主頁選了系列後，立即列出這個系列之前會議中已確認、未完成（未開始、進行中）的待辦，含負責人、到期日與逾期天數；會議進行中這份清單持續顯示。
- **會中進度提示**（選用，預設關閉、記在瀏覽器）：開啟後，會議進行中每累積幾段新的定稿段落，伺服器把新段落與這些待辦一起送給紀要模型（`MINUTES_*`），找出被提到進度的待辦，產生提示（可能進行中／已完成／已取消，附一句說明與證據段落）。提示顯示在對應待辦旁，按「套用」才更新狀態並寫入狀態歷程（記錄是哪場會議、哪些段落），按「略過」則不再提示。模型輸出一律驗證：只能針對清單中的待辦、狀態必須不同、證據必須是這場會議剛送出的段落、取消必須有說明。
- **會後處理提示**：會議中沒處理的提示，會出現在該場會議的紀要頁，可以補套用或略過。

## Non-Goals

- 依主題自動歸類系列、系列改名或刪除、系列的週期排程。
- 沒有選系列的會議不做進度偵測（偵測範圍是同系列之前的待辦）。
- 自動套用進度、不經人確認。
- 用本機翻譯模型做偵測（會議中它正在即時翻譯）。
- 決議、問題、風險的進度。

## Capabilities

### New Capabilities

- `meeting-series`：團隊的系列會議、開會前選擇與修改、會前帶出同系列未完成的待辦。
- `progress-detection`：會議中把新段落與同系列未完成的待辦比對，產生需人確認的進度提示，套用後寫入狀態歷程；會後在紀要頁處理剩下的提示。

### Modified Capabilities

（無）

## Impact

- 資料庫：`webapp/migrations/006_series.sql`（`meeting_series`、`meetings.series_id`、`progress_suggestions`）
- 後端：`webapp/series.py`（新增：系列 API、未完成待辦、進度偵測與提示處理）、`webapp/team_access.py`（建立與修改會議接受系列、會議回傳系列）、`webapp/minutes.py`（`call_model` 可指定逾時）、`webapp/actions.py`（狀態變更共用函式）、`webapp/server.py`
- 前端：`webapp/static/index.html`、`webapp/static/app.js`、`webapp/static/series.js`（新增，主頁系列選單、未完成清單、會中提示）、`webapp/static/series.css`（新增）、`webapp/static/review.html`、`webapp/static/review.js`、`webapp/static/meeting-nav.js`、`webapp/static/meetings.html`、`webapp/static/minutes.html`、`webapp/static/minutes.js`、`webapp/static/minutes.css`；`webapp/static/actions.html` 只更新資源版本號
- 測試與文件：`webapp/test_server.py`、`bench/series_e2e.mjs`（新增）、`README.md`、`bench/README.md`、`docs/roadmap.md`
