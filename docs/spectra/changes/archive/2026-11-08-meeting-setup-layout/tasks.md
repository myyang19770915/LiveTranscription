## 1. 設定區欄位卡

- [x] 1.1 開會頁設定區依 design.md 的 areas 改成「這場會議」「語音與翻譯」「進階」三組欄位卡（index.html 標記、refine.css 格子、series.css、mobile.css 的設定視窗分組標題、app.js 的 `mobileSettingsNodes` 順序與 `#setupAdvanced` 顯示），控制項 id 不變。驗證：1440px、1000px 明暗截圖目視確認三組欄位卡；400px 設定視窗截圖含分組標題與全部欄位；`bench/series_e2e.mjs`、`bench/catalog_e2e.mjs` 通過；`#asrEngineRow` 與 `#cloudRefineRow` 隱藏時用 DOM 量測確認沒有空白列。

## 2. 標題區、主題切換與頁首命名

- [x] 2.1 標題區縮成一行（h1 24px、副標隱藏、Local-first 單行），主題切換改為圖示按鈕，其他頁「回到會議」改「即時會議」（meetings.html、admin.html、README 若提到）[after: 1.1]。驗證：截圖量測 header 高度 ≤ 80px；主題切換點擊仍切換並記住（重新整理後維持）；`grep -rn 回到會議 webapp/static/*.html` 只剩說明文字。

## 3. 開會頁手機版頁首

- [x] 3.1 ≤ 760px 時開會頁頁首只留品牌、搜尋、頭像、系統狀態、主題切換；頭像選單多「待辦看板」「登出」（只在手機版顯示；account.js 加 `menu-phone` 項目與 `account-logout` class，accounts.css、admin.css 加規則）[after: 2.1]。驗證：400px 與 360px DOM 量測 `scrollWidth <= innerWidth` 且每個頁首按鈕的右緣都在視窗內；點頭像後選單含「待辦看板」「登出」，點「登出」回到登入頁（用另一個 session 測）；桌機頁首與其他頁面不變；`bench/search_e2e.mjs` 通過。
