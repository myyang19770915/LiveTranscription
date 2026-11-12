## 1. 存檔重試與狀態

- [x] 1.1 新增 `bench/savecheck.js`：從 `webapp/static/app.js` 取出段落存檔的程式區塊，以假的 `fetch` 與計時器執行，逐列斷言 Unsaved segments are shown and retried 規格的「retry schedule」範例、第三次請求帶最新段落、換到另一場會議後停止重試，失敗時以非 0 結束。驗證：修改 `app.js` 前執行會失敗（沒有重試與狀態）。
- [x] 1.2 [after: 1.1] 修改 `webapp/static/app.js`：存檔失敗依 5／15／30／60 秒重試最新段落、401 停止重試、在 `index.html` 新增的 `#saveState` 顯示狀態、有未存檔段落時 `beforeunload` 要求確認；`styles.css` 加上狀態樣式；更新 `index.html` 中 `app.js` 與 `styles.css` 的快取版本號。驗證：`node bench/savecheck.js` 與 `node bench/checks.js` 全部通過；`test_server` 全部通過。
