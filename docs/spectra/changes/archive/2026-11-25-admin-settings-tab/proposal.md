## Why

團隊管理頁（`/admin`）最上面放著「即時口譯權限」和「紀錄保存期限」兩張整列寬的卡片。它們和團隊無關，內容又很少（保存期限只有一個數字欄位，卻佔一整列），把這頁真正的內容（團隊與成員）擠到畫面下方，版面看起來不協調。使用者（2026-11-25）選擇把這兩項搬到新的「系統設定」分頁。

## What Changes

- 管理區多一個分頁「系統設定」（`/admin/settings`，只開放系統管理員）。分頁列變成：團隊管理｜用量管理｜系統設定。
- 「紀錄保存期限」與「即時口譯權限」從團隊管理頁搬到系統設定頁，放在同一張卡裡，一項設定一列：左邊是名稱與說明，右邊是控制項。功能、API 與文字不變。
- 團隊管理頁只剩「建立新團隊」與團隊列表。
- 頂端列的「管理」在 `/admin/settings` 也標示為目前頁。

## Non-Goals (optional)

- 不改這兩項設定的行為、API 與資料。
- 不把其他設定（寄信、用量上限等）搬進系統設定頁。
- 不改團隊卡片本身的樣式。

## Capabilities

### New Capabilities

- `system-settings`: 系統設定頁：全系統設定集中在一頁，一項一列。

### Modified Capabilities

- `realtime-interpret`: 即時口譯權限與紀錄保存期限改在系統設定頁顯示。
- `site-navigation`: 管理區分頁列變成三個連結，`/admin/settings` 也算「管理」。

## Impact

- 新增：webapp/static/settings.html、webapp/static/settings.js
- 修改：webapp/team_access.py（新頁的路由）、webapp/static/admin.html、webapp/static/admin.css、webapp/static/usage.html、webapp/static/account.js、webapp/test_server.py、各頁 HTML 的版本參數
- 修改瀏覽器測試：bench/usage_admin_e2e.mjs、bench/ui_consistency_e2e.mjs、bench/interpret_e2e.mjs
- README.md 提到這兩項設定位置的句子
