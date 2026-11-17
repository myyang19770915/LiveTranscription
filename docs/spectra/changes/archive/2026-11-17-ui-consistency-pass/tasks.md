## 1. 頂端列與頁寬

- [x] 1.1 Every page shows the same header in the same place（共用頂端列）：`tokens.css` 加 `--page-width`、`--page-gutter`；新增 `webapp/static/topbar.css`（從 `admin.css` 搬出 `.topbar`、`.brand`、`.topbar-actions`、`.account` 與連結樣式，滑過不位移），所有子頁與登入頁載入；`account.js` 依 design「共用頂端列」輸出固定連結與 `aria-current="page"`；移除各子頁 `.topbar-actions` 裡額外的按鈕；登入頁改用圓形主題按鈕。驗證：新 `bench/ui_consistency_e2e.mjs` 在 1440 與 390 寬、深淺主題下，依 spec「the marked link」範例表檢查每頁的連結文字、順序與醒目的那一個，以及 `.brand`、`#themeToggle` 在各子頁位置相同（誤差 ≤ 1px）
- [x] 1.2 Switching the theme changes only colours（design「主題只換顏色」）／首頁頂端列：首頁 `<nav>` 改為 `<header class="topbar">` 放在 `<main>` 前，服務狀態與儲存狀態移到品牌旁；首頁 `main` 用頁寬 token；`themes.css` 刪除淺色主題改變 `main` 尺寸、外距、內距、外框的規則（`index.html`、`styles.css`、`themes.css`、`mobile.css`）。驗證：`bench/ui_consistency_e2e.mjs` 檢查首頁的 `.brand`、`#themeToggle` 與子頁相同位置；每頁在兩種主題下 `main`、`.topbar`、`.brand`、`#themeToggle` 的位置大小相同；390 寬首頁 `#themeToggle` 不超出畫面 [after: 1.1]
- [x] 1.3 One page width：子頁 `.page` 改用頁寬 token，`/search`、`/ask`、`/metrics`、`/actions` 移除自訂寬度，長段落設 `max-width: 72ch`（`admin.css`、`search.css`、`ask.css`、`metrics.css`、`actions.css`）。驗證：`bench/ui_consistency_e2e.mjs` 依 spec「Content edges line up」檢查 1440 寬時各頁 `.brand` 與內容左邊緣都在 80px [after: 1.1]

## 2. 即時口譯設定區

- [x] 2.1 Interpret mode on the live page（設定區）：`setLiveMode()` 替 `.controls` 加 `interpret` class；口譯模式隱藏 `.context-field`，`/ws/transcribe` 的 `system_prompt` 送空字串；`#interpretPlayRow` 與開始按鈕同一列；開始按鈕小字改「聽譯音、看譯文」；三種模式的空白提示寫對按鈕名稱（`index.html`、`app.js`、`refine.css`、`mobile.css`）。驗證：`bench/interpret_e2e.mjs` 依 spec「The settings of 即時口譯」檢查會議情境隱藏、同步播放譯音與開始口譯同一列（兩者 `top` 相同）、開始按鈕小字只有一行、空白提示為 點擊「開始口譯」，並檢查 `/ws/transcribe` 收到的 `system_prompt` 為空字串 [after: 1.2]

## 3. 逐頁修正

- [x] 3.1 No sideways scrolling on narrow screens：團隊管理頁 `.summary` 在窄螢幕可換行、`紀錄保存期限` 欄位換行時留在卡片內（`admin.css`）；其他頁若量到橫向捲動一併修正。驗證：`bench/ui_consistency_e2e.mjs` 在 390 寬檢查每頁 `scrollWidth <= innerWidth`，以及團隊管理頁「保存」、天數欄、「天」都在保存期限卡片內 [after: 1.3]
- [x] 3.2 待辦看板：「新增待辦」主要按鈕改用 `--accent`；手機版篩選列改為兩欄網格（團隊與分組同一列）、快速篩選單列可滑動（`actions.css`）。驗證：`bench/ui_consistency_e2e.mjs` 檢查 `/actions` 主要按鈕背景色等於其他頁主要按鈕、390 寬不橫向捲動；手機版篩選列以截圖人工確認 [after: 1.3]
- [x] 3.3 下拉選單與日期欄位：子頁的 `select`、`input[type=date]` 用共用樣式（自訂箭頭、日曆圖示顏色跟隨主題）（`admin.css` 或 `topbar.css` 旁的共用欄位樣式）。驗證：`bench/ui_consistency_e2e.mjs` 檢查 `/meetings`、`/search`、`/actions` 的 `select` 計算樣式 `appearance` 為 `none` 且有背景箭頭 [after: 1.3]
- [x] 3.4 問答頁、我的紀錄、成效指標：問答送出按鈕與輸入框等高且底部對齊、文字改「提問」（`ask.html`、`ask.css`、`ask.js` 若有用到按鈕文字）；我的紀錄「語言」欄不換行、譯文欄空白時顯示「按「載入」顯示紀錄。」（`interpret.css`、`interpret.js`）；成效指標卡片 `text-wrap: pretty`（`metrics.css`）。驗證：`bench/ui_consistency_e2e.mjs` 檢查問答按鈕與輸入框高度相同；我的紀錄每列高度不超過 56px；`bench/qa_e2e.mjs` 與 `bench/ui_polish_e2e.mjs` 若有檢查按鈕文字一併更新 [after: 1.3]

## 4. 全部驗證

- [x] 4.1 確認頂端列、頁寬、主題切換、口譯設定區與逐頁修正都符合規格且既有功能不變：`bench/ui_consistency_e2e.mjs`、`bench/ui_polish_e2e.mjs`、`bench/interpret_e2e.mjs`、`bench/privacy_e2e.mjs` 通過；完整 `test_server` 通過；首頁三種模式、會議紀錄、我的紀錄、待辦看板、團隊管理、問答在 1440 與 390 寬、深淺主題各截圖人工檢查 [after: 2.1, 3.1, 3.2, 3.3, 3.4]
