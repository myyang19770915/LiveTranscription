## Context

segmentation.js 的 `plan(text,start,pauses,switchAt,force)` 在沒有句號、停頓時，`pending.length>=100` 才在最後一個已穩定的逗號切（段長 40–160）。app.js 的 `segmentPlan()` 呼叫它；`translateOnly()` 已能判斷即時翻譯模式。`sourceParts()` 把逐字稿切成 `done`（已定稿）與 `pending`，兩個字幕介面各自用 `lastSentences(done,1)`／`lastSentences(translation,2)` 再切句；中文演講幾乎沒有 。，所以「最後一句」就是一整段。

## Goals / Non-Goals

**Goals:** 即時翻譯模式的定稿段落短到一兩行譯文（中文約 16–60 字一段），字幕顯示上一段原文、最後兩段譯文；會議模式完全不變。

**Non-Goals:** 不改暫譯節奏、不做 token 串流、不改伺服器。

## Decisions

### plan 的 live profile：中日文 40 字就在穩定逗號切

`plan(text,start,pauses=[],switchAt=0,force=false,profile='meeting')`。`live` 且 pending 含中日文時 `runOn=40`、`minClause=16`；否則 `runOn=100`、`minClause=40`（現狀）。`long-clause` 規則改用這兩個值；其餘（`ready`、`unfinished`、`settled`＝逗號後已有 ≥8 字、上限 160）不變，因此「因為……，」或以「的／就／在」結尾的半句仍不會被切開。會議模式沒有 profile，輸出與現在逐字元相同（bench/segcheck.js 既有三個案例輸出不變）。

**替代方案**：改暫譯為 token 串流。捨棄：字還是會整段改寫，根本問題是段太長。

### 字幕內容由 app.js 直接給段落

app.js 新增 `subtitleParts()`：`{done: finals.at(-1)?.source||'', pending: transcript.slice(translationOffset), translation: finals.slice(-2).map(s=>s.target).join(' '), draft: draftText}`（`finals=finalizedRecords()`；中日雙向的 `target` 含「[中文 → 日文]」前綴，照樣顯示）。`render('transcript')` 與 `renderTranslation()` 都傳這個物件。subtitles.js／overlay.js 的原文行與譯文直接顯示傳入內容（不再 `lastSentences`），`lastSentences` 保留給 `pending`（最後兩句）與測試。

## Implementation Contract

- 行為：即時翻譯模式、中文連續說話（無句號、無停頓）時，每段定稿原文長度在 16–60 字之間（40 字門檻＋逗號後 8 字的穩定等待）；會議模式維持 40–160。字幕的白色譯文是最後兩段定稿，原文行白色部分是上一段定稿的原文。
- 介面：`TranslationSegmentation.plan(text,start,pauses,switchAt,force,profile)`，`profile` 為 `'meeting'`（預設）或 `'live'`。`Subtitles.update`／`Overlay.update` 仍收 `{done,pending,translation,draft}`，但 `done` 與 `translation` 已是段落，介面不再切句。
- 失敗模式：無新增；`profile` 非 `'live'` 一律視為 meeting。
- 驗收：`node bench/segcheck.js` 既有三案例輸出不變，新案例（中文連續說話、`live`）每段 16–60 字且不在「因為…，」後切；bench/translate_e2e.mjs 新增：`TranslationSegmentation.plan(<同一段>, 0, [], 0, false, 'live')` 的 `final` 為 true 且 `end` ≤ 60，meeting profile 則 `final` 為 false；`Overlay.update({done:'上一段原文', translation:'Seg A. Seg B.'})` 後 `.ov-done` 為「上一段原文」、`.ov-text` 為「Seg A. Seg B.」。既有 e2e 通過；catalog_e2e.mjs、series_e2e.mjs 通過。
- 範圍：前端分段與字幕內容；不含伺服器、不含會議模式。

### 門檻以盲評決定

同一批 ASR 軌以開會模式（`meetzh`）與即時模式（`REPLAY_LIVE=1`，`livezh`）重播，`blind.py` 盲評（bench/results/blindzh）：zh_jian 77→79、zh_chen 84→83、zh_fire 88→86，平均 83.0→82.7；段數 15→31–33、每段中位數 82→33 字。正確性持平，40 字採用。

## Risks / Trade-offs

- 逗號切段的翻譯品質略差於整句（譯者少了後文）；僅即時翻譯模式承擔，`following` 後文參數仍會帶給定稿翻譯。
- 定稿頻率上升（估計每 4–6 秒一次），翻譯模型負載略增；日誌顯示每次 0.5 秒，仍有餘裕。
