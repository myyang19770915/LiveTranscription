## Why

直接連 Azure MAI 量測（2026-11-08，en_tesla 前 60 秒、20 ms 一包）：MAI 的定稿文字（`transcription.delta`）落後語音中位數 2.7 秒（本機 Confucius 0.96 秒），閘道器額外開銷約 0；但同一條連線上 MAI 一直在送 `conversation.item.input_audio_transcription.intermediate` 暫定文字，落後語音只有 0.66 秒（p90 1.04），比本機引擎還快、比 delta 早約 2 秒。`webapp/mai_asr.py` 目前只處理 delta 與 completed，把 intermediate 丟掉。實測也確認 intermediate 的內容正好是「delta 還沒確認的那一段尾巴」：每個 delta 到達時，intermediate 就少掉開頭同樣的字。

使用者要求兩種模式（開會、即時翻譯）都用。

## What Changes

- `mai_asr.py`：收到 intermediate 事件時，把它當暫定文字送給瀏覽器：`{"status":"success","msg":{"text":""…},"tentative":"<暫定文字>"}`（中文經繁體轉換）；每個 delta 到達時先把 delta 文字從暫定文字開頭剝掉再一起送（避免同一個字短暫出現兩次）；`completed` 與重連時暫定文字清空（`tentative:""`）。內容相同時不重送。
- `server.py` 的 `TranscriptDisplay` 新增 `tentative(text)`：依語言做繁體轉換。
- `app.js`：新增 `tentative` 狀態。逐字稿面板在定稿文字後面以淡色（`.tentative`）顯示暫定文字；暫譯（draft）把暫定文字接在待翻譯尾巴後一起送（定稿翻譯永遠只用已確認的文字）；字幕的「正在講的原文」包含暫定文字。工作階段結束或重設時清空。本機 Confucius 不送 tentative，行為不變。
- 測試：`test_server.py` 的 MAI bridge 測試加 intermediate 事件；`translate_e2e.mjs` 注入 tentative 事件檢查面板、字幕與清空；README 說明。

## Non-Goals (optional)

- 不改 MAI 的提交策略、不改分段規則。
- 暫定文字不存檔、不匯出、不進會議段落（只有確認的 delta 文字會）。
- 不改本機引擎（它本來就每 0.16 秒更新）。

## Capabilities

### New Capabilities

- `tentative-transcript`: 雲端 MAI 的暫定文字在定稿前就顯示、用於暫譯與字幕，定稿後被確認文字取代。

### Modified Capabilities

（無）

## Impact

- webapp/mai_asr.py（intermediate 處理、tentative 欄位）、webapp/server.py（`TranscriptDisplay.tentative`）、webapp/static/app.js（`tentative` 狀態、面板、暫譯、字幕、重設）、webapp/static/refine.css（`.tentative` 樣式）、webapp/static/index.html（版本號）、webapp/test_server.py、bench/translate_e2e.mjs、README.md。
