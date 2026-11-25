## Why

雲端辨識（音訊送到外部服務，按音訊長度計費）與即時口譯（按譯音長度計費）的用量已經記在資料庫，但只在團隊管理頁用兩段文字顯示累計數字：看不到本月花了多少、哪一天用得多、誰在用，上限也只能改主機設定後重啟。管理者要求把付費服務的用量與金額集中在一頁監控與管理。

## What Changes

- 頂端列的連結「團隊管理」改名為「管理」。管理區有兩個分頁，各有自己的網址：「團隊管理」（`/admin`）與「用量管理」（`/admin/usage`，新頁）。兩頁標題下方都有同一列分頁連結。
- 團隊管理頁移除「雲端辨識用量」與「即時口譯用量」兩張卡；其餘（即時口譯權限、紀錄保存期限、團隊與成員）不變。
- 新的用量管理頁（只開放系統管理員）顯示兩個付費服務：
  - 四個數字：本月合計金額、雲端辨識本月、即時口譯本月、累計合計。
  - 每個服務一張上限卡：累計金額對上限的進度、狀態（正常／接近上限／已達上限）、可直接修改上限；即時口譯可以不設上限。
  - 近 30 天每日估算金額的長條圖（兩個服務堆疊），可切換成表格。
  - 最近 6 個月每月時數與金額的表格。
  - 依用途的表格，以及即時口譯依使用者的表格。
- 新 API：`GET /api/admin/usage`（上述全部數字）、`PUT /api/admin/usage/budgets`（設定兩個服務的上限）。上限存在 `app_settings`，沒設定過時雲端辨識沿用 `MAI_BUDGET_USD`、即時口譯為不設上限。
- `GET /api/admin/mai-usage` 的 `budgetUsd` 與 `state`、以及記錄檔的上限警告，改用頁面上設定的上限。
- 達到上限仍然只警告、不停用任何功能（沿用 mai-usage 的決定）。

## Non-Goals (optional)

（見 design.md 的 Goals / Non-Goals。）

## Capabilities

### New Capabilities

- `usage-admin`: 用量管理頁、它的資料 API、在頁面上設定各付費服務的金額上限。

### Modified Capabilities

- `mai-usage`: 上限改為可在用量管理頁設定（`MAI_BUDGET_USD` 變成預設值），數字改在用量管理頁顯示。
- `realtime-interpret`: 即時口譯用量改在用量管理頁顯示，可設定上限（只警告）。
- `site-navigation`: 頂端列連結「團隊管理」改名「管理」，`/admin/usage` 也標示這個連結；管理區兩頁有相同的分頁列。

## Impact

- 新增：webapp/usage_admin.py、webapp/static/usage.html、webapp/static/usage.js、webapp/static/usage.css、bench/usage_admin_e2e.mjs
- 修改：webapp/mai_usage.py、webapp/server.py、webapp/team_access.py、webapp/static/admin.html、webapp/static/admin.css、webapp/static/account.js、webapp/test_server.py、各頁 HTML 的 account.js 版本參數
- 修改既有瀏覽器測試裡的連結文字「團隊管理」→「管理」：bench/ui_review_e2e.mjs、bench/ui_consistency_e2e.mjs
- 刪除：bench/mai_usage_e2e.mjs（它檢查的卡片移除了，由 bench/usage_admin_e2e.mjs 取代）
- 不需要資料庫 migration（`app_settings`、`mai_usage`、`interpret_usage` 都已存在）
