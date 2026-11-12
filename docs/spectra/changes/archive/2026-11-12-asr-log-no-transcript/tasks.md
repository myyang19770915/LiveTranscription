## 1. 輔助函式

- [x] 1.1 依「結果行只記字數與耗時，文字由 asr_session.text_note 決定」，在 `asr_session.py` 新增 `text_note` 與 `reason_kind`，以及讀取 `ASR_LOG_TEXT` 的 `log_text_enabled`。驗證：`test_asr_session.py` 逐列斷言 Request logs without transcript text 規格的「what a result line records」範例表，並斷言 `reason_kind` 對 `tail_pattern:'嗯'x5+` 與 `tail_pattern_norm:'ab'x5+` 只回傳類型；以 `docker exec -w /workspace asr_confucius4-r2t2-asr-1 python -m unittest -q test_asr_session` 執行。
- [x] 1.2 依「保留期限：啟動時與每 24 小時清理」，在 `asr_session.py` 新增 `retention_days` 與 `prune_request_logs`。驗證：`test_asr_session.py` 用暫存目錄與 `os.utime`，逐列斷言 Request log retention 規格的「retention decisions」範例表，並斷言子目錄不受影響、未知值記錄 error。

## 2. ASR 與 gateway

- [x] 2.1 [after: 1.1] `ws_server.py` 的 v0、v1 兩個端點：每條連線計算一次 `keep_text`，所有含辨識文字的請求 log 行（結果行、EOS 結束行、重置行、收到文字訊息、幻覺 reason）都依設計的對照表改寫，不再記錄 `out_str` 與 `total_text`。驗證：`python -m py_compile ws_server.py`；`grep -n "out_str=\|total_text=\|Received message: {data}" ws_server.py` 沒有輸出；並於任務 3.1 實測。
- [x] 2.2 [after: 1.2] `ws_server.py` 以 `after_server_start` 加入清理背景任務（立即一次，之後每 24 小時），讀 `ASR_LOG_RETENTION_DAYS`；`compose.yaml` 的 asr 服務傳入 `ASR_LOG_TEXT` 與 `ASR_LOG_RETENTION_DAYS`。驗證：`docker compose config` 的 asr 環境含這兩個變數；重啟後主 log 出現清理紀錄。
- [x] 2.3 依「gateway 對即時翻譯送出 retain: false」，gateway 對 `mode: translate` 的上游 header 加 `"retain": False`，會議不加。驗證：`webapp/test_server.py` 新增測試斷言兩種情況；以 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 執行。

## 3. 部署與實測

- [x] 3.1 [after: 2.1, 2.2, 2.3] 部署 app 與 ASR 後，在 `test_asr_session.py` 新增對執行中服務的整合測試：以 bench 錄音分別用 `"retain": false` 與一般 header 串流，斷言兩個 log 檔都不含 `text=`，也不含任何長度 ≥ 8 字元的回傳文字（較短的片段會和 log 固定用語撞字）、且含 `chars=`；`test_asr_session` 與 `test_server` 全部通過。README 設定參考表新增 `ASR_LOG_TEXT`、`ASR_LOG_RETENTION_DAYS`。
- [x] 3.2 [after: 3.1] 依「舊 log 在部署後一次刪除」，先列出 `logs/requests/` 中部署前的檔案數與總大小，再刪除這些 `.log` 檔。驗證：刪除後 `logs/requests/` 只剩部署後產生的檔案，並回報刪除數量與釋放的空間。
