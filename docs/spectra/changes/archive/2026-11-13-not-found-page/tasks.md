## 1. 404 頁

- [x] 1.1 spec「Page requests that end in 404 get an HTML page」的範例表六列：新增 `webapp/static/not-found.html`（品牌、「找不到這個頁面」、說明「連結可能已失效，或你沒有開啟它的權限。」、連到 `/` 的「回開會頁」與連到 `/meetings` 的「會議紀錄」，套用 `tokens.css` 與既有的明暗主題記憶，不載入 `account.js`、不呼叫 API）；`webapp/server.py` 為 404 註冊例外處理：符合條件的請求回這個檔案（狀態 404、`Cache-Control: no-cache`），其餘交回 FastAPI 預設的 JSON 處理。驗證：`webapp/test_server.py` 新增 `NotFoundPageTests` 逐列比對範例表（狀態碼皆 404、內容類型與內容）。
- [x] 1.2 [after: 1.1] 全部單元測試通過：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 結果為 OK；以瀏覽器（gstack browse）開 `http://localhost:18082/no-such-page` 於 1440 與 390 寬各截圖一張，確認明暗主題下文字與兩個連結可見、無水平捲動（此項在 app 重新啟動後才看得到新行為）。
