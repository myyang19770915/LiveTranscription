## Why

使用者錄下的畫面＋字幕影片（2026-11-08 14:39，中文演講 → 英文）與伺服器日誌、模擬場（bench zh_jian 片段 150 秒）都指向同一件事：翻譯段落太長，字幕讀不了。

- 日誌：6 分鐘 191 次翻譯請求，定稿只有 47 次（平均每 7.8 秒一段，每段中位數 81 個中文字），其餘 144 次是每 2 秒整段重翻的暫譯。
- 模擬場：150 秒只定稿 16 次（每 16–20 秒一段，每段約 270 個英文字元＝4 行），暫譯改寫 56 次（中位數 192 字元≈3 行）。
- 影片：白色定稿譯文永遠從句子中間開始（兩行只裝得下一段的尾巴），黃色暫譯整段一直改寫，原文那一行是一整段 80 字的長句。

原因在 segmentation.js 的分段規則：連續說話只有在 。！？ 或停頓才定稿，否則要累積到 100 字才在最後一個逗號切（long-clause）。這是為會議紀錄品質調的（bench 分數），對即時字幕太長。

## What Changes

- `TranslationSegmentation.plan` 增加 `profile` 參數：`live` 時中日文連續說話累積到 **40 字**就在最後一個「已穩定」的逗號（後面已有 ≥8 字）切、每段至少 16 字；非中日文維持 100。`unfinished`（連接詞、句尾開放詞、因為…所以 等）規則不變，所以不會把「因為…」切開。會議模式不傳 `profile`，行為與 bench 分數不變。
- `app.js` 在即時翻譯模式（`translateOnly()`）用 `live` profile。
- 兩個字幕介面（浮動字幕、畫面＋字幕）顯示的內容改為：原文行＝**上一段定稿的原文**（最後一筆 finalized record 的 source，不再用整份逐字稿切「最後一句」）＋正在講的原文；譯文＝**最後兩段定稿的譯文**；暫譯不變。
- `bench/segcheck.js` 加 `live` profile 的中文連續說話案例；`bench/translate_e2e.mjs` 加 `plan(..., 'live')` 的切段檢查與字幕內容來源檢查；README 說明。

## Non-Goals (optional)

- 不改會議模式的分段與翻譯（紀錄品質以 bench 為準）。
- 不改暫譯的節奏（250 ms／650 ms／每多 12 字重翻）；段落變短後暫譯自然變短、改寫變少，先觀察。
- 不做逐字（token）串流顯示暫譯。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `live-translation`: Requirement「Translate-only sessions」加上即時翻譯模式的字幕分段規則；「Floating subtitles window」與「Screen view with subtitles」的內容改為最後兩段定稿譯文與上一段定稿原文。

## Impact

- webapp/static/segmentation.js（`plan` 的 `profile` 參數與 `live` 門檻）、webapp/static/app.js（`segmentPlan` 傳 profile；`subtitleParts()` 改傳上一段定稿原文與最後兩段定稿譯文）、webapp/static/subtitles.js 與 overlay.js（原文行與譯文直接用傳入內容，不再切句）、bench/segcheck.js、bench/translate_e2e.mjs、README.md、docs/spectra/specs/live-translation（delta）。不改伺服器。
