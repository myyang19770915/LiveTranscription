## Problem

本機 ASR 服務（`ws_server.py`）有兩個會讓不同連線互相影響的問題：

1. **requestId 可穿越目錄**：瀏覽器在開始錄音時送出的 `requestId`，經 gateway 原樣轉給 ASR，ASR 直接拿它組成每次請求的 log 檔路徑（`logs/requests/<requestId>.log`），開啟錄音存檔時也用它組成目錄（`wav_tmp_store/<requestId>/`）。值為 `../../outside` 時，檔案會寫到指定目錄之外；而且開檔發生在 ASR 驗證 secret 之前。ASR 容器把整個專案目錄掛成可寫，影響範圍包含程式碼本身。
2. **多條連線共用同一份 VAD 狀態**：VAD（語音活動偵測，判斷一句話何時講完）的模型與串流狀態是全域單一物件 `stream_vad`。每條連線的每段音訊都會推進它的狀態，有開 `use_vad` 的連線開始時還會把它重置。兩場會議（或會議加即時翻譯）同時進行時，彼此的斷句、`speech_end` 與分段重置會互相干擾。

## Root Cause

1. gateway（`webapp/server.py` 的 ASR 代理）以 `header.get("requestId") or uuid4()` 轉送瀏覽器提供的值；ASR 的 `asr_stream_api_v0`／`asr_stream_api_v1` 只檢查欄位存在（`validate_header`），未限制格式，並在檢查 `secret_key` 之前建立 log 檔。
2. `initialize_models` 只建立一個 `FireRedStreamVad`。它的特徵擷取器（`AudioFeat`）、模型快取（`model_caches`）與後處理器（`StreamVadPostprocessor`）都是有狀態的，卻被所有連線共用。

## Proposed Solution

依序處理：

1. **requestId**：
   - gateway 一律自己產生 UUID 作為上游 `requestId`，不再採用瀏覽器傳來的值。
   - ASR 在使用 `requestId` 組任何路徑前，先驗證它只含英數字、`-`、`_`，長度 1–64，不符就以錯誤關閉連線且不建立任何檔案。
   - 先驗證 `secret_key`，通過後才建立 log 檔。
   - 組出的路徑另以「解析後仍在指定目錄內」再確認一次。
2. **VAD**：VAD 模型權重仍只載入一次、全域共用；每條連線建立自己的 VAD 串流物件，帶有自己的特徵擷取器、模型快取與後處理器。每段音訊照舊都跑 VAD（`speech_end` 會送到前端作為斷句依據，沒開 `use_vad` 時也一樣），但只推進該連線自己的狀態。

## Non-Goals

- 不改變 log 的內容（即時翻譯模式仍會記錄辨識文字，這是另一個獨立問題）。
- 不改 VAD 參數、ASR 模型或斷句邏輯本身。
- 不加連線數上限或資源配額。
- 不合併 v0／v1 兩個重複的處理函式。

## Success Criteria

- gateway 送往 ASR 的 header 中，`requestId` 永遠是 gateway 產生的 UUID，與瀏覽器傳的值無關（`test_server` 測試）。
- ASR 收到 `requestId` 為 `../../outside`、空字串或超過 64 字元時，以錯誤關閉連線，`logs/requests/` 與 `wav_tmp_store/` 下沒有新檔案；`secret_key` 錯誤時也不建立 log 檔（ASR 容器內測試）。
- 兩段不同音訊交錯送入兩個 VAD 串流物件，得到的逐段結果與各自單獨處理完全相同（ASR 容器內測試）。
- 兩條連線同時對 ASR 串流時，彼此的辨識結果與 `speech_end` 和各自單獨跑時一致（實測）。

## Impact

- Affected specs: `asr-stream`（新能力：本機 ASR 串流的請求識別與連線隔離）
- Affected code:
  - Modified: webapp/server.py, webapp/test_server.py, ws_server.py
  - New: asr_session.py, test_asr_session.py
  - Removed: 無
