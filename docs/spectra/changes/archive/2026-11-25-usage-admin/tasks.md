## 1. 伺服器：上限設定與彙總資料

- [x] 1.1 上限存在 app_settings，對累計金額判斷（Budgets are set on the usage page）：`usage_budgets` 沒存過時雲端辨識用 `MAI_BUDGET_USD`、即時口譯為 null；`PUT /api/admin/usage/budgets` 驗證並儲存，非管理員 403，不合格的內容 422 且不改變設定。驗證：`test_server` 新增測試涵蓋規格「bodies and results」表每一列、預設值、移除上限、403。
- [x] 1.2 [after: 1.1] `GET /api/admin/mai-usage` 的 `budgetUsd`、`state` 與記錄檔警告跟著設定走，沒有上限時 `state` 為 `ok` 且不寫警告（Administrators see the accumulated cost against the budget）。驗證：`test_server` 既有 mai-usage 測試全數通過，新增「The budget saved on the usage page」與表格最後一列（無上限）的測試。
- [x] 1.3 [after: 1.1] 用量資料用一支彙總 API（Usage figures for administrators）：`GET /api/admin/usage` 回傳 design.md Implementation Contract 的形狀。驗證：`test_server` 新增測試，用固定的「今天 2026-11-25」重現規格「Usage in this month and the month before」的每個數字、「No usage at all」、非管理員 403，以及規格「state against the budget」表。
- [x] 1.4 [after: 1.3] `/admin/usage` 只給系統管理員，其他人得到 403 頁「管理頁面只開放給系統管理員。」；`/admin` 的 403 頁用同一句。驗證：`test_server` 新增測試（成員 403 與文字、管理員 200），既有 `/admin` 403 測試通過。

## 2. 頁面

- [x] 2.1 管理區是兩個網址加一列分頁連結（The administration pages share section tabs；Hidden header links stay reachable on narrow screens；Every page shows the same header in the same place）：頂端列連結改名「管理」並在 `/admin`、`/admin/usage` 都標示；團隊管理頁標題上方有「團隊管理｜用量管理」分頁列。驗證：`bench/usage_admin_e2e.mjs` 檢查兩頁分頁列的文字、`aria-current`、位置差不超過 1px、高度至少 44px、鍵盤可聚焦，以及頂端列在兩頁都標示「管理」。
- [x] 2.2 [after: 2.1] 團隊管理頁移除「雲端辨識用量」「即時口譯用量」兩張卡與它們的請求，其餘卡片不變（Translation cost is recorded for administrators 的「The team administration page」情境）。驗證：`bench/usage_admin_e2e.mjs` 確認 `/admin` 沒有這兩張卡、沒有請求 `/api/admin/mai-usage` 與 `/api/admin/interpret-usage`，即時口譯權限、紀錄保存期限、建立團隊仍在。
- [x] 2.3 [after: 1.3, 2.1] 用量管理頁（Usage management page），視覺沿用成效指標頁的元件：說明文字、上限提示、四張數字卡、兩張上限卡（進度條、狀態圖示加文字、上限欄位與儲存）、每月表、依用途表、依使用者表；讀取失敗與儲存失敗的訊息。驗證：`bench/usage_admin_e2e.mjs` 以攔截的 API 回應檢查規格情境「Figures of the month」「A service near its budget」「A service over its budget」「Saving a budget」「Saving is refused」「The figures cannot be read」「A phone」，並確認沒有頁面錯誤。
- [x] 2.4 [after: 2.3] 每日估算金額圖：近 30 天堆疊長條、圖例、滑鼠與鍵盤顯示當日數字、「表格」切換、沒有用量時的文字。系列色先用 dataviz 的 `validate_palette.js` 對深色 `#17181b` 與淺色 `#ffffff` 檢查並通過。驗證：`bench/usage_admin_e2e.mjs` 檢查情境「The daily chart as a table」「A day from the keyboard」「No usage in the last 30 days」；驗證器輸出記在 evidence.md。

## 3. 收尾

- [x] 3.1 [after: 2.2] 既有瀏覽器測試跟著改名：`bench/ui_review_e2e.mjs`、`bench/ui_consistency_e2e.mjs` 裡的連結文字改成「管理」，刪除 `bench/mai_usage_e2e.mjs`。驗證：兩支測試的失敗項目與修改前的 HEAD 相同（只有先前就失敗的項目）。
- [x] 3.2 [after: 2.4, 3.1] 全部檢查與實機畫面：`test_server` 全數通過；`node bench/checks.js` 與修改前相同；`bench/usage_admin_e2e.mjs` 全數通過；用真實資料開 `/admin/usage`，在 1440px 與 390px、深色與淺色各截一張圖檢查版面。結果記在 evidence.md。
