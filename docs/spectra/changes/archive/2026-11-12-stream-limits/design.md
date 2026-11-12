## Context

- gateway `transcribe()`（`webapp/server.py`）：accept 後 `receive_text()` 等開始訊息（無期限），會議模式檢查成員、開 `MeetingAudio`；本機引擎由內部 `browser_to_asr()` 讀 `browser.receive()` 轉送並寫錄音，雲端引擎由 `mai_asr.MaiBridge.browser_to_mai()` 讀 `self.browser.receive()`。`finally` 以 `finish_recording` 收尾錄音。
- 登入（`webapp/auth.py` 的 `login`）：每帳號以 `login_failures` 表計次（`claim_attempt`／`release_attempt`），LDAP 無法連線時不計。
- app 以單一 uvicorn 程序執行（`webapp/Dockerfile` 的 CMD），程序內的計數即全站計數。
- 開會頁 `app.js` 的 `socket.onclose`：4401 轉登入頁，4404 顯示找不到會議，其餘顯示「辨識連線已中斷」；`status: error` 訊息會顯示其 `msg`。
- ASR `ws_server.py` 兩個端點的 `recv_queue = asyncio.Queue()` 沒有上限，`receiver()` 以 `await recv_queue.put(data)` 放入。

## Goals / Non-Goals

**Goals:** 規格中的四項串流限制、IP 登入限制、ASR 佇列上限，且兩種辨識引擎行為一致。

**Non-Goals:** 全站總量、持久化的 IP 計數、上傳檔案大小。

## Decisions

### 以 StreamGuard 包住瀏覽器連線

新增 `webapp/stream_limits.py`，`StreamGuard(browser, user, token, meeting)` 代理瀏覽器 WebSocket：`receive()` 先交給真正的 `browser.receive()`，收到音訊時：
1. 累計位元組數，超過 `MAX_STREAM_HOURS × 115,200,000` 時先送錯誤訊息，再拋出 `StreamStopped(4413, …)`，該段不回傳給呼叫端，因此不會轉送也不會寫錄音；
2. 距上次確認超過 `STREAM_RECHECK_MINUTES` 時，以 `auth.session_user(token)` 確認 session（否則 `StreamStopped(4401)`），會議串流再以 `team_access.require_member` 確認成員（否則送出訊息並 `StreamStopped(4403)`）。

資料庫無法回應時不中斷串流，記錄 warning 並在 30 秒後再確認，只有確定 session 已失效或已不是成員才結束。其餘屬性（`send_text`、`send_json`、`close`、`client_state`…）以 `__getattr__` 轉給原物件。本機的 `browser_to_asr()` 與 `MaiBridge` 都改為拿到 guard，所以兩種引擎共用同一套檢查。`transcribe()` 捕捉 `StreamStopped`，以其代碼關閉連線；錄音由既有 `finally` 收尾。

替代方案：在兩個讀取迴圈各自加判斷 → 重複且容易漏掉其中一條路徑，不採用。

### 每人串流數以程序內計數

`stream_limits.active` 是 `username → 數量` 的 dict，`transcribe()` 在 accept 並確認登入後、讀開始訊息前取得名額（超過 `MAX_STREAMS_PER_USER` 就以 4429 關閉），`finally` 釋放。單一事件迴圈內沒有競爭，不需鎖。

### 開始訊息期限

`asyncio.wait_for(browser.receive_text(), STREAM_HEADER_TIMEOUT)`，逾時以 4408 關閉，不建立任何引擎連線或錄音。

### IP 登入限制在記憶體以時間佇列計算

`auth` 新增 `ip_failures: dict[str, deque[float]]`。`login()` 一開始先清掉 5 分鐘以前的紀錄，數量 ≥ `LOGIN_IP_MAX_FAILURES` 就回 429（不動帳號計數、不連 LDAP）；回 401 時記一筆。LDAP 無法連線（503）與成功都不記、不清。來源 IP 取 `request.client.host`，代理標頭由 uvicorn 依 `FORWARDED_ALLOW_IPS` 處理（見 #10 的變更）。

### ASR 佇列上限

兩個端點的 `recv_queue` 改為 `asyncio.Queue(maxsize=ASR_RECV_QUEUE_MAX)`（預設 500，讀環境變數；非正整數時用 500）。`receiver()` 原本就 `await put()`，佇列滿時自然停止讀取 WebSocket。`_STOP` 也是 `await put()`：processor 已結束而佇列滿時，外層 `finally` 會 `receiver_task.cancel()`，不會卡住。

## Implementation Contract

**行為**：如規格所述；代碼 4408／4413／4429／4401／4403。開會頁對 4408、4413、4429、4403 顯示伺服器給的中文原因；會議進行中收到 4401 時先停止會議（保留瀏覽器錄音供下載）再顯示「登入已失效，錄音已停止；請先下載錄音，再重新登入」，沒有會議時收到 4401 才轉登入頁。

**設定**：`compose.yaml` 的 app 傳入 `STREAM_HEADER_TIMEOUT`、`MAX_STREAMS_PER_USER`、`MAX_STREAM_HOURS`、`STREAM_RECHECK_MINUTES`、`LOGIN_IP_MAX_FAILURES`；asr 傳入 `ASR_RECV_QUEUE_MAX`；README 設定參考表各一列。

**驗收**
- `test_server`：
  - 第 3 條串流 4429、結束一條後可再開；
  - 開始訊息逾時 4408（測試時把期限 patch 成很短）；
  - 「audio accepted」範例逐列（patch 小時數與已收位元組，或直接測 guard 的計算函式）；
  - session 被刪除後下一次確認以 4401 關閉、被移出團隊以 4403 關閉，錄音檔保留且已收尾；
  - 本機與 MAI 兩條路徑各至少一個測試走到 guard；
  - IP 限制「one address」範例逐列，另一個 IP 不受影響、LDAP 無法連線不計。
- `test_asr_session`：在 ASR 容器以極快速度送 30 秒音訊，辨識結果仍完整（不丟段）；以單元測試確認 `ASR_RECV_QUEUE_MAX` 解析。
- 開會頁的訊息對應以 `node` 檢查 `app.js` 的對應表（或人工確認）。

**範圍**：gateway 辨識 WebSocket、登入、ASR 接收佇列、設定與 README。範圍外：其他 API 的速率限制。

## Risks / Trade-offs

- [多人共用一個對外 IP（公司 NAT、或代理標頭未設定時所有 tunnel 使用者都是 cloudflared 的 IP）時，30 次失敗會擋住整個 IP 5 分鐘] → 門檻 30 次已遠高於正常輸錯；README 說明 `FORWARDED_ALLOW_IPS` 要包含 tunnel 的來源，app 才看得到真實 IP。
- [重新確認只在收到音訊時進行] → 會議中音訊每 0.16 秒一段，實際上就是每 5 分鐘一次；沒有音訊的串流不會錄到任何東西。
- [app 重啟後計數歸零] → 可接受；重啟本身也會中斷所有串流。
