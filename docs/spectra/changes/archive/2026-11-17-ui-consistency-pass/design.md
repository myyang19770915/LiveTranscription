## Context

- 子頁面（`actions`、`admin`、`ask`、`interpret`、`meetings`、`metrics`、`minutes`、`review`、`search`）用 `<header class="topbar">`，樣式在 `webapp/static/admin.css`（`.topbar` 內距 `max(20px, calc((100vw - 1080px) / 2))`，sticky、底線、半透明背景）；右側 `.topbar-actions` 先放一個各頁不同的 `ghost-button`（即時會議／回首頁／會議紀錄），再放 `#account`。
- 首頁的頂端列是 `<main>` 裡的 `<nav>`，樣式在 `webapp/static/styles.css`；`main` 寬 `min(1440px,100%)`、內距 38px。右側有 `#account`、`#status`（服務狀態）、`#saveState`、`#themeToggle`。
- `webapp/static/account.js` 產生 `#account` 的連結：依 `location.pathname` 省略目前頁面，首頁才有「會議紀錄」「我的紀錄」，管理員才有「團隊管理」，搜尋獨立在最前面。
- `webapp/static/themes.css` 只在 `index.html` 載入；淺色主題替 `main` 設 `width: min(1480px, calc(100% - 32px))`、`margin: 16px auto`、`padding: 24px 42px 20px`、外框與圓角，所以切換主題時首頁寬度改變。
- 逐頁檢查（2026-11-17，`scratchpad/audit/probe.txt`）量到：內容左邊緣首頁 82、`/actions` 20、`/metrics` 150、`/meetings`／`/interpret`／`/admin` 200、`/search`／`/ask` 260（1440 寬）；團隊管理頁手機版 760px 寬（`.summary` 的 `white-space: nowrap`）。

## Goals / Non-Goals

**Goals:**

- 每一頁頂端列的連結、順序、位置都相同；目前頁面醒目但不消失。
- 所有頁面共用一個頁寬，內容左右邊緣對齊頂端列。
- 切換主題只改顏色，不改任何元素的大小與位置。
- 即時口譯設定區精簡（不顯示會議情境）。
- 修正逐頁檢查列出的版面問題。

**Non-Goals:**

- 不改功能、API、資料，不改配色與字體。
- 手機版首頁模式按鈕仍在「設定」對話框裡。
- 口譯譯文少空白（hasthe）不在範圍。

## Decisions

### 頁寬 token

`tokens.css` 加 `--page-width: 1280px` 與 `--page-gutter: 24px`（`max-width: 700px` 時 16px）。`.topbar` 內距改為 `max(var(--page-gutter), calc((100vw - var(--page-width)) / 2))`，`.page` 改為 `width: min(var(--page-width), 100%)`、左右內距 `var(--page-gutter)` 且 `box-sizing: border-box`，所以內容左邊緣等於頂端列品牌左邊緣。原本各頁自訂的較窄寬度（`/search`、`/ask` 的 960、`/metrics` 的 1180、`/actions` 的全寬）改用同一個 `.page` 寬度。首頁 `main` 也改為同一個寬度與留白（工作區從 1364 縮到 1232，計算值），頂端列移出 `main`。

替代方案「首頁維持較寬」：頂端列無法同時對齊首頁與子頁，捨棄。

### 共用頂端列

- 新檔 `webapp/static/topbar.css`：從 `admin.css` 搬出 `.topbar`、`.brand`、`.topbar-actions`、`.account` 與連結樣式，所有頁面（含首頁、登入頁）都載入它。按鈕滑過只換底色與框線，不位移（拿掉 `translateY`）。
- `account.js` 的連結固定為：即時會議 `/`、會議紀錄 `/meetings`、我的紀錄 `/interpret`、待辦看板 `/actions`、成效指標 `/metrics`、團隊管理 `/admin`（只有管理員）、搜尋 `/search`；目前頁面加 `aria-current="page"` 與 `.current` 樣式。`/review`、`/minutes` 屬於會議紀錄，標示「會議紀錄」；`/ask` 屬於搜尋，標示「搜尋」。
- 各頁 `.topbar-actions` 裡額外的 `ghost-button` 移除。
- 首頁：`<nav>` 改為 `<header class="topbar">` 放在 `<main>` 之前；`#status`、`#saveState` 移到品牌右邊（`.topbar-status`），右側只剩 `#account` 與 `#themeToggle`，跟子頁相同。
- 手機（≤700px）：頂端列連結照 site-navigation 既有規則收進頭像選單；品牌名稱 `white-space: nowrap`；`#themeToggle` 不得超出畫面（量測 `right <= innerWidth`）。
- 登入頁的主題按鈕改用同一個圓形 `#themeToggle` 樣式（不再顯示「深色」文字）。

