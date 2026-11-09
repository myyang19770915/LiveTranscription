## Why

畫面＋字幕的字幕框會隨內容長短變高變矮，畫面跳動；原文用譯文一半的字級（英文原文看起來比中文譯文小很多），使用者覺得奇怪。

## What Changes

- 字幕框固定高度：原文 2 行、譯文 2 行、暫譯 1 行，內容空白時也保留位置；關閉「原文」時少掉原文的 2 行。
- 原文、譯文、暫譯使用同一字級與粗細；四段字級調整為 22／28／34／40px（原本譯文 28／34／40／48、原文為一半）。
- 短的內容從各段上方開始排；超過行數時捲到最新的字。

## Non-Goals

- 不改浮動字幕視窗（Document Picture-in-Picture）的版面。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `live-translation`: Screen view with subtitles 的字幕框改為固定行數、原文與譯文同一字級。

## Impact

- webapp/static/overlay.css、webapp/static/overlay.js、webapp/static/index.html（暫譯不再隱藏、資產版本）
- bench/translate_e2e.mjs（新增固定高度與同字級檢查）
