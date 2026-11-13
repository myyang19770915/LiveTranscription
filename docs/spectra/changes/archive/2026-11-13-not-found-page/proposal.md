## Why

開啟不存在的網址或沒有權限的會議連結時，瀏覽器整頁只顯示原始 JSON（例如 `{"detail":"找不到會議"}`、`{"detail":"Not Found"}`），沒有任何導覽。別的團隊成員點到分享連結、或連結打錯時就會看到這個畫面。2026-11-13 的站台稽核實見。

## What Changes

- 瀏覽器以頁面方式開啟（GET、`Accept` 含 `text/html`、路徑不在 `/api/` 與 `/assets/` 之下）而結果是 404 時，改回一個 HTML 頁面：品牌、說明「找不到這個頁面」，以及回開會頁與會議紀錄的連結；狀態碼仍是 404。
- API 與靜態資源的 404 維持 JSON，內容不變。

## Non-Goals (optional)

- 不做 403、500 等其他狀態的專屬頁面。
- 404 頁不顯示帳號區與完整導覽：它不需要登入就能顯示，也不呼叫任何 API。
- 不改各頁面在自己畫面內顯示的「找不到」訊息。

## Capabilities

### New Capabilities

- `not-found-page`: 以頁面方式開啟不存在或無權限的網址時顯示的 404 頁

### Modified Capabilities

(none)

## Impact

- 新增 webapp/static/not-found.html
- 修改 webapp/server.py（404 的例外處理）
- 修改 webapp/test_server.py
