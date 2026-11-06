## 1. 資料與狀態

- [x] 1.1 待辦狀態與歷程資料表：新增 `webapp/migrations/005_actions.sql`，既有 `open` 改為 `todo`、狀態限定四種、新增 `status_note`／`status_by`／`status_at` 與 `item_updates` 表及索引。驗證：`test_server` 遷移測試確認既有條目為 `todo`、不合法狀態被資料庫拒絕、`item_updates` 存在
- [x] 1.2 Action item status，依「狀態變更 API」與「逾期在伺服器端判斷」：`POST /api/meetings/{meetingId}/minutes/items/{itemId}/status` 依表格回應並寫入歷程；條目回傳加上 `status`、`statusNote`、`overdueDays`。驗證：`test_server` 涵蓋 spec 範例表「status change rules」七列、「Starting work」（版本 3→4）、「Stale status change」、「Another team」，以及 Overdue action items 範例表「overdue on 2026-11-06」六列（以固定今天測試）[after: 1.1]
- [x] 1.3 Status history：`GET /api/meetings/{meetingId}/minutes/items/{itemId}/updates` 新的在前、含顯示名稱。驗證：`test_server`「Two changes」，非成員 404 [after: 1.2]

## 2. 待辦看板

- [x] 2.1 Action board API，依「待辦看板」：`GET /api/actions` 支援 `team`、`owner`（帳號／me／none）、`status`、`due`（overdue／week／none）、`q`，只回傳所屬團隊已確認的待辦，依逾期天數、到期日排序，附 `teams`、`people`。驗證：`test_server`「Two teams」「My overdue items」、範例表「filtering on 2026-11-06」五列、「Another team's filter」404、關鍵字含 `%` 不會比對全部 [after: 1.2]
- [x] 2.2 看板頁面 `/actions`：篩選列寫入網址、三欄（勾選時加已取消）附數量、卡片顯示負責人／到期／逾期 N 天紅字／來源會議連結、狀態選單（已取消需原因）、歷程；導覽連結依「導覽連結」加到 `account.js`。驗證：新增 `bench/actions_e2e.mjs`：改狀態後卡片換欄、取消未填原因不送出、逾期紅字、篩選後重新整理保留條件、卡片連到紀要頁、400px 無水平捲動 [after: 1.3, 2.1]

## 3. 紀要頁與文件

- [x] 3.1 紀要頁顯示與更改狀態：已確認的待辦卡片有狀態選單、逾期標示、歷程；409 時以回傳條目取代。驗證：`bench/actions_e2e.mjs` 在紀要頁改狀態後看板同步；`bench/minutes_e2e.mjs` 維持通過 [after: 2.2]
- [x] 3.2 文件：README.md 新增「待辦追蹤」段落與 API 表；bench/README.md 列出 `actions_e2e.mjs`；docs/roadmap.md 更新 P3 狀態。驗證：內容檢查，路徑與參數與實作一致；`python -m unittest test_server` 與 `bench/*check.js` 全數通過 [after: 3.1]
