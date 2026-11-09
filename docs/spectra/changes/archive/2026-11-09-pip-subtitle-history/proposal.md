## Why

浮動字幕視窗只顯示最後兩段譯文，視窗拉大也只是留白；原文是譯文一半的字級，英文原文和中文譯文大小差很多，看起來奇怪。使用者希望保留更多段落在上面，並讓原文與譯文一樣大。

## What Changes

- 浮動字幕視窗由下往上顯示最近的定稿段落（最多 30 段；開會模式為最近的句子），視窗多高就顯示多少段，最新的在最下面，最新兩段以外的顏色變淡。
- 開啟「原文」時，每段譯文上方顯示它自己的原文（即時翻譯模式），最後顯示正在講的原文與暫譯（同一個強調色）。
- 原文、譯文、暫譯使用同一字級與粗細；四段字級改為 22／28／34／40px；視窗預設高度 260px。

## Non-Goals

- 畫面＋字幕維持固定高度的字幕框（`overlay-fixed-height`），不改。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `live-translation`: Floating subtitles window 改為顯示最近多段、原文與譯文同字級。

## Impact

- webapp/static/subtitles.js、webapp/static/subtitles.css、webapp/static/app.js（subtitleParts 帶出 history）、webapp/static/index.html（資產版本）
- bench/translate_e2e.mjs、README.md
