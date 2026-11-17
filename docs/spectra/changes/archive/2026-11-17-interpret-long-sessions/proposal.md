## Problem

即時口譯連續進行好幾個小時時，有兩個問題會越來越嚴重（realtime-interpret 審查時留下的第 4、6 項）：

1. 整段口譯的音訊都放在記憶體裡。瀏覽器把送出的原音和收到的譯音都存成 Float32 片段，以備重播；4 小時的原音約 1.4 GB，加上譯音可能讓分頁當掉。伺服器也把整段原音（4 小時約 690 MB）和所有譯音片段留在記憶體，等結束才寫檔。
2. 每次原文更新，頁面都把整段原文用 `{"type":"source","text":…}` 重送一次，口譯越久，每次傳的資料越多。

## Root Cause

- 存檔設計是「結束時一次寫出」：伺服器的 `Recording` 用 `bytearray` 與片段清單累積音訊，`save()` 才寫 `input.wav`／`output.wav`。
- 頁面的重播直接用記憶體裡的 `inChunks`／`outChunks` 排程 Web Audio，所以必須留住全部音訊；載入舊紀錄時也是整個 WAV 下載後轉成 Float32。
- 原文交給伺服器的訊息只有「整段取代」一種格式。

## Proposed Solution

- 伺服器邊收邊寫檔：連線後第一段音訊到時，在使用者資料夾裡開一個以 `.` 開頭的暫存資料夾，原音與譯音直接寫進 `input.wav`、`output.wav`（譯音照原規則放在到達時間、不重疊、中間補靜音），同時算出每 0.1 秒的波形高度。結束時寫 `session.json`、`transcript.txt`、`bars.json`，再改名成正式的紀錄編號；沒有任何音訊就刪掉暫存資料夾。
- 新增 `GET /api/interpret/sessions/<id>/bars` 回傳波形高度；舊紀錄沒有 `bars.json` 時由 WAV 算出。
- 頁面不再保留音訊：口譯中只記波形高度；結束且存檔成功後改顯示剛存好的紀錄。重播改用兩個 `<audio>` 元素直接播放伺服器上的 `input.wav`、`output.wav`（伺服器支援分段讀取，可以從任意位置開始播放，不必整檔下載）。
- 原文改成只送變動的部分：`{"type":"source","keep":<保留前幾個字>,"text":<之後的文字>}`；沒有 `keep` 時照舊整段取代。

## Non-Goals (optional)

- `/ws/transcribe` 回給頁面的 `displayText` 仍是整段（開會頁共用的格式，不在這次範圍）。
- 不改 4 小時上限、費用計算、紀錄的檔案格式與 API 權限。
- 存檔失敗或沒有存檔時，該次口譯不能重播（只顯示波形與文字）。

## Success Criteria

- 伺服器在口譯途中，`input.wav` 已寫在暫存資料夾、大小隨送出的音訊增加；`Recording` 不再保留整段音訊。既有「兩段 3 秒譯音」的存檔範例照樣成立。
- 暫存資料夾不會出現在「我的紀錄」，也無法用 API 讀取。
- 頁面口譯中不保留音訊片段（`Interpret.state()` 沒有音訊片段數），結束後載入剛存好的紀錄，重播、拖曳波形照常可用。
- 原文分段送出時，伺服器存下的原文與整段送出相同。
- `test_server` 全過；`bench/interpret_e2e.mjs` 全過。

## Impact

- Affected specs: realtime-interpret（modified）
- Affected code:
  - Modified: webapp/interpret.py, webapp/static/interpret.js, webapp/static/interpret.html, webapp/test_server.py, bench/interpret_e2e.mjs
