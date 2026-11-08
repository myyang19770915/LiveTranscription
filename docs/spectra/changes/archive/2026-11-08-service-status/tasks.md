## 1. 後端

- [x] 1.1 依設計決策「新端點 /api/services 需登入，/api/health 維持原樣」「三項檢查並行，每項逾時 2 秒」「ASR 健康網址由 ASR_WS_URL 推得，可用 ASR_HEALTH_URL 覆寫」：`GET /api/services` 依 spec「Service readiness endpoint」回傳三項服務狀態（並行、每項 2 秒、只有 200 算正常、固定順序、不含模型名稱或網址），未登入 401，`/api/health` 不變；ASR 健康網址由 `ASR_WS_URL` 推得或用 `ASR_HEALTH_URL`。驗證：`test_server` 新增 ServiceStatusTests 涵蓋 Example「Responses」四列、「Health URL」三列與未登入 401，全部通過。

## 2. 開會頁

- [x] 2.1 [after: 1.1] 依設計決策「待機才檢查，30 秒一次，分頁在背景時暫停」「就緒用主色實心圓點，不閃爍」：開會頁待機時依 spec「Readiness in the meeting page status」檢查並顯示：載入後一次、可見時每 30 秒、回到前景立即；就緒為「服務就緒」主色實心圓點（kind `ready`），未就緒為紅色「<名稱>服務未啟動」並附 title，請求失敗為「無法連線到伺服器」；進行中或啟動中不覆蓋；結束訊息保留到下一次檢查。驗證：`bench/translate_e2e.mjs` 用 `page.route` 假造回應，檢查 Example「Status text」四列與「Running session is not overwritten」，並截圖確認就緒與未就緒外觀（明亮、深色）。
- [x] 2.2 [after: 2.1] README 端點表新增 `/api/services`，並說明右上角狀態（服務就緒／未啟動／進行中）。驗證：內容檢查。

## 3. 回歸

- [x] 3.1 [after: 2.1] 真實服務下開頁顯示「服務就緒」；app 單元測試、translate、catalog e2e 全數通過。驗證：執行上述命令並記錄結果。
