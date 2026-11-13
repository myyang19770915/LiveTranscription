## Why

對外網址 asr.my-yang.online 的回應沒有任何瀏覽器安全標頭：頁面可以被別的網站嵌進 iframe（點擊劫持）、瀏覽器不會記住只走 HTTPS、內容類型可被猜測。2026-11-13 的站台稽核以 curl 實測確認了這幾項。另外 `/assets` 靜態資源在來源端只有 ETag，沒有 `Cache-Control`，每次開頁都要逐檔重新驗證。

## What Changes

- 閘道器對每個 HTTP 回應加上 `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`。
- 請求是 HTTPS 時（含經受信任代理的 `X-Forwarded-Proto: https`）另外加 `Strict-Transport-Security: max-age=31536000`；HTTP 請求不加，區網直連不受影響。
- `/assets/` 底下帶 `v` 查詢參數的成功回應加 `Cache-Control: public, max-age=2592000`；沒帶 `v` 的維持現狀。
- 路由自己已設定的同名標頭不被覆寫（例如各頁面的 `Cache-Control: no-cache`）。
- README 補一段對外部署檢查清單：Cloudflare「Always Use HTTPS」、`.env` 的 `SESSION_COOKIE_SECURE=1`。

## Non-Goals (optional)

- 不加 Content-Security-Policy：頁面有行內樣式與行內腳本，要先盤點才能訂政策，另開變更。
- 不在應用程式內把 HTTP 轉址到 HTTPS：區網直連是 HTTP（edge-proxy-trust 的決定「不強制 Secure cookie」同一個理由），轉址交給 Cloudflare 設定。
- HSTS 不含 `includeSubDomains` 與 `preload`：同網域下還有其他服務，不由這個應用程式替它們決定。
- 不改 `.env`、不改 `SESSION_COOKIE_SECURE` 的預設值、不動 LDAP 設定：這些由部署的人處理，只在 README 說明。
- 快取不用 `immutable`、期限定 30 天而非一年：資源版本號是手動維護的，漏改版本號時 30 天後會自行恢復。

## Capabilities

### New Capabilities

- `response-headers`: 閘道器 HTTP 回應的安全標頭與靜態資源快取標頭

### Modified Capabilities

(none)

## Impact

- 新增 webapp/response_headers.py（ASGI 中介層）
- 修改 webapp/server.py（掛上中介層）
- 修改 webapp/test_server.py（新增測試）
- 修改 README.md（對外部署檢查清單）
- 不影響 WebSocket 連線、API 回應內容與資料庫
