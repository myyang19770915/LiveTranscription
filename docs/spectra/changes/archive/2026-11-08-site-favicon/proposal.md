## Why

瀏覽器分頁、書籤與手機主畫面目前沒有圖示，開了多個分頁時認不出哪個是語橋 Live。

## What Changes

- 由 webapp/static/brand-icon.png 裁掉空白邊後產生 favicon.ico（16／32／48）、favicon-32.png、favicon-192.png 與 apple-touch-icon.png（180），放在 webapp/static/。
- 每個頁面（含登入頁）的 `<head>` 加上 icon（ico、32px、192px）與 apple-touch-icon 連結。
- webapp/server.py 加 `GET /favicon.ico`，瀏覽器自動向根目錄要圖示時也拿得到。

## Non-Goals

- 不做 PWA manifest 與安裝到主畫面的完整支援。
- 不重畫圖示。

## Impact

- Affected specs: none
- Affected code:
  - New: webapp/static/favicon.ico, webapp/static/favicon-32.png, webapp/static/favicon-192.png, webapp/static/apple-touch-icon.png
  - Modified: webapp/static/*.html, webapp/server.py（`GET /favicon.ico`）, webapp/auth.py（`/favicon.ico` 加入不需登入的路徑）, webapp/test_server.py
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
