## Why

即時轉錄與翻譯在 bench 盲評約 83–87 分（目前最佳組合：混合引擎＋雲端精修），扣分集中在三處：串流辨識的同音錯字被照翻、斷句由標點與字數規則決定（長段、句中被切、插話黏在前句）、以及小模型即時翻譯的細節誤差。離線原型把同一段音訊依停頓切塊、以較準的離線辨識重聽、再由一個強模型一次完成修字、依語意斷句與翻譯，在 2026-11-13 同一輪盲評 10 段影片平均 91.5 分（同輪既有最佳組合 83.0 分，實測）。這個變更把原型做成產品中的選用模式。

## What Changes

- 開會頁「進階」新增開關「精準模式」（預設關閉；需要管理者設定模型才出現）。開會與即時翻譯兩種模式都可用；開啟時音訊與文字會送到設定的外部模型服務，開關旁明確標示。
- 閘道器在精準模式下，把收到的同一份音訊依停頓切成約 5–18 秒的區塊，每塊送第二段辨識（OpenAI 相容 audio transcriptions 端點，前文與會議詞彙當提示），再送一次文字模型，回傳「一句一段」的修正後原文與譯文；未講完的句尾留到下一塊。
- 結果以新的 quality 事件經原本的辨識 WebSocket 送到瀏覽器。頁面先照舊顯示即時逐字稿、暫譯與定稿；quality 事件到達後，以這些句子取代該時間範圍內的即時內容。浮動字幕、畫面＋字幕、複製、匯出與存入會議紀錄的段落都使用取代後的句子。
- 某一區塊的外部服務失敗或逾時時，該時間範圍保留即時結果並視為定稿，會議不中斷。
- 結束會議時，閘道器先送出最後一塊的 quality 事件才關閉連線。
- 精準模式開啟時不再做「延遲精修」與「自動學習詞彙」的背景重譯（它們改的是將被取代的即時段落）。
- bench：錄軌可帶精準模式並錄下 quality 事件，重播時送回真實頁面；評分表取頁面最後保留的段落。

## Non-Goals (optional)

（見 design.md）

## Capabilities

### New Capabilities

- `quality-pass`: 精準模式——音訊切塊、第二段辨識、修字＋斷句＋翻譯、quality 事件、頁面取代即時內容、失敗時退回即時結果、儲存的段落與其時間。

### Modified Capabilities

(none)

## Impact

- 新增：webapp/quality_pass.py
- 修改：webapp/server.py（/api/config、/ws/transcribe 掛入精準模式與收尾）、webapp/static/app.js、webapp/static/index.html、webapp/static/refine.css、webapp/test_server.py
- bench：webapp/replay_asr.py、webapp/replay_browser.py、webapp/replay_inject.js、webapp/replay_page.mjs、bench/run.py、bench/README.md
- 設定：compose.yaml、.env.example 新增 TRANSLATE_QUALITY_* 變數；README.md 補使用說明與分數
- 相依：不新增套件（httpx 已在使用）；外部服務為既有的 OpenAI 相容代理
- 既有行為：精準模式關閉時完全不變；meeting-timeline 規格中段落時間與儲存的要求只描述即時段落，精準模式的段落時間由新規格定義
