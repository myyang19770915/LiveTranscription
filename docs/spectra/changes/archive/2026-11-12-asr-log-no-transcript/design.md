## Context

`ws_server.py` 的 `asr_stream_api_v0`／`asr_stream_api_v1` 為每條連線建立 `logs/requests/<requestId>.log`（由 `asr-stream-isolation` 加上的 `request_path` 確保路徑安全），每段音訊處理後寫一行，內容包含：
- `out_str`：含本段辨識文字的回傳訊息；
- `total_text`：到目前為止本段落累積的全文。

另外還有幾處會帶出文字：
- 收到 EOS 的結束行（v0 記 `out_str`，v1 另記 `total_text`）；
- 重置行（`out_str`）；
- 收到非 EOS 文字訊息時記 `Received message: {data}`；
- 幻覺重置行的 `reason`（`tail_pattern:'<重複文字>'xN+`）。

主 logger 只寫容器標準輸出，內容是遮蔽過的 header 與事件，不含辨識文字。

`logs/` 的實測現況：229 個檔、約 3.8 GB，其中單一檔案 3.5 GB、約 6.9 萬行。原因是每段都重寫 `total_text`。

gateway（`webapp/server.py` 的 `transcribe`）以 `translate_only = header.get("mode") == "translate"` 判斷即時翻譯，送往 ASR 的 header 目前不帶這個資訊。

ASR 以 Sanic 執行（`single_process=True`），`before_server_start` 時載入模型。`asr_session.py` 是可在 ASR 容器內單元測試的輔助模組，`test_asr_session.py` 已有對執行中服務的整合測試（`StreamHeaderTests`）。

## Goals / Non-Goals

**Goals:**

- 預設情況下，任何串流的請求 log 都不含辨識文字；即時翻譯的串流永遠不含。
- log 大小不再隨串流時間平方成長，並有保留期限。
- 除錯時仍能暫時看到新增的辨識文字（會議串流）。

**Non-Goals:**

- gateway／MAI 的 log、`--save_audio`、主 log 的格式。
- 壓縮、依大小輪替。

## Decisions

### 結果行只記字數與耗時，文字由 asr_session.text_note 決定

`asr_session` 新增 `text_note(text, keep_text) -> str`：
- 回傳 `chars=<字數>`；
- `keep_text` 為真時再加上 ` text=<repr>`。

每條連線在 header 驗證通過後計算一次 `keep_text = log_text_enabled() and header.get("retain") is not False`，其中 `log_text_enabled()` 讀 `ASR_LOG_TEXT == "1"`。

兩個端點的所有含文字的 log 行改寫如下：

| 原本 | 改為 |
| --- | --- |
| 每段結果行的 `out_str`、`total_text` | `text_note(本段新增文字)`，加上原有的 `total_secs`、`lag_ms`、`avg_cost_ms`、`infer_mode`、`max_new_tokens`，以及累積字數 `total_chars=<n>` |
| 結束行（EOS）的 `out_str`、`total_text` | `finish! ` ＋ `text_note(最後新增文字)` ＋ `total_chars` |
| 重置行的 `out_str` | `text_note(重置時送出的文字)` ＋ `did_reset` |
| `Received message: {data}` | `received text message, chars=<n>` |
| 幻覺重置的 `reason` | 改用 `reason_kind(reason)`，只取冒號前的類型（`tail_pattern`／`tail_pattern_norm`） |

替代方案：
- 依 `retain` 只對即時翻譯不記 → 使用者選擇一律不記；會議逐字稿已在資料庫，log 留文字只增加外洩面。
- 用 logging Filter 事後遮蔽 → 文字已組進字串，遮蔽規則脆弱，不採用。

### gateway 對即時翻譯送出 retain: false

`transcribe` 組上游 header 時，`translate_only` 為真就加上 `"retain": False`，會議連線不加這個欄位。ASR 端只在值確實是 `False` 時視為不留存；缺少或其他值時，依 `ASR_LOG_TEXT` 決定。

### 保留期限：啟動時與每 24 小時清理

`asr_session` 新增：
- `retention_days(value) -> int`：空值為 14；非負整數照用；其他值記錄 error 後用 14。
- `prune_request_logs(directory, days, now=None) -> int`：`days == 0` 時不動作；否則刪除該目錄下（不遞迴）名稱以 `.log` 結尾、`mtime` 早於 `now - days` 的一般檔案，回傳刪除數量。

