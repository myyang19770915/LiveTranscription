## Context

本機 ASR 服務 `ws_server.py`（Sanic，`single_process=True`，所有連線在同一個事件迴圈）提供兩個幾乎相同的 WebSocket 端點 `asr_stream_api_v0` 與 `asr_stream_api_v1`；gateway 預設連到 v1（`ASR_WS_URL`）。每條連線的 `processor()` 讀第一個 JSON header 後：

1. 以 `validate_header` 只確認有 `requestId` 欄位；
2. 立刻用 `requestId` 組出 `logs/requests/<requestId>.log` 並開檔，logger 名稱也帶 `requestId`；
3. 之後才檢查 `secret_key`（失敗時 `close(code=4401)`）；
4. 開啟 `--save_audio` 時，用 `requestId` 組 `wav_tmp_store/<requestId>/`。

ASR 容器以 `./:/workspace` 掛載整個專案為可寫。gateway（`webapp/server.py` 的 ASR 代理）組 `safe_header` 時以 `str(header.get("requestId") or uuid.uuid4())` 轉送瀏覽器的值。瀏覽器（`app.js`）與 bench 工具都以 `crypto.randomUUID()`／`uuid4()` 產生 requestId，沒有任何程式讀回 ASR 回傳的 requestId。

VAD：`initialize_models` 以 `FireRedStreamVad.from_pretrained` 建立單一全域 `stream_vad`。已查證 ASR 容器內的 fireredvad 套件：
- `FireRedStreamVad.__init__(audio_feat, vad_model, postprocessor, config)` 持有 `model_caches`；
- `AudioFeat`（`fireredvad.core.audio_feat`）與 `StreamVadPostprocessor`（`fireredvad.core.stream_vad_postprocessor`）各有 `reset()`，屬於有狀態物件；
- `DetectModel`（權重）在 `forward` 時以外部傳入的 `caches` 運作，本身沒有串流狀態。

兩個端點都以 `if True or use_vad:` 對每段音訊呼叫 `stream_vad.detect_chunk`，`speech_end` 結果放進每個回傳訊息（v1）或用於強制重置（v0）；前端 `app.js` 以 `speech_end` 決定斷句邊界。因此每段音訊都跑 VAD 是刻意的，問題只在狀態共用。

## Goals / Non-Goals

**Goals:**

- `requestId` 無法讓 ASR 在指定目錄外建立或寫入檔案；未授權的連線不留下任何檔案。
- 每條連線的 VAD 狀態互相獨立，同時多條連線時的斷句與單獨一條時相同。
- 不增加 GPU 記憶體：VAD 權重仍只載入一份。

**Non-Goals:**

- log 內容（是否記錄辨識文字）、log 輪替與保留期限。
- 合併 v0／v1 的重複程式。
- 連線數上限、佇列上限等資源配額。
- VAD 參數與斷句邏輯。

## Decisions

### gateway 一律自行產生 requestId

上游 header 的 `requestId` 改為 `str(uuid.uuid4())`，忽略瀏覽器的值。瀏覽器與 ASR 之間沒有任何依賴這個值的流程（已查證），所以不需要對應表。瀏覽器端 `app.js` 照舊送出自己的 `requestId`，無害，也不改。

替代方案：gateway 驗證瀏覽器的值後轉送 → 多一層要維護的檢查，而且 ASR 端仍須自行驗證，不採用。

### 驗證邏輯放在獨立模組 asr_session.py

新增 `asr_session.py`（專案根目錄，與 `ws_server.py` 同層），只依賴標準函式庫與 fireredvad，提供：
- `is_valid_request_id(value) -> bool`：正規式 `^[A-Za-z0-9_-]{1,64}$`，非字串一律 False。
- `request_path(base_dir, request_id, suffix="") -> str`：組路徑後以 `os.path.realpath` 確認仍位於 `base_dir` 之內，否則拋出 `ValueError`。
- `new_stream_vad(shared)`：回傳新的 VAD 串流物件（見下一條）。

`ws_server.py` 載入時會解析命令列參數並載入 vLLM，難以在單元測試中 import；把可測的部分抽出，讓 `test_asr_session.py` 能在 ASR 容器內直接執行。

### 先驗證 secret 與 requestId，再建立 log 檔

v0 與 v1 的 `processor()` 都調整為：
1. 讀 header；
2. 驗證 `requestId` 格式；
3. 驗證 `secret_key`；
4. 兩者都通過，才以 `request_path` 建立 log 檔與 logger。

失敗時只寫主 logger（不帶未驗證的原始值，只記錄長度與原因）；連線一開始記錄 header 的那一行，也由 `redact_stream_request_header` 把不合格的 `requestId` 換成 `[invalid]`：
- `requestId` 不合格：送出 `{"status": "error", "msg": "invalid requestId"}`，再以 `close(code=1008)` 關閉；
- `secret_key` 錯誤：維持既有的 `close(code=4401, reason="Unauthorized")`。

`--save_audio` 的目錄同樣改用 `request_path`。

