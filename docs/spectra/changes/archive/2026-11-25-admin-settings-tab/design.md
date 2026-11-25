## Context

- `/admin`（admin.html）目前由上到下是：分頁列、標題、即時口譯權限卡、紀錄保存期限卡、建立新團隊卡、團隊卡片格（半寬）。兩張設定卡的程式寫在 admin.html 的 inline script 裡，用到同一段 script 的 `el`、`call`、`act`、`confirmButton`、`showError`。
- 分頁列 `.section-tabs` 的樣式在 admin.css，usage-admin（2026-11-25，尚未提交）剛加入；頂端列由 account.js 的 `currentNav()` 決定標示哪個連結。
- 兩項設定的 API（`/api/admin/interpret-access`、`/api/admin/records-retention`）不變。

## Goals / Non-Goals

**Goals:**

- 團隊管理頁一進來就是團隊。
- 兩項全系統的設定放在自己的分頁，版面和內容量相稱。

**Non-Goals:**

- 不改設定的行為、API、資料與文字。
- 不搬其他設定；不改團隊卡片。

## Decisions

### 系統設定是第三個分頁，有自己的網址

`/admin/settings` 由 team_access.py 提供（和 `/admin` 相同的管理員檢查與 403 頁），頁面檔是 settings.html，程式在 settings.js。分頁列在三頁的 HTML 各寫一份（三個連結），`aria-current` 標在本頁。account.js 的 `currentNav()` 改成「路徑以 `/admin/` 開頭就算管理」，以後再加分頁不用再改。

- 捨棄：放右側窄欄（這頁仍混著和團隊無關的設定）、移到團隊下方（團隊多時要捲很遠）。使用者在三個方案中選了這個。

### 一張卡、一項設定一列

卡片 `.settings` 裡每項設定是一個 `<section class="setting">`：寬於 760px 時是兩欄格線，左欄（固定 280px）放名稱 `h2` 與說明，右欄放控制項；760px 以下改成上下排列。列與列之間用一條分隔線。順序：紀錄保存期限（短的在上）、即時口譯權限（有名單，長度會變，放下面）。

- 元素的 id 全部沿用（`#retention`、`#retentionForm`、`#retentionDays`、`#retentionNote`、`#interpretAccess`、`#accessList`、`#accessForm`、`#accessName`），既有瀏覽器測試只需要改網址。
- 右欄的寬度上限 640px：帳號欄位不會拉成一整列那麼寬。
- 樣式放 admin.css（三頁都載入它），不另開 CSS 檔。

### 程式搬到 settings.js，小工具各自一份

settings.js 自帶 `el`、`call`、`confirmButton` 這幾個小函式（admin.html 的 inline script 留著自己的，供團隊功能使用）。兩處各約十行，不為此抽共用檔：抽出來要動到團隊管理頁的載入順序，超出這次範圍。

## Implementation Contract

**行為**

- 管理員看到三個分頁；系統設定頁有一張卡、兩列設定，操作方式與原本相同（儲存保存天數、加入帳號、按兩次移除）。
- 團隊管理頁不再出現這兩項，也不再請求它們的 API。
- 非管理員開 `/admin/settings` 得到 403「管理頁面只開放給系統管理員。」
- 請求失敗時在頁面上的 `#settingsError` 顯示原因。

**驗收**

- `test_server`：`/admin/settings` 成員 403、管理員 200。
- `bench/usage_admin_e2e.mjs`：三頁的分頁列（文字、`aria-current`、位置、鍵盤）、頂端列在 `/admin/settings` 標示「管理」、系統設定頁兩列的左右排列與 390px 的上下排列、不橫向捲動、團隊管理頁第一張卡是建立新團隊且不請求兩支 API。
- `bench/ui_consistency_e2e.mjs`（保存期限在卡片內）改開 `/admin/settings` 後通過；`bench/ui_review_e2e.mjs` 的結果不比修改前差。

**範圍**

- 範圍內：新頁、分頁列、搬移兩項設定、頂端列標示。
- 範圍外：見 Non-Goals。

## Risks / Trade-offs

- [習慣在團隊管理頁找這兩項的人找不到] → 分頁列就在標題上方，名稱是「系統設定」。
- [兩份小工具函式重複] → 各約十行；之後若再有管理頁再抽共用檔。
