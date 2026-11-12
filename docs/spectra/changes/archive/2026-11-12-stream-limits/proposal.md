## Why

服務已可經 Cloudflare Tunnel 對外開放，但目前沒有任何資源上限：
- 辨識 WebSocket 連上後可以一直不送開始訊息，佔著連線；
- 一場錄音沒有長度上限，會一直寫進 `audio.wav`；
- 一位使用者可以同時開很多條辨識串流，搶光 GPU；
- ASR 服務每條連線的接收佇列沒有上限，送得比處理快時會無限增長；
- 登入失敗只依帳號計次，同一個來源換帳號猜密碼不受限；
- 長連線只在開始時檢查登入，登出或被移出團隊後，進行中的串流還能繼續。

## What Changes

- 新能力 `stream-limits`（gateway 的辨識 WebSocket，本機與雲端 MAI 引擎都適用）：
  - 連上後 30 秒內沒收到開始訊息就關閉（4408）；
  - 每位使用者同時最多 2 條串流，第 3 條直接關閉（4429，「同時進行的辨識已達上限（2 條）」）；
  - 一條串流累計 4 小時音訊就停止並關閉（4413，「已達單場上限 4 小時，錄音已停止」），錄音照常收尾；
  - 串流進行中每 5 分鐘重新確認 session 仍有效（否則 4401），會議串流另確認使用者仍是該團隊成員（否則 4403）。
  - 以上數值都可用環境變數調整：`STREAM_HEADER_TIMEOUT`、`MAX_STREAMS_PER_USER`、`MAX_STREAM_HOURS`、`STREAM_RECHECK_MINUTES`。
- `user-auth` 新增：同一來源 IP 5 分鐘內登入失敗 30 次後，5 分鐘內該 IP 的登入一律回 429，不詢問 LDAP（`LOGIN_IP_MAX_FAILURES`）。與既有的每帳號鎖定並存。
- `asr-stream` 新增：每條連線的接收佇列最多 500 段音訊（約 80 秒），滿了就暫停讀取 WebSocket，靠 TCP 讓用戶端放慢，不丟資料（`ASR_RECV_QUEUE_MAX`）。
- 開會頁在上述關閉代碼時顯示對應的中文訊息。

## Non-Goals

- 全站總串流數上限、上傳頻寬整形。
- 登入 IP 限制的持久化（記在 app 記憶體，重啟後歸零）。
- 檔案上傳（頭像等）的大小限制（已有各自的檢查）。

## Capabilities

### New Capabilities

- `stream-limits`: 辨識 WebSocket 的開始訊息期限、每人同時串流數、單條串流長度與進行中的存取重新確認。

### Modified Capabilities

- `user-auth`: 新增同一來源 IP 的登入失敗限制。
- `asr-stream`: 新增每條連線的接收佇列上限。

## Impact

- Affected specs: stream-limits（新）、user-auth、asr-stream
- Affected code:
  - Modified: webapp/server.py, webapp/auth.py, webapp/static/app.js, webapp/test_server.py, ws_server.py, compose.yaml, README.md
  - New: webapp/stream_limits.py
  - Removed: 無
