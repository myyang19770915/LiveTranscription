## 1. 系統設定頁

- [x] 1.1 系統設定是第三個分頁，有自己的網址（System settings page；The administration pages share section tabs；Every page shows the same header in the same place；Hidden header links stay reachable on narrow screens）：`/admin/settings` 只給系統管理員，三頁的分頁列都是「團隊管理｜用量管理｜系統設定」，頂端列在 `/admin/settings` 標示「管理」。驗證：`test_server` 新增成員 403、管理員 200 的測試；`bench/usage_admin_e2e.mjs` 檢查三頁分頁列的文字、`aria-current`、位置差不超過 1px、Tab 可到三個分頁、頂端列標示。
- [x] 1.2 [after: 1.1] 一張卡、一項設定一列；程式搬到 settings.js，小工具各自一份（Interpreting is open to granted users；Saved records are kept for a set number of days）：系統設定頁顯示紀錄保存期限與即時口譯權限兩列，寬於 760px 時控制項在名稱右邊，760px 以下在說明下方；儲存天數、加入帳號、移除帳號照舊運作；失敗時頁面顯示原因。驗證：`bench/usage_admin_e2e.mjs` 檢查兩列的順序與左右／上下排列、390px 不橫向捲動、以攔截的 API 檢查儲存天數與加入帳號送出的內容。
- [x] 1.3 [after: 1.2] 團隊管理頁只剩建立新團隊與團隊列表，不再請求 `/api/admin/interpret-access` 與 `/api/admin/records-retention`。驗證：`bench/usage_admin_e2e.mjs` 檢查 `/admin` 第一張卡是建立新團隊、沒有這兩項、沒有這兩支請求、沒有頁面錯誤。

## 2. 收尾

- [x] 2.1 [after: 1.3] 既有瀏覽器測試與說明跟著搬：`bench/ui_consistency_e2e.mjs` 的保存期限檢查與 `bench/interpret_e2e.mjs` 的權限、保存期限檢查改開 `/admin/settings`；README.md 提到這兩項位置的句子改成系統設定頁。驗證：`bench/ui_consistency_e2e.mjs` 全數通過；`bench/ui_review_e2e.mjs` 的失敗項目不多於修改前；`test_server` 全數通過；用真實資料在 1440px 與 390px 各截一張系統設定頁與團隊管理頁檢查版面，結果記在 evidence.md。
