## 1. 段落分組

- [x] 1.1 `webapp/static/quality-view.js` 新增並匯出純函式 `paragraphs(records)`：回傳段落陣列，每段是該段句子 `source` 直接相接的字串；停頓 ≥ 3000 ms（下一句 `startMs` − 前一句 `endMs`）或目前段落 ≥ 200 字時開新段，`startMs`、`endMs` 都是 0 的句子接在目前段落。驗證：`bench/qualitycheck.js` 新增規格「Kept sentences flow into paragraphs」Example 表的 4 列，`node bench/qualitycheck.js` 全部 `ok`、沒有 `FAIL`。

## 2. 灰字去重複

- [x] 2.1 `webapp/static/quality-view.js` 的 `view` 回傳的 `liveSource` 去掉與最後一句保留句子結尾重複的開頭：從 `liveFrom` 起點前 6 個字到時間標記 `ms ≤ throughMs + LATE_MS` 的文字範圍內，比對去掉標點與空白後最後 6 到 3 個字（由長到短），只算結尾落在起點之後的比對，從第一次這樣的出現之後開始並去掉開頭標點空白；找不到時起點不變。驗證：`bench/qualitycheck.js` 新增規格「Live text does not repeat kept text」Example 表的每一列，並確認既有的「transcript pane: kept sources then the live text after 10000」仍是 `ok`；`node bench/qualitycheck.js` 沒有 `FAIL`。

## 3. 逐字稿窗格

- [x] 3.1 [after: 1.1, 2.1] 依修改後的「Quality events replace live content on the page」：`webapp/static/app.js` 的 `render('transcript')` 精準模式分支改用 `QualityView.paragraphs`：段落之間以 `\n\n` 相隔，灰字 `quality-live` 直接接在最後一段之後（不加換行）；翻譯窗格 `shownTranslated` 不變。驗證：重新建置 app（`docker compose --profile qwen-asr up -d --build app`）後，以 `bench/quality_e2e.mjs` 或實際開一場「中文、不翻譯、精準模式」會議播放 `artifacts/replay/clips/t60.wav`，截圖確認：整理好的句子在同一段相接、只有停頓處空一行、灰字緊接在黑字後且開頭沒有重複的字。
- [x] 3.2 [after: 3.1] 確認沒開精準模式的逐字稿與翻譯窗格不受影響：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過，並以一般開會模式（不勾精準模式）播放同一段音檔，截圖確認逐字稿顯示與修改前相同。
