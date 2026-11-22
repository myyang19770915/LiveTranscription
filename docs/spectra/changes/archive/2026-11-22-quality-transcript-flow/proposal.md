## Summary

精準模式的逐字稿窗格改成連續的段落：整理好的句子接在同一段裡，說話停頓或段落太長才換段；即時灰字接在最後一段後面，並去掉和已整理句子重複的開頭。

## Motivation

2026-11-22 使用者以「開會：中文、不翻譯、精準模式」實測（錄影 20261122_211227.mp4），回報逐字稿「不怎麼連續，且一次更新變成空一行」。從影格看到三個現象：

1. 整理好的每一句各自一段、中間空一行（`webapp/static/app.js` 的 `render` 以 `\n\n` 連接 `shown.sources`），「好，我們點進來。」這種短句也獨佔一段，畫面零碎。
2. 灰字（還沒被精準模式取代的即時文字）開頭重複已整理的內容，例如黑字「好，我們點進來。」後面灰字從「點進來，好接著…」開始。原因是 `webapp/static/quality-view.js` 的 `liveFrom` 以「一次收到的即時文字」為最小單位切，而那段文字的 `audioMs` 是收到時的音訊總長，比它實際的音訊晚約 1.3 秒（同檔 `LATE_MS` 的註解），跨過句尾的那段文字會整段留在灰字裡。
3. 整理好的句子一批進來時，幾個段落一起出現、灰字一下縮短，畫面跳動。前兩點修好後，新句子會在原位由灰轉黑，跳動大幅減少。

## Proposed Solution

- **段落分組**（`webapp/static/quality-view.js` 新增純函式 `paragraphs(records)`）：依序把保留的句子接成段落。下一句的 `startMs` 與前一句的 `endMs` 相差 ≥ 3000 ms，或目前段落已達 200 字以上，才開新段。沒有時間的句子（`startMs`、`endMs` 都是 0）接在前一段。
- **逐字稿窗格**（`app.js` 的 `render('transcript')` 精準模式分支）：段落之間空一行，段內句子直接相接、不換行；灰字接在最後一段尾端（同一行流下去），不另起一段。
- **灰字去重複**（`quality-view.js` 的 `view`）：`liveFrom` 算出起點後，在起點之後、`ms ≤ throughMs + LATE_MS` 的即時文字範圍內，找最後一句保留句子的結尾（去掉標點與空白後的最後 3–6 個字，由長到短嘗試）。找到時從它之後開始顯示，並去掉開頭的標點與空白；找不到時維持現在的起點。
- 翻譯窗格、浮動字幕、畫面＋字幕、複製與匯出的內容不變。

## Non-Goals

- 不改翻譯窗格的排版：它仍是一句一段。使用者這次回報的是不翻譯模式，翻譯窗格的排版另案處理。
- 不改精準模式送句子的頻率或區塊長度（`webapp/quality_pass.py`），也不加動畫。
- 不改沒開精準模式時的逐字稿顯示。
- 不改會後校對頁與匯出檔的分段。

## Alternatives Considered

- 每句一行、不空行：使用者選擇了「停頓換段」（2026-11-22 對話），一句一行仍然零碎。
- 全部接成一段：長會議會變成一大塊文字。
- 灰字改從 `ms > throughMs` 的下一段才開始：會把還沒被整理的字暫時藏起來，直到下一批句子進來，畫面出現空缺，比重複更糟。
- 用說話者分段：即時畫面沒有說話者資訊（說話者辨識在會後），無法使用。

## Impact

- Affected specs: quality-pass
- Affected code:
  - Modified: webapp/static/quality-view.js, webapp/static/app.js, webapp/static/index.html（快取版本號）, bench/qualitycheck.js, bench/quality_e2e.mjs
  - New: (none)
  - Removed: (none)
