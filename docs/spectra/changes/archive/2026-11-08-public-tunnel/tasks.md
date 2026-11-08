## 1. 對外開放設定

- [x] 1.1 compose 有 profile `tunnel` 的 cloudflared 服務，token 只來自 `.env`；沒設 token 時一般的 `docker compose config --services` 仍列出原本六個服務且不報錯，加 `--profile tunnel` 時多出 `tunnel`。驗證：執行這兩個指令。
- [x] 1.2 經通道進來的請求被 app 視為 https：`FORWARDED_ALLOW_IPS` 的私有網段涵蓋 cloudflared 的來源（共用通道經主機閘道為 192.168.128.1）。驗證：從 `localai_default` 網路以臨時 curl 容器打 `http://host.docker.internal:18082/api/health` 回 200，app 記錄的來源 IP 在信任範圍內；uvicorn `_TrustedHosts` 對該 IP 回 True；重建 app 後環境變數生效。
- [x] 1.3 README「對外開放」寫清楚登入安全前提、A 共用通道與 B 專用通道的後台步驟（Public hostname 欄位值）、Access 選項與停止方式；`.env.example` 與設定參考表有 `CLOUDFLARE_TUNNEL_TOKEN`。驗證：內容檢查。
- [x] 1.4 回歸：app 單元測試全數通過。
