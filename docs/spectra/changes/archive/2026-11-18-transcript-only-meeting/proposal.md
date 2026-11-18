## Why

很多會議全程說中文，不需要翻譯，但仍需要即時原文經精準模式重新整理成正確、分好段的中文段落。目前「翻譯成」不能選與原文相同的語言（選中文會被改成英文），精準模式也一定要求翻譯，中文會議只能多付翻譯的時間與費用，畫面還多一欄用不到的譯文。

## What Changes

- 開會模式的「翻譯成」多一個選項「不翻譯（只整理原文）」：不送出任何翻譯請求（本機翻譯、雲端精修、會議中自動學名詞都不執行），畫面不顯示譯文欄，逐字稿佔滿寬度；浮動字幕與畫面＋字幕顯示原文。
- 打開精準模式時，精準模式照樣重新辨識、修正、斷句，但只輸出原文，不翻譯；回顧修訂也只修原文。
- 會議存下的段落沒有譯文，會議頁自動不顯示譯文欄，也不提供重譯。
- 開會模式記住語音語言與「翻譯成」（含不翻譯）；精準模式不再顯示只重複上一句結尾的句子；即時翻譯、即時口譯模式不提供（這兩種模式就是為了翻譯）。

## Non-Goals

- 不改變預設的翻譯語言。
- 不改精準模式支援的語言範圍（另案處理）。
- 不提供已存會議事後改成「不翻譯」或補上翻譯。

## Capabilities

### New Capabilities

- `transcript-only`: 開會模式不翻譯、只整理原文，含精準模式只輸出原文。

### Modified Capabilities

(none)

## Impact

- Affected specs: transcript-only（新增）
- Affected code: webapp/static/index.html（選項）、webapp/static/app.js（不送翻譯請求、版面、字幕、隱私標示）、webapp/static/refine.css（版面）、webapp/static/review.js（不提供重譯）、webapp/quality_pass.py（只輸出原文的指示與解析）、webapp/revise_pass.py（只修原文）、webapp/server.py（標頭的 target 接受 none）、webapp/test_server.py、bench/transcript_only_e2e.mjs（新增）