`ws_server.py` 以 `@app.listener("after_server_start")` 加一個背景任務：
1. 立即清理一次；
2. 之後每 24 小時清理一次；
3. 每次在主 log 記錄刪除數量；
4. 例外只記錄，不中斷服務。

替代方案：用主機排程器或 logrotate → 需要額外的主機設定，Windows 上也沒有 logrotate，不採用。

### 舊 log 在部署後一次刪除

使用者已同意刪除現有 `logs/requests/` 的所有舊檔（約 3.8 GB，含過去的逐字稿）。部署新版 ASR 後，刪除部署時間點之前的 `.log` 檔，部署後新產生的檔案保留。

## Implementation Contract

**行為**

- 請求 log 的每一行都不含辨識文字，除非 `ASR_LOG_TEXT=1` 且該串流沒有 `"retain": false`；即使在這個例外情況，也只記本段新增文字，不重寫全文。
- 即時翻譯串流：gateway header 帶 `"retain": false`。
- `logs/requests/` 中超過 `ASR_LOG_RETENTION_DAYS`（預設 14）天的 `.log` 檔，在 ASR 啟動時與之後每 24 小時刪除；設為 `0` 時不刪除。
- `compose.yaml` 的 asr 服務傳入 `ASR_LOG_TEXT: ${ASR_LOG_TEXT:-0}`、`ASR_LOG_RETENTION_DAYS: ${ASR_LOG_RETENTION_DAYS:-14}`；README 的設定參考表新增這兩列。

**介面**

- `asr_session.keep_request_text(header) -> bool`：`ASR_LOG_TEXT=1` 且 header 沒有 `"retain": false`；兩個端點與測試共用
- `asr_session.new_part(text, already_logged) -> str`：重置行只記這次新增的部分（v0 幻覺重置會回送累積全文）
- `asr_session.text_note(text, keep_text) -> str`
- `asr_session.reason_kind(reason) -> str`
- `asr_session.retention_days(value) -> int`
- `asr_session.prune_request_logs(directory, days, now=None) -> int`

**驗收**

- `test_asr_session.py` 單元測試：
  - 規格「what a result line records」範例表逐列斷言（`text_note` 搭配 keep_text 的計算）；
  - 規格「retention decisions」範例表逐列斷言（用暫存目錄與 `os.utime` 設定 mtime）；
  - `reason_kind` 對兩種 reason 只回傳類型。
- `test_asr_session.py` 整合測試（執行中的 ASR）：以 bench 錄音（不存在時跳過）分別用 `"retain": false` 與一般 header 串流，收集所有回傳文字，斷言對應 log 檔不含 `text=`，也不含任何長度 ≥ 8 字元的回傳文字（較短的片段例如 `for` 會和 log 固定用語 `for next` 撞字），並含有 `chars=`。
- `webapp/test_server.py`：`mode: translate` 的上游 header 有 `"retain": false`，會議沒有 `retain`。
- 部署後：`logs/requests/` 不含部署前的檔案；主 log 有一行清理紀錄。

**範圍**

- 範圍內：`ws_server.py` 兩個端點的請求 log 內容與清理任務、`asr_session.py`、測試、gateway header、`compose.yaml`、README。
- 範圍外：主 log、gateway／MAI log、`--save_audio`、v0／v1 合併。

## Risks / Trade-offs

- [除錯時看不到辨識文字] → 用 `ASR_LOG_TEXT=1` 暫時開啟（只限會議串流）；會議逐字稿也可在校對頁查看。
- [清理任務誤刪] → 只刪 `logs/requests/` 這一層、名稱以 `.log` 結尾、超過期限的一般檔案；單元測試涵蓋非 `.log` 檔與子目錄。
- [刪除舊 log 無法復原] → 使用者已明確同意；刪除前先列出檔案數與大小。

## Migration Plan

1. 部署 app（`docker compose up -d app`）與 ASR（`docker compose up -d asr`，套用新的環境變數並重新載入模型，約 2 分鐘內本機辨識無法使用）。
2. 刪除部署時間點之前的 `logs/requests/*.log`。
3. 回滾：還原程式與 compose；已刪除的舊 log 無法回復。