### 每條連線建立自己的 VAD 串流物件，共用模型權重

`initialize_models` 仍以 `FireRedStreamVad.from_pretrained` 載入一次，保留為範本（權重、cmvn 路徑、設定）。每條連線在 header 驗證通過後呼叫 `asr_session.new_stream_vad(template)`，取得新的 `FireRedStreamVad`：
- 淺複製範本的 `AudioFeat`（`copy.copy`）。實作時查證：`AudioFeat.reset()` 為空函式，`KaldifeatFbank` 每次呼叫都新建 `OnlineFbank`，特徵擷取沒有串流狀態；淺複製讓每條連線有自己的物件，同時共用唯讀的 CMVN，不必重讀 cmvn 檔；
- 新的 `StreamVadPostprocessor`（以相同設定參數建立）；
- 共用同一個 `vad_model`；
- `model_caches=None`。

兩個端點中所有 `stream_vad.detect_chunk`／`stream_vad.reset()` 都改用這個連線自己的物件。`if True or use_vad:` 的「每段都偵測」行為保留，只是不再共用狀態；可移除冗餘的 `True or` 寫法改為無條件執行，語意不變。

因為 `single_process=True` 且 `detect_chunk` 為同步呼叫，不會有兩條連線同時進入同一個 `forward` 的情況；權重共用不需加鎖。

替代方案：
- 每條連線各載入一份模型 → 每條連線多占 GPU 記憶體並拖慢連線建立，不採用。
- 加鎖序列化並在切換連線時存取／還原狀態 → 複雜且容易漏掉狀態欄位，不採用。

## Implementation Contract

**行為**

- gateway → ASR 的 header：`requestId` 永遠是 gateway 新產生的 UUID 字串。
- ASR 收到 header：`requestId` 不合格 → 回錯誤訊息並以 1008 關閉；`secret_key` 錯誤 → 以 4401 關閉。這兩種情況都不建立 `logs/requests/` 下的檔案，也不建立 `wav_tmp_store/` 下的目錄。
- 合格且授權的連線：log 檔名與原本相同（`logs/requests/<requestId>.log`），檔案內容不變。
- 每條連線的 VAD 偵測只依該連線自己的音訊決定；回傳訊息的 `speech_end` 欄位照舊在每個結果中出現。

**介面**

- `asr_session.is_valid_request_id(value) -> bool`
- `asr_session.request_path(base_dir, request_id, suffix="") -> str`，越界時拋出 `ValueError`
- `asr_session.new_stream_vad(template: FireRedStreamVad) -> FireRedStreamVad`

**驗收**

- `webapp/test_server.py`：瀏覽器 header 帶 `requestId: "../../outside"` 時，`FakeUpstream` 收到的 header 中 `requestId` 是 UUID 格式，且不等於也不包含瀏覽器的值。
- `test_asr_session.py`（在 ASR 容器 `/workspace` 執行 `python -m unittest -q test_asr_session`）：
  - 規格「identifier checks」範例表逐列斷言；
  - `request_path` 對越界值拋出 `ValueError`；
  - 以 CPU 載入 VAD 模型，兩段不同的合成音訊交錯送入兩個 `new_stream_vad` 物件，逐段結果與分別單獨送入時完全相同；
  - 兩個物件的 `vad_model` 為同一個物件，`audio_feat` 與 `postprocessor` 為不同物件。
- 實測（ASR 重啟後）：
  - 以 `websockets` 直接連 ASR，送出 `requestId` 為 `../../outside` 的 header，連線被關閉，`logs/` 外沒有新檔案；送出錯誤 `secret_key`，`logs/requests/` 沒有新增該 requestId 的檔案。
  - 用同一段錄音同時開兩條串流，兩邊的辨識文字與 `speech_end` 序列，和單獨一條時一致。

**範圍**

- 範圍內：`ws_server.py` 兩個端點的 header 處理、log／錄音路徑、VAD 物件的建立與使用；`webapp/server.py` 上游 header 的 `requestId`；新模組與測試。
- 範圍外：log 內容與保留期限、v0／v1 合併、連線數限制、MAI 雲端引擎路徑（不經過 `ws_server.py`）。

## Risks / Trade-offs

- [VAD 權重被多條連線共用時，`forward` 內部若有隱藏狀態會互相影響] → 交錯測試直接比對逐段結果，若不一致即可發現；已查證 `forward` 以外部傳入的 `caches` 運作。
- [每條連線建立 `AudioFeat` 會重讀 cmvn 檔] → 已改用淺複製範本的 `AudioFeat`，不重讀檔案（見上方決定）。
- [v0 端點目前沒有呼叫端，但仍對外開放] → 兩個端點一起修，避免留下可利用的入口。

## Migration Plan

1. 部署 `webapp/server.py`（`docker compose up -d app`）。
2. 重啟 ASR（`docker compose restart asr`），模型重新載入約需數分鐘，期間本機辨識無法使用。
3. 回滾：還原 `ws_server.py` 與 `webapp/server.py`，刪除 `asr_session.py`，再重啟 ASR 與 app。
