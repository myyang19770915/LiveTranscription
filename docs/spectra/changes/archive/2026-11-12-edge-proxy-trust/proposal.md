## Why

app 接受代理標頭（`X-Forwarded-For`、`X-Forwarded-Proto`）的來源由 `FORWARDED_ALLOW_IPS` 決定。README 目前要求設成整段私有 IP，本機 `.env` 也是如此。在 Docker Desktop 上，Cloudflare Tunnel（經 `host.docker.internal:18082`）與區網使用者直連 `http://<主機>:18082` 進到 app 時，來源都是同一個 Compose 閘道位址，所以區網任何人都能偽造這兩個標頭：
- 偽造 `X-Forwarded-For` 可繞過「同一 IP 登入失敗限制」；
- 偽造 `X-Forwarded-Proto` 會讓 app 誤判連線方式。

使用者決定區網仍要能直連，所以要讓 tunnel 走一條能和區網區分的路。另外，一個 trycloudflare 臨時通道容器（`yuqiao-live-tunnel`）仍在執行，任何拿到隨機網址的人都能連進來。

## What Changes

- `compose.yaml` 新增固定名稱與網段的網路 `yuqiao-edge`（`10.250.250.0/28`），app 同時接上預設網路與 `yuqiao-edge`，本專案的 `tunnel` 服務只接 `yuqiao-edge`。
- `FORWARDED_ALLOW_IPS` 預設改為 `10.250.250.0/28`：只有從 `yuqiao-edge` 進來的連線才採信代理標頭；區網直連照常可用，但它帶的代理標頭一律忽略。
- README「對外開放」改寫：兩種做法都改走 `yuqiao-edge`、後台 URL 改為 `http://app:8080`，移除「信任整段私有 IP」的指示，並說明原因與驗證方法。
- 環境操作（使用者已同意）：
  - 本機 `.env` 的 `FORWARDED_ALLOW_IPS` 改為 `10.250.250.0/28`；
  - 把共用的 `cloudflared`、`cloudflared1` 容器接上 `yuqiao-edge`；
  - 停止並移除 `yuqiao-live-tunnel`。
- 需要使用者在 Cloudflare 後台完成：把 `asr.my-yang.online` 的 Service URL 改為 `http://app:8080`。

## Non-Goals

- app 仍綁定所有網路介面的 18082（使用者要保留區網直連）。
- 不強制 Secure cookie：區網直連是 HTTP，強制會讓區網無法登入；經 tunnel 的 HTTPS 連線會依 `X-Forwarded-Proto` 自動加上 Secure。
- 不修改其他專案（localai）的 compose 檔；`docker network connect` 在那些容器被重建後需要再執行一次，README 會說明。

## Impact

- Affected specs: none
- Affected code:
  - New: (none)
  - Modified: compose.yaml, README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes（只改部署設定與文件；改後區網直連帶的代理標頭不再被採信）
