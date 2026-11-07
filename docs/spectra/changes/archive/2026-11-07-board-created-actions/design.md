## Context

`minute_items.meeting_id` 是必填；所有待辦 API 都在 `/api/meetings/{meeting_id}/minutes/items/{id}` 底下，權限由 `team_access.require_member(meeting)` 判斷；看板查詢 `actions.action_rows` 以 `JOIN meetings` 取得團隊；系列的未完成事項 `series.unfinished` 以 `m.series_id` 篩選；`minutes.item_context(conn, meeting)` 以會議取團隊成員與段落時間。`ActionStatus`（action-status.js）以會議網址送狀態。

## Goals / Non-Goals

**Goals:**

- 看板能建立不屬於會議的待辦，並與會議待辦一樣追蹤狀態、歷程、逾期、系列會前帶出與會中提示。
- 看板可修改內容；看板建立的待辦可刪除。

**Non-Goals:**

- 看板建立其他類型、子任務、留言、附件、優先級、事後掛到會議。

## Decisions

### 待辦帶自己的 team_id，meeting_id 可為空

`minute_items` 加 `team_id`（回填自會議後設為 NOT NULL）與 `series_id`；`meeting_id` 改為可空，CHECK 限制沒有會議的列只能是 `kind='action' AND origin='manual' AND state='confirmed'`，且 `series_id` 只用在沒有會議的列。一個 BEFORE INSERT trigger 在 `team_id` 為空時從會議帶入，既有的插入程式（紀要產生、紀要頁手動新增、測試）不用改。替代方案是另開一張 `board_items` 表，但狀態、歷程、進度提示都綁 `minute_items.id`，拆表要複製整套追蹤，不採用。

### 以待辦為主的 API，看板統一使用

新增 `/api/actions/{id}` 系列路由，權限以待辦的 `team_id` 判斷（非成員一律 404），回傳看板的列格式（`action_rows` 同一份查詢）。會議來的待辦也走這組，所以看板只有一種網址；紀要頁維持會議 API，不受影響。`ActionStatus.control/send` 改收待辦網址 `url`，兩邊各自傳入。

### 看板建立的待辦可刪，會議待辦不行

建錯時需要刪除；會議產生的待辦有證據與紀要脈絡，維持用「已取消＋原因」。刪除只對 `meeting_id IS NULL` 的列，團隊成員皆可，`item_updates` 與 `progress_suggestions` 隨之刪除（外鍵 CASCADE）。

### 沒有會議的待辦在各處的顯示

卡片來源「團隊 · 看板新增」（有系列時加「 · 系列」）；依來源會議分組時歸在「看板新增」泳道（排在最後）；面板來源欄顯示「看板新增」；進度提示的「原會議的待辦」連結改到看板 `/actions?item=<id>`。

## Implementation Contract

**API**（全部需登入；以 id 操作時，不是該團隊成員、找不到、或不是已確認的待辦 → 404「找不到這個待辦」；建立時不是該團隊成員 → 404「找不到團隊」）

- `POST /api/actions` `{teamId, content, owner?, dueDate?, seriesId?}` → 201 看板列。`content` 去頭尾空白後 1–`CONTENT_MAX` 字；`owner` 必須是該團隊成員（否則 422 `OWNER_NOT_MEMBER`）；`seriesId` 必須屬於該團隊（否則 422「系列不屬於這個團隊」）。建立者記在 `updated_by`／`confirmed_by`。
- `PATCH /api/actions/{id}` `{version, content?, owner?, dueDate?}` → 看板列；版本不符 409 `{detail, item}`。
- `POST /api/actions/{id}/status` `{version, status, note}` → 看板列；取消需原因、狀態未變 422，這兩條規則與紀要頁的狀態 API 共用同一個 `check_status`。
- `GET /api/actions/{id}/updates` → 與既有歷程 API 相同格式。
- `DELETE /api/actions/{id}` → 204；會議來的待辦 409「會議產生的待辦請改用已取消」。
- `GET /api/actions` 的列：`meetingId`、`meetingTitle`、`startedAt` 在看板新增的待辦為 `null`；`series` 取會議的系列或待辦本身的系列；新增 `origin`。
- 系列的未完成事項與會中進度提示包含 `series_id` 為該系列的看板待辦；套用提示時權限以待辦的團隊判斷。

**前端**

- 面板修改被拒（例如 409 已被他人修改）時，錯誤訊息在面板重畫後仍顯示，正在編輯的內容會重新放回編輯框。
- 看板標頭「＋ 新增待辦」按鈕與 `c` 快捷鍵（焦點不在輸入框時）開啟面板新增模式：內容（textarea，必填）、團隊（預設目前篩選的團隊，否則第一個）、負責人（該團隊成員，預設未指派）、到期日、系列（該團隊的系列，預設不屬於系列）。按「建立」成功後重新載入並開啟新待辦；錯誤顯示在面板內。
- 面板標題旁「編輯」可改內容（textarea，Enter 不換行儲存、Esc 取消）。看板新增的待辦面板底部有「刪除待辦」（按兩次確認）。

**驗收**

- 單元測試 `BoardItemTests`：建立（含系列）後出現在看板、`meetingId` 為 null；非成員團隊 404；負責人非成員 422；系列非該團隊 422；以 `/api/actions/{id}` 改狀態、改內容、讀歷程（會議待辦與看板待辦皆可）；版本不符 409；刪除看板待辦 204、刪除會議待辦 409；系列的未完成事項包含看板待辦；進度提示套用到看板待辦。
- bench/boardcheck.js：依來源會議分組時看板待辦歸在「看板新增」泳道且排最後。
- bench/actions_e2e.mjs：新增待辦（按鈕與 `c`）、出現在未開始欄、來源顯示看板新增、編輯內容、刪除；既有檢查照常通過。

**範圍**：只動待辦看板、待辦 API、系列未完成事項／進度提示的查詢；紀要頁行為不變。

## Risks / Trade-offs

- `meeting_id` 變可空，所有讀 `minute_items` 並假設有會議的查詢都要檢查 → 以 `rg "minute_items"` 逐一檢視；紀要頁只查自己會議的列，不受影響。
- 刪除無法復原 → 只限看板新增的待辦，且需再按一次確認。
