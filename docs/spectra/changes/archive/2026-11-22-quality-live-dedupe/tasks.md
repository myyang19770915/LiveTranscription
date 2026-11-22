## 1. 測試先行

- [x] 1.1 依規格「Live text does not repeat kept text」的 Example 表，在 `bench/qualitycheck.js` 加入 11 列測試（每列以「保留句子＋切點前後的即時文字＋時間標記」組出 `QualityView.view` 的輸入，斷言 `liveSource`）。移除既有的「live: overlap beyond throughMs + 1500 ms is not searched」，因為新規格不再看時間標記；其他既有 `live:` 測試改由表格列涵蓋或保留。驗證：`node bench/qualitycheck.js` 執行時，表格的前 3 列（改字、跨兩句、延遲）與時間相關的列如預期 `FAIL`（新規則尚未實作），其餘既有測試仍 `ok`。

## 2. 寬鬆比對

- [x] 2.1 [after: 1.1] 改寫 `webapp/static/quality-view.js` 的 `skipRepeat`：K＝保留句子接起來去掉標點空白的最後 15 字；L＝切點前至多 6 字＋切點後至多 30 字（不看時間標記）；候選片段需起點在切點前 6 字內、終點在切點後、長度 ≥ 3；成立條件為 LCS ≥ 3 且 ≥ 片段的 80%、去掉片段最後一字 LCS 會變短、去掉 K 最後 2 字 LCS 會變短；取 LCS 最長、同長取最早結束者，灰字從其後開始並去掉開頭標點空白。驗證：`node bench/qualitycheck.js` 全部 `ok`、沒有 `FAIL`，並記錄執行時間（預期 1 秒內）。
- [x] 2.2 [after: 2.1] `webapp/static/index.html` 的 `quality-view.js` 快取版本號往上調，使用者重新整理即取得新版；`bench/quality_e2e.mjs` 全部 `ok`（需 `YUQIAO_SESSION`，flow 測試以 stub 攔截 `/api/meetings`，不寫入會議資料庫），並以 `curl` 確認伺服器送出的 `quality-view.js` 含新程式。結果與截圖存到 `docs/spectra/changes/quality-live-dedupe/evidence/`。
