## Why

使用者要把語橋 Live 以 `https://asr.my-yang.online` 對外提供，並使用 Docker Desktop 上已在跑的 Cloudflare Tunnel（cloudflared）。目前 app 只認 127.0.0.1 轉來的 `X-Forwarded-Proto`，經通道進來的請求會被當成 http，登入 cookie 不會加上 Secure；專案也沒有對外開放的步驟說明。另外機器上有一個以 `cloudflared tunnel --url` 開的臨時 trycloudflare 網址，已經把系統公開出去。

## What Changes

- `compose.yaml` 新增 `tunnel` 服務（profile `tunnel`，`cloudflare/cloudflared:2026.10.7`，`tunnel --no-autoupdate run`，token 讀 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN`，未設定時為空，不影響一般 `docker compose up`）；app 的 `FORWARDED_ALLOW_IPS` 註解補上通道情境的建議值。
- `.env.example` 新增 `CLOUDFLARE_TUNNEL_TOKEN` 與 `FORWARDED_ALLOW_IPS` 的通道說明。
- README 新增「對外開放（Cloudflare Tunnel）」：登入安全前提（測試 LDAP 帳號不得對外）、A 共用既有 cloudflared（Public hostname → `host.docker.internal:18082`）、B 本專案專用通道（→ `app:8080`）、Cloudflare Access 選項、停止對外、不要用臨時網址；設定參考表新增 `CLOUDFLARE_TUNNEL_TOKEN`；服務概述提到 `tunnel`。
- 本機 `.env`（不提交）追加 `FORWARDED_ALLOW_IPS=127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` 與空的 `CLOUDFLARE_TUNNEL_TOKEN=`，並重建 app。

## Non-Goals (optional)

- 不代替使用者在 Cloudflare 後台建立通道或 Public hostname，也不讀取或使用其他專案 cloudflared 的 token。
- 不更動 dev-ldap 測試帳號的密碼（由使用者決定），也不停止使用者自行開的 trycloudflare 容器；兩者在回報中提醒。
- 不改 app 程式碼：跨站檢查比對 Origin 與 Host，cloudflared 會保留原本的 Host（實測經通道的同源請求 204、他站 Origin 403）。

## Impact

- Affected specs: none
- Affected code:
  - New: (none)
  - Modified: compose.yaml, .env.example, README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
