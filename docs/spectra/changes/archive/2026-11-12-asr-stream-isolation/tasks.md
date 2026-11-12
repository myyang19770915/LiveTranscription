## 1. Stream request identifier（requestId）

- [x] 1.1 依「gateway 一律自行產生 requestId」，gateway 送往 ASR 的 header 中 `requestId` 改為新產生的 UUID，不再採用瀏覽器的值（`webapp/server.py` 的 ASR 代理）。驗證：`webapp/test_server.py` 新增測試，瀏覽器 header 帶 `requestId: "../../outside"` 時，`FakeUpstream` 收到的 `requestId` 符合 UUID 格式且不包含瀏覽器的值；以 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 執行。
- [x] 1.2 依「驗證邏輯放在獨立模組 asr_session.py」，新增 `asr_session.py`，提供 `is_valid_request_id` 與 `request_path`（越界時拋出 `ValueError`）。驗證：新增 `test_asr_session.py`，逐列斷言 Stream request identifier 規格的「identifier checks」範例表，並斷言 `request_path` 對 `../../outside` 與絕對路徑拋出 `ValueError`；以 `docker exec -w /workspace asr_confucius4-r2t2-asr-1 python -m unittest -q test_asr_session` 執行。
- [x] 1.3 [after: 1.2] 依「先驗證 secret 與 requestId，再建立 log 檔」，調整 `ws_server.py` 的 `asr_stream_api_v0` 與 `asr_stream_api_v1`：requestId 不合格時送出錯誤訊息並以 1008 關閉，secret 錯誤時維持 4401 關閉，兩者都通過後才以 `request_path` 建立 `logs/requests/` 的 log 檔；`--save_audio` 的 `wav_tmp_store/` 目錄也改用 `request_path`。驗證：`python -m py_compile ws_server.py` 通過，並於任務 3.1 實測。

## 2. Per-connection speech detection（每條連線各自的 VAD）

- [x] 2.1 [after: 1.2] 實作 Per-connection speech detection：依「每條連線建立自己的 VAD 串流物件，共用模型權重」，在 `asr_session.py` 新增 `new_stream_vad(template)`，回傳共用 `vad_model`、擁有新的 `AudioFeat`、新的 `StreamVadPostprocessor`、`model_caches=None` 的 `FireRedStreamVad`。驗證：`test_asr_session.py` 以 CPU 載入 `/models/vad/Stream-VAD`，斷言兩個物件共用 `vad_model` 但 `audio_feat`、`postprocessor` 不同；兩段不同的合成音訊交錯送入兩個物件，逐段結果與各自單獨送入時完全相同（對應規格情境「Interleaved audio gives the same detection as separate audio」）；中途為第二個物件呼叫 `reset()` 不改變第一個物件的後續結果（對應「A new connection does not reset an ongoing one」）。
- [x] 2.2 [after: 1.3, 2.1] `ws_server.py` 兩個端點在 header 驗證通過後，以 `new_stream_vad` 建立連線自己的 VAD 物件，所有 `detect_chunk` 與 `reset()` 都改用它，不再使用全域 `stream_vad` 的串流狀態；每段音訊仍無條件執行偵測，`speech_end` 照舊出現在每個結果中。驗證：`python -m py_compile ws_server.py` 通過；`grep -n "stream_vad\." ws_server.py` 只剩建立範本的位置；並於任務 3.2 實測。

## 3. 實測

- [x] 3.1 [after: 1.1, 1.3] 重啟 ASR（`docker compose restart asr`）並部署 app 後，以 `websockets` 直接連 ASR：送出 `requestId` 為 `../../outside` 且 secret 正確的 header，連線以 1008 關閉，專案目錄與 `logs/` 外沒有新檔案；送出合格 `requestId` 但 secret 錯誤，連線以 4401 關閉，`logs/requests/` 沒有該 requestId 的檔案；從網頁開一場本機引擎會議，辨識正常，`logs/requests/` 出現以 UUID 命名的 log 檔。
- [x] 3.2 [after: 2.2, 3.1] 以同一段錄音（`webapp/replay_asr.py`）先單獨跑一次，再同時開兩條串流各跑一次，比對三次的辨識文字與 `speech_end` 序列一致；並跑 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 與 `test_asr_session` 全部通過。