### 主題只換顏色

`themes.css` 的淺色 `main` 規則刪除寬度、外距、內距、外框、圓角、陰影，只保留背景色；`max-width: 760px` 內的淺色 `main` 規則一併刪除。檢查方式：同一頁在兩種主題下，`main`、`.topbar`、`.brand`、`#themeToggle` 的 `getBoundingClientRect()` 完全相同。

### 即時口譯設定區

`.controls` 在口譯模式多一個 `interpret` class（`setLiveMode()` 設定）。口譯模式隱藏 `.context-field`，`startMeeting()` 在口譯模式送出的 `system_prompt` 為空字串。`#interpretPlayRow` 放進開始按鈕所在的格子，與開始按鈕同一列；開始按鈕的小字改為「聽譯音、看譯文」。三種模式的空白提示依模式寫「點擊「開始會議／開始翻譯／開始口譯」」。

### 逐頁修正

| 問題（逐頁檢查編號） | 做法 |
| --- | --- |
| 1 團隊管理頁手機橫向捲動 | 卡片裡的 `.summary`（`.create .summary`）一律可換行，只有頁首的計數不換行；`.retention-field` 維持一行（保存、90px 輸入框、天），不套用手機版 `.row .input` 的全寬 |
| 6 待辦看板 | 主要按鈕改用 `--accent`；看板放進 `.page` 寬度 |
| 7 原生下拉與日期欄位 | 子頁的 `select`、`input[type=date]` 用共用 `.input` 樣式加自訂箭頭（`appearance: none` + 背景 SVG），日期欄位的日曆圖示顏色跟隨主題 |
| 8 問答頁 | 送出按鈕高度等於輸入框、底部對齊，文字改「提問」 |
| 9、10 我的紀錄 | 「語言」欄 `white-space: nowrap`；譯文欄空白時顯示「按「載入」顯示紀錄。」 |
| 11 待辦看板手機篩選 | ≤640px：搜尋、人員各占一列，團隊與分組共用一列（兩欄網格）；快速篩選改為單列、可左右滑動，所以不會有落單的分隔線 |
| 14 成效指標卡片 | 卡片文字 `text-wrap: pretty` |

## Implementation Contract

- **行為：** 在 1440 與 390 寬、深淺主題下，每一頁的頂端列連結文字與順序相同（管理員多「團隊管理」），目前頁面有 `aria-current="page"`；`.brand` 與 `#themeToggle` 的位置在所有頁面相同（同寬度下誤差 ≤ 1px）；切換主題前後上述元素與 `main` 的位置大小不變；任何頁面在 390 寬都沒有橫向捲動（`scrollWidth <= innerWidth`）；口譯模式不顯示會議情境、`同步播放譯音` 與開始按鈕同一列。
- **介面：** 無 API 變更。`/ws/transcribe` 在口譯模式的 `system_prompt` 為空字串。
- **失敗情況：** 不適用（只改版面）。
- **驗收：** 新 `bench/ui_consistency_e2e.mjs` 量測上述每一項；`bench/ui_polish_e2e.mjs`、`bench/interpret_e2e.mjs`、`bench/privacy_e2e.mjs` 通過（期望字樣跟著改）；`test_server` 通過（含 `PlainWordingTests`）；截圖人工檢查首頁三種模式、會議紀錄、我的紀錄、待辦看板、團隊管理、問答，各兩種主題。
- **範圍：** 只改靜態頁面與樣式、`account.js`、`app.js` 的模式與送出欄位；不改伺服器程式。

## Risks / Trade-offs

- 首頁工作區變窄約 130px（計算值）→ 逐字稿與翻譯兩欄各窄約 65px，字級不變；實作後在 1440 寬截圖確認每行字數仍足夠。
- `/search`、`/ask` 變寬，長段落一行較長 → 內文段落另設 `max-width: 72ch` 保持易讀。
- 移除各頁額外按鈕後，回首頁要按「即時會議」或品牌圖示 → 兩者都在每頁固定位置。
