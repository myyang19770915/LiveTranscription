## Context

`meetings` 已有 `team_id`、`created_by`、`started_at` 等欄位，`GET /api/meetings`（`webapp/team_access.py` 的 `list_meetings`）依使用者所屬團隊列出最新 500 筆，`GET /api/meetings/{id}`（`get_meeting`）回傳單場會議與段落，非成員一律 404（`require_member`）。主頁的團隊選單在 `#teamRow`，開始會議時 `createMeeting()` 以 `POST /api/meetings` 建立會議。列表頁 `meetings.html` 依時間排序，校對頁 `review.js` 標題顯示「YYYY/MM/DD HH:mm 的會議」。

## Goals / Non-Goals

**Goals:**

- 會議主題：建立時選填、預設顯示、會後修改
- 會議紀錄列表的團隊、日期、建立者、主題關鍵字篩選，以及依日期分組
- 校對頁返回列表

**Non-Goals:**

- 系列會議、帶出上次未完成事項（roadmap P3）
- 逐字稿全文搜尋、語意搜尋（roadmap P4）
- 標籤
- 主題修改的歷程（使用者決定不需要）

## Decisions

### 主題存在 meetings.title

`webapp/migrations/003_topics.sql` 新增 `meetings.title text NOT NULL DEFAULT ''`。空字串代表沒有主題，顯示時由前端組成「MM/DD HH:mm 的會議」（使用瀏覽器的當地時間），不把預設文字寫進資料庫，之後改時區或格式不必回填。

替代方案：建立時把預設文字寫入 title。搜尋「的會議」會命中所有沒主題的會議，且改格式要回填，不採用。

### 篩選在伺服器端以查詢參數完成

`GET /api/meetings?team=&from=&to=&creator=&q=`，全部選填。`team` 不是使用者的團隊時回 404；日期以 `MEETING_TIMEZONE`（與 ASR 匯出相同）換算當地日期；`q` 以 `ILIKE '%…%'` 比對 title（`%`、`_`、`\` 先跳脫）。條件套用後才取最新 500 筆。

替代方案：前端過濾已載入的 500 筆。超過 500 筆時舊會議永遠找不到，不採用。

### 建立者選單另有端點

`GET /api/meetings/creators` 回傳使用者所屬團隊中建立過會議的帳號與顯示名稱。不從目前列表推導，因為篩選後的列表會讓選單自己縮小。

### 修改主題用 PATCH

`PATCH /api/meetings/{id} {title}`，經 `require_member`，回傳更新後的會議摘要；不寫歷程（使用者 2026-11-05 決定）。

### 分組在前端完成

今天／本週（週一起算）／更早依瀏覽器當地時間判斷；伺服器只負責排序與篩選。篩選條件寫進網址查詢字串，重新整理或從校對頁返回時保留。

## Implementation Contract

**可觀察的行為：**

- 主頁「團隊」旁新增「主題」輸入框（選填、最多 100 字），會議進行中停用；開始會議時連同團隊送出。
- `POST /api/meetings` 接受 `title`（選填，去除前後空白，超過 100 字 422）。
- `GET /api/meetings` 每筆多回傳 `title`；接受 `team`、`from`、`to`（`YYYY-MM-DD`）、`creator`、`q`。
- `GET /api/meetings/creators` → `[{username, displayName}]`。
- `PATCH /api/meetings/{id}` → 200 新主題；非成員 404；超過 100 字 422。
- 列表頁：篩選列（團隊、從、到、建立者、關鍵字、清除），結果依今天／本週／更早分組，每場以主題（或預設顯示）為標題；沒有符合的會議時顯示「沒有符合條件的會議」。
- 校對頁：標題為主題或預設顯示，旁邊「修改主題」可就地編輯；標題上方「返回會議紀錄」。

**驗收：**

- `webapp/test_server.py` 新增測試涵蓋 spec 每個 scenario 與兩張範例表（含超過 500 筆時依日期找到最舊月份）。
- 以 Playwright 在真實頁面：開一場帶主題的會議、在列表用關鍵字找到它、在校對頁改主題、按返回回到列表，桌面與 400px 寬度截圖。

**範圍內：** 上述 API、頁面、資料表、測試、README。
**範圍外：** 見 Non-Goals。

## Risks / Trade-offs

- [關鍵字只比對主題，使用者可能以為會搜尋逐字稿] → 搜尋框提示文字寫「搜尋主題」；逐字稿搜尋列在 roadmap P4。
- [「本週」以瀏覽器時區判斷，跨時區團隊看到的分組不同] → 只影響分組標題，不影響篩選結果；接受。

## Migration Plan

app 啟動時套用 `003_topics.sql`；既有會議 title 為空，顯示預設文字。回滾時舊版程式不讀 title，不受影響。
