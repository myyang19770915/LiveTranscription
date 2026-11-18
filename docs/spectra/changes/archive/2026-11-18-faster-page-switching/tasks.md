## 1. 頂端列先畫

- [x] 1.1 （Requirement: The header is drawn without waiting for the server；設計：頂端列先用這個分頁上次的帳號畫出）`account.js` 記住這個分頁的帳號（`sessionStorage['yq-me']`）：載入時有存檔就立即畫頂端列，`/api/me` 回來後存新值、內容不同才重畫；401 與登出時刪除；sessionStorage 不能用或內容壞掉時照舊等 `/api/me`。提供 `window.accountSoon`。驗證：`bench/page_switching_e2e.mjs` 的「第一次畫面就有頂端列」「登出後不沿用」檢查，以及既有 `bench/ui_consistency_e2e.mjs` 通過。

## 2. 資料不等帳號

- [x] 2.1 （Requirement: A page's data does not wait for the account；設計：各頁資料與帳號同時抓、首頁共用一次設定請求）成效指標直接載入資料；待辦看板、搜尋、問答、首頁團隊選單改用 `window.accountSoon`（待辦看板在 `accountReady` 回來後更新 `me`）；首頁以 `window.appConfig` 共用一次 `/api/config`，`series.js` 改用它；各頁 HTML 的 `?v=` 版本更新。驗證：`bench/page_switching_e2e.mjs` 的「`/api/metrics` 在 `/api/me` 回來前就發出」「首頁 `/api/config` 只請求一次」檢查，以及 `bench/actions_e2e.mjs`、`bench/metrics_e2e.mjs`、`bench/interpret_e2e.mjs` 通過。 [after: 1.1]

## 3. 預先載入下一頁

- [x] 3.1 （Requirement: The next page is prepared while the pointer rests on its link；設計：滑鼠停在頂端列連結上時預先載入）`account.js` 畫好連結後插入一次 `script#yq-prerender`（speculation rules，prerender `#account a.nav-link:not(.current)`，moderate）。驗證：`bench/page_switching_e2e.mjs` 在 Edge 中滑鼠停在成效指標上時，瀏覽器以 `Sec-Purpose: prefetch;prerender` 請求 `/metrics`、從不預先載入目前頁；點首頁後仍正常顯示服務狀態。 [after: 1.1]
- [x] 3.2 （Requirement: The next page is prepared while the pointer rests on its link；設計：預先準備的頁面在顯示時重新抓資料）預先準備的頁面顯示時重新抓資料：`window.onPageShown`，會議紀錄、我的紀錄、待辦看板、成效指標、團隊管理各自註冊；未登入（401）時待辦看板與成效指標不顯示錯誤。驗證：`bench/page_switching_e2e.mjs` 的「a prepared page fetches its data again when shown」五頁各重新請求一次。 [after: 3.1]

## 4. 量測與回歸

- [x] 4.1 新增 `bench/page_switching_e2e.mjs`：模擬 100 ms 延遲，量測並斷言 1.1、2.1、3.1 的行為，印出改前改後的換頁時間（頂端列出現、資料到齊）。跑 `test_server` 與 bench ui_consistency_e2e、interpret_e2e、privacy_e2e、ui_polish_e2e、actions_e2e、metrics_e2e 全部通過，並用瀏覽器實際點過各頁截圖確認。 [after: 2.1, 3.1]
