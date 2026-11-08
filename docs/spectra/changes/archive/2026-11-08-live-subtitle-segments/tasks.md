## 1. 分段

- [x] 1.1 spec「Translate-only sessions」的情境「Continuous speech is finalized in subtitle-sized segments」；設計決策「plan 的 live profile：中日文 40 字就在穩定逗號切」：segmentation.js 的 `plan` 加 `profile` 參數與 `live` 門檻（40／16），app.js 的 `segmentPlan()` 在 `translateOnly()` 時傳 `'live'`。驗證：`node bench/segcheck.js` 既有三案例輸出不變、新 `live` 案例每段 16–60 字且不在「因為…，」後切；e2e 的 `plan(...,'live')` 檢查。

## 2. 字幕內容

- [x] 2.1 spec「Floating subtitles window」「Screen view with subtitles」的內容來源；設計決策「字幕內容由 app.js 直接給段落」：app.js 新增 `subtitleParts()`（上一段定稿原文、進行中原文、最後兩段定稿譯文、暫譯），`render`／`renderTranslation` 改傳它；subtitles.js／overlay.js 的原文行與譯文直接顯示（`pending` 仍取最後兩句）；資產版本號更新；README 即時翻譯段補分段說明。驗證：e2e 的 `Overlay.update({done:'上一段原文', translation:'Seg A. Seg B.'})` 顯示檢查與既有字幕檢查。

## 3. 驗收

- [x] 3.1 [after: 1.1, 2.1] bench/translate_e2e.mjs 新增上述兩項檢查，`YUQIAO_SESSION=… node bench/translate_e2e.mjs <wav> <dir>` exit 0；catalog_e2e.mjs、series_e2e.mjs 通過。
