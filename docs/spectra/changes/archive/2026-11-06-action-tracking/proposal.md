## Why

P2 會議紀要讓決議與待辦有了正式紀錄，但確認之後就停在那裡：沒有人知道待辦做到哪、哪些逾期，也沒有地方一次看到團隊所有的待辦。roadmap P3「追蹤閉環」的第一步，是讓待辦可以追蹤。`minute_items.status` 在 P2 已預留（目前一律 `open`），這次正式啟用。

## What Changes

- **待辦狀態**：已確認的待辦有四種狀態：未開始、進行中、已完成、已取消。同團隊的任何成員都可以更改；改成「已取消」必須填寫原因，其他狀態可附備註。既有的待辦一律視為「未開始」。
- **狀態歷程**：每次狀態變更記一筆（從什麼狀態到什麼狀態、備註、誰、何時），可在待辦上展開查看。資料表預留這次進度是在哪場會議、哪些段落提到的欄位，供下一個變更 `meeting-series` 的會中進度偵測使用。
- **逾期**：到期日早於今天（`MEETING_TIMEZONE` 當地日期），且狀態是未開始或進行中，就是逾期；頁面以紅色標示「逾期 N 天」。逾期不是一種狀態，而是依日期判斷。
- **待辦看板**（`/actions`）：列出使用者所屬團隊所有已確認的待辦，依狀態分成三欄（未開始、進行中、已完成；已取消只在篩選時顯示）。可依團隊、負責人（含「我的」）、到期（全部／逾期／7 天內到期／沒有到期日）、關鍵字篩選，條件寫在網址裡。每張卡片顯示內容、負責人、到期日、來源會議（連到該場的會議紀要），可直接改狀態、看歷程。
- **紀要頁**：已確認的待辦卡片顯示狀態，可在這裡直接改狀態、看歷程。
- **導覽**：每頁頂部列加上「待辦看板」連結。

## Non-Goals

- 系列會議、會前帶出未完成事項、會中進度偵測：由下一個變更 `meeting-series` 處理。
- 決議、問題、風險的狀態追蹤：這次只追蹤待辦。
- 拖曳卡片換欄：以卡片上的狀態選單更改，不做拖曳。
- 通知（Email、即時推播）與外部議題追蹤平台同步：屬於 P5。
- Markdown 匯出格式不變。

## Capabilities

### New Capabilities

- `action-tracking`：已確認待辦的狀態、狀態歷程、逾期判斷與待辦看板。

### Modified Capabilities

（無）

## Impact

- 資料庫：`webapp/migrations/005_actions.sql`（`minute_items.status` 改為四種狀態並加上檢查、狀態備註與最後變更者；新表 `item_updates`）
- 後端：`webapp/actions.py`（新增，看板 API 與頁面、狀態變更、歷程）、`webapp/minutes.py`（條目回傳狀態與逾期）、`webapp/server.py`（掛上路由）
- 前端：`webapp/static/actions.html`、`webapp/static/actions.js`、`webapp/static/actions.css`、`webapp/static/action-status.js`（新增，看板與紀要頁共用的狀態選單）、`webapp/static/minutes.js`、`webapp/static/minutes.css`、`webapp/static/minutes.html`、`webapp/static/account.js`、`webapp/static/admin.css`（頂部列顯示帳號區連結，手機保留待辦看板）；`webapp/static/index.html`、`admin.html`、`meetings.html`、`review.html` 只更新資源版本號
- 測試與文件：`webapp/test_server.py`、`bench/actions_e2e.mjs`（新增）、`README.md`、`bench/README.md`、`docs/roadmap.md`
