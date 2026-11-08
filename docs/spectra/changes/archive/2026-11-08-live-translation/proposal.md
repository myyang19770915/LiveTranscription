## Why

即時會議頁不只用來開會：使用者也拿它做兩個人對談的即時翻譯，或看 YouTube、影片時的即時翻譯。這種用途不需要會議紀錄、團隊、主題、系列，也不該在伺服器留下逐字稿與錄音。另外，用「分頁／系統聲音」翻譯影片時，逐字稿和譯文在語橋的分頁裡，影片在另一個分頁，兩邊要切來切去；使用者希望字幕能浮在螢幕最上層、位置可以拖動。

## What Changes

- 即時會議頁新增「開會／即時翻譯」模式切換（記在瀏覽器）。即時翻譯模式：團隊、主題、系列欄位與系列待辦面板隱藏；按鈕變成「開始翻譯」；不建立會議紀錄、不存逐字稿與錄音到伺服器、不出現在會議紀錄列表；逐字稿與錄音仍留在瀏覽器，可用「匯出」下載；不需要屬於任何團隊。
- `/ws/transcribe` 接受 `mode: "translate"` 的連線：不檢查會議、不寫 `audio.wav`、辨識事件不附 `audioMs`；仍需要登入。沒有 `mode` 又沒有會議的連線照舊關閉 4404。
- 「浮動字幕」：頁尾新增按鈕，開啟一個永遠在最上層、可拖動、可調大小的字幕視窗（Chrome／Edge 116+ 的 Document Picture-in-Picture），顯示最近兩句譯文與暫譯；視窗內可切換顯示原文、調整字級，設定記在瀏覽器。兩種模式都能用。不支援的瀏覽器按鈕停用並說明。
- README 與 roadmap 補上這兩個功能。

## Non-Goals

- 不做真正透明疊在其他視窗上的字幕：瀏覽器無法畫到其他分頁或程式上，已向使用者說明並同意用最上層小視窗。
- 不把即時翻譯的內容存成任何伺服器紀錄（使用者選擇不存）。
- 不改開會模式的任何行為。

## Capabilities

### New Capabilities

- `live-translation`: 即時翻譯模式（不留紀錄的即時轉錄與翻譯）與浮動字幕視窗。

### Modified Capabilities

（無：開會相關的需求都以「會議」為範圍，即時翻譯不是會議；轉錄連線仍要求登入與同源，這兩條需求不變。）

## Impact

- Affected specs: live-translation（新）
- Affected code:
  - New: webapp/static/subtitles.js, webapp/static/subtitles.css, bench/translate_e2e.mjs
  - Modified: webapp/server.py（`/ws/transcribe` 的 translate 模式）, webapp/test_server.py, webapp/static/index.html, webapp/static/app.js, webapp/static/refine.css, webapp/static/mobile.css（系列面板由 refine.css 的 `body.translate-mode` 規則隱藏，series.js 不改）, README.md, docs/roadmap.md, bench/README.md
  - Removed: (none)
- Compatibility: 開會模式與既有 API 不變；舊的連線標頭（沒有 `mode`）行為不變。
