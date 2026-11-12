## 1. 設定

- [x] 1.1 `compose.yaml` 新增網路 `yuqiao-edge`（固定名稱、`10.250.250.0/28`），app 接上預設網路與 `yuqiao-edge`，`tunnel` 服務只接 `yuqiao-edge`，`FORWARDED_ALLOW_IPS` 預設改為 `10.250.250.0/28`。驗證：`docker compose config` 顯示 app 有兩個網路、tunnel 只有 `yuqiao-edge`、預設值正確。
- [x] 1.2 [after: 1.1] 依使用者授權：`.env` 只改 `FORWARDED_ALLOW_IPS=10.250.250.0/28`，`docker compose up -d app` 重建；`docker network connect yuqiao-edge` 接上 `cloudflared` 與 `cloudflared1`；停止並移除 `yuqiao-live-tunnel`。驗證：
  - 從主機以 `127.0.0.1:18082` 送出帶偽造 `X-Forwarded-For: 203.0.113.9` 與 `X-Forwarded-Proto: https` 的登入請求：app log 的來源不是 203.0.113.9，回應的 cookie 沒有 Secure；
  - 從接在 `yuqiao-edge` 上的暫時容器送出同樣的請求：app log 顯示 203.0.113.9，cookie 有 Secure；
  - `docker ps -a` 已沒有 `yuqiao-live-tunnel`；
  - `https://asr.my-yang.online/login` 仍回 200；網頁登入正常。

## 2. 文件

- [x] 2.1 README「對外開放」改寫：A、B 兩種做法都走 `yuqiao-edge` 且後台 URL 填 `http://app:8080`，`FORWARDED_ALLOW_IPS` 填 `10.250.250.0/28`，說明為何不能信任整段私有 IP、共用 cloudflared 被重建後要重新 `docker network connect`，以及用偽造標頭驗證的方法；設定參考表的 `FORWARDED_ALLOW_IPS` 預設值同步。驗證：`grep -n "10.0.0.0/8" README.md` 沒有輸出；人工審閱。
