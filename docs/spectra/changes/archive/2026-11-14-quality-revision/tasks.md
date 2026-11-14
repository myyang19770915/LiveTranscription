## 1. 閘道器：回顧修訂

- [x] 1.1 spec「Quality sentences carry an id」：`QualityPass` 送出的每個句子帶自 1 遞增的 `id`。驗證：`QualityPassTest` 新測試（兩個事件的 id 為 1、2、3）。
- [x] 1.2 [after: 1.1] spec「Shown sentences are revised with more context」「A revision accounts for every sentence」「Revision logs contain no meeting text」；設計決策「回顧修訂是精準模式之後的獨立一層」「視窗 6 句、後文 3 句、筆記延續」「回答要對得上每一句」：新增 `webapp/revise_pass.py` 的 `Reviser`（`add`、工作迴圈、請求內容、回答檢查、重問、落後時放棄、只送改動的句子、日誌）。驗證：`ReviserTest`（視窗時機、只送改動、筆記延續、範例表、重問、放棄、日誌）。
- [x] 1.3 [after: 1.2] spec「Revision ends with the stream」與修訂後的「The stream closes after the final quality event」；設計決策「結束時最多再等 30 秒」「設定」：`quality_pass.REVISE`／`REVISE_EXTRA`，`QualityPass` 在啟用時建立 `Reviser`、保留即時文字供 ALT、`finish()` 等待修訂至多 30 秒、`cancel()` 取消。驗證：`ReviserTest` 的結束與逾時測試、`QualityPassTest` 的啟用（final 事件後有 revision 事件）與未啟用（沒有修訂請求）測試。

## 2. 儲存

- [x] 2.1 spec「A revised source text is saved for unreviewed segments」；設計決策「儲存時原文也跟著更新」：`save_segments` 在未校對且無歷程的段落原文或譯文不同時更新 `source`、`target`，保留 `asr_text`、`live_target`。驗證：段落儲存測試類別新增兩個測試（修訂後再儲存、已校對不動）。

## 3. 頁面

- [x] 3.1 spec「The page replaces revised sentences」；設計決策「以句子編號取代，不改句數」：`QualityView.apply` 記下句子的 `id`，新增 `QualityView.revise`；`app.js` 處理 `revision` 事件並重畫、排入儲存；結束時等待上限 70 秒；資源版本參數更新。驗證：`node bench/qualitycheck.js` 新增的 revise 案例、`node bench/checks.js` 全過、`bench/quality_e2e.mjs` 新增「修訂後的文字顯示在兩個窗格」。

## 4. 設定、文件與實測

- [x] 4.1 [after: 1.3] `compose.yaml` 傳入 `TRANSLATE_QUALITY_REVISE`、`TRANSLATE_QUALITY_REVISE_EXTRA`；`.env.example` 與 `README.md` 說明兩個設定、延遲與用量。驗證：`docker compose config` 含兩個變數；README 設定表有對應列。
- [x] 4.2 [after: 4.1, 3.1, 2.1] 正式站 `.env` 啟用修訂並重啟 app；以正式站設定重錄 10 段、與現行版及基準同輪盲評，結果寫入 `bench/README.md`。驗證：`bench/results/` 有該輪評審檔與分數，README 有結果表；錄製期間日誌沒有 `failed` 的修訂視窗超過總數的 10%。
