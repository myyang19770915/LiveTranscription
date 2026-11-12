## Problem

`live-translation` 規格承諾即時翻譯「不建會議、不在伺服器保存任何東西」，但本機 ASR 服務仍把每次串流的辨識文字寫進 `logs/requests/<requestId>.log`，不分會議或即時翻譯。目前 `logs/requests/` 有 229 個檔、約 3.8 GB，其中單一檔案就有 3.5 GB。這些 log 沒有保留期限，會一直累積。

## Root Cause

- `ws_server.py` 的 v0／v1 端點在每段音訊處理後，記錄 `out_str`（本段辨識結果）和 `total_text`（本段落到目前為止的全文）；結束、重置與收到非音訊訊息時也記錄完整內容。重複幻覺的原因字串（`tail_pattern:'…'`）同樣夾帶辨識文字。
- 每段都重寫一次累積全文，長時間沒有斷句的串流，log 大小會隨時間平方成長。
- ASR 不知道連線是會議還是即時翻譯（gateway 沒有告訴它），也沒有任何 log 清理機制。

## Proposed Solution

- ASR 請求 log 預設**一律不記錄辨識文字**，只記錄字數、耗時、延遲、重置原因類型等中繼資料。會議的逐字稿本來就存在資料庫，不需要 log 備份。
- 除錯用的環境變數 `ASR_LOG_TEXT=1` 可暫時恢復記錄文字（只記本段新增部分，不再重寫全文）；但 gateway 對即時翻譯連線會在 header 送出 `"retain": false`，這類連線即使開了 `ASR_LOG_TEXT` 也不記文字。
- 新增 `ASR_LOG_RETENTION_DAYS`（預設 14，`0` 表示不清理）：ASR 啟動時與之後每 24 小時，刪除 `logs/requests/` 中超過期限的 log 檔。
- 部署後刪除現有的 `logs/requests/` 舊檔（使用者已同意）。

## Non-Goals

- 不改 gateway 與 MAI 雲端引擎的 log（gateway 只記錄字數與識別碼，不含內容）。
- 不改 `--save_audio` 除錯錄音（預設關閉）。
- 不改主 log（容器標準輸出）的內容，除了既有的 header 遮蔽外，它不記錄辨識文字。
- 不做 log 壓縮或依大小輪替。

## Success Criteria

- 以即時翻譯與會議兩種 header 串流一段真實錄音後，對應的 log 檔都不含任何回傳給用戶端的辨識文字（整合測試）。
- `ASR_LOG_TEXT=1` 時會議連線的 log 含本段新增文字，`retain: false` 的連線仍然不含（單元測試）。
- 超過保留天數的 log 檔被刪除，未超過的保留，非 `.log` 檔不受影響（單元測試）。
- gateway 對即時翻譯送出 `retain: false`、對會議不送（`test_server`）。
- 部署後 `logs/requests/` 只剩新產生的檔案。

## Impact

- Affected specs: `asr-stream`（新增需求：請求 log 不含辨識文字、請求 log 保留期限）
- Affected code:
  - Modified: ws_server.py, asr_session.py, test_asr_session.py, webapp/server.py, webapp/test_server.py, compose.yaml, README.md
  - New: 無
  - Removed: 無
