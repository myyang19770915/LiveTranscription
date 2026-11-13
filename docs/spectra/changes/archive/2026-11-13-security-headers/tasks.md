## 1. 回應標頭

- [x] 1.1 spec「Security headers on every HTTP response」三個情境與「Strict transport security on HTTPS requests」兩個情境：新增 `webapp/response_headers.py` 的 ASGI 中介層（只處理 `http` scope，在 `http.response.start` 補上尚未存在的標頭；scheme 為 `https` 時加 HSTS），並在 `webapp/server.py` 以 `app.add_middleware` 掛上。完成時：登入頁、未登入的 401、已登入的 404 都帶三個標頭；`https` 請求有 `Strict-Transport-Security: max-age=31536000`、`http` 請求沒有；WebSocket 既有測試不受影響。驗證：`webapp/test_server.py` 新增 `ResponseHeaderTests`（`TestClient(app)` 與 `TestClient(app, base_url="https://testserver")`）。
- [x] 1.2 [after: 1.1] spec「Versioned static assets are cacheable」的範例表：同一個中介層對 `/assets/` 底下、查詢字串有非空 `v`、狀態 200 的回應加 `Cache-Control: public, max-age=2592000`，其餘不動，頁面路由的 `no-cache` 保留。驗證：`ResponseHeaderTests` 逐列比對範例表五列。

## 2. 文件與整體驗證

- [x] 2.1 [after: 1.2] `README.md` 的對外部署段落補上檢查清單：Cloudflare「Always Use HTTPS」、`.env` 設 `SESSION_COOKIE_SECURE=1`、應用程式已自動加的標頭有哪些、未做 CSP。驗證：內容審閱，清單所列標頭與 spec 一致。
- [x] 2.2 [after: 2.1] 全部單元測試通過：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 結果為 OK。
