## 1. gateway 串流限制

- [x] 1.1 依「以 StreamGuard 包住瀏覽器連線」新增 `webapp/stream_limits.py`（`StreamGuard`、`StreamStopped`、位元組上限計算、重新確認），依「每人串流數以程序內計數」與「開始訊息期限」修改 `transcribe()`：取得名額、開始訊息期限、本機與 MAI 路徑都使用 guard、捕捉 `StreamStopped` 以其代碼關閉，實現 Stream start, count and length limits 與 Long streams re-check access。驗證：`test_server` 新增第 3 條串流 4429 與釋放、開始訊息逾時 4408、「audio accepted」範例逐列、session 刪除後 4401、移出團隊後 4403 且錄音已收尾、MAI 路徑經過 guard 的測試；以 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過。
- [x] 1.2 [after: 1.1] 開會頁 `webapp/static/app.js` 對 4408、4413、4429、4403 顯示規格中的中文訊息。驗證：新增 `bench/closecheck.js` 讀取 `app.js` 的關閉代碼對應並斷言四個訊息，失敗時以非 0 結束。

## 2. 登入與 ASR

- [x] 2.1 依「IP 登入限制在記憶體以時間佇列計算」修改 `webapp/auth.py`，實現 Failed sign-ins from one address are limited。驗證：`test_server` 逐列斷言「one address」範例、另一個 IP 不受影響、LDAP 無法連線不計、成功不清除計數。
- [x] 2.2 依「ASR 佇列上限」修改 `ws_server.py` 兩個端點，實現 Bounded receive queue；`asr_session.py` 新增解析 `ASR_RECV_QUEUE_MAX` 的函式。驗證：`test_asr_session` 新增解析函式單元測試，以及對執行中服務極快送出 30 秒 bench 錄音、辨識結果與即時速度送出時相同的整合測試（ASR 重啟後執行）。

## 3. 設定與文件

- [x] 3.1 [after: 1.1, 2.1, 2.2] `compose.yaml` 傳入六個新設定，README 設定參考表各新增一列並說明 IP 限制與 `FORWARDED_ALLOW_IPS` 的關係。驗證：`docker compose config` 含六個變數；部署 app 與 ASR 後 `test_server`、`test_asr_session` 全部通過，網頁登入正常。
