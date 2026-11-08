## Why

使用者反映即時轉譯比一開始測試時慢約 1 秒（當時用混合引擎、英文，也就是走雲端 MAI）。2026-11-08 以 bench 的英文（en_tesla）與中文（zh_jian）片段經 `/ws/transcribe` 實測（量測工具見下）：

- 本機 Confucius：中文文字落後語音中位數 0.40 秒（人工字幕對齊，2 個句尾可比對），每 0.16 秒更新一次。
- 雲端 MAI 英文：同一段話比本機晚 **1.33 秒**出現（中位數；p90 2.06 秒，n=18），中文晚 0.73 秒。這是 Azure 串流本身的節奏；讓英文也在 0.8 秒停頓時提交（commit）實驗後延遲沒變（1.40 秒）且文字變差（「Well, um.No, I I I think.」），不採用。
- 伺服器端沒有變慢：閘道器直通；翻譯模型每次 0.25 秒（llama.cpp 日誌 200 tokens/s）。
- 瀏覽器路徑比直接打閘道器再多約 0.2–0.6 秒（同一段文字到達時間差，n=27）。其中一個原因是 AudioWorklet 每 128 個取樣（48 kHz 時每 2.7 毫秒）就 `postMessage` 一次、主執行緒每次重採樣並 `socket.send` 一次（每秒約 375 個 86 位元組的訊息），閘道器再以同樣節奏轉給 ASR／MAI（MAI 每則都要 base64 與 JSON 包裝）；同一音檔改以 160 毫秒一包直接打閘道器時，同一段文字早 0.13 秒到達（中位數，n=77）。

所以「慢 1 秒」主要是雲端 MAI 的固有延遲，不是程式退步；能改的是把瀏覽器送音批次化，並讓使用者知道雲端引擎會慢、要最快就選本機。

## What Changes

- `webapp/static/pcm-worklet.js`：累積到 20 毫秒（`sampleRate / 50` 個取樣）才 `postMessage` 一次，而不是每 128 個取樣就送；`app.js` 的 `workletNode.port.onmessage` 不變（每批重採樣、算音量、送出），訊息數從每秒約 375 降到 50，每則 640 位元組（16 kHz PCM16 的 20 毫秒）。
- `webapp/static/index.html` 辨識引擎欄位的說明（`.field-note`）改為「雲端時音訊會傳送到 Azure，文字約慢 1 秒；最快是本機」，`title` 補同樣一句。
- 新增 `bench/lag_gateway.py`：把 bench 片段以指定封包大小經 `/ws/transcribe`（翻譯模式，不建會議）送給指定引擎，輸出事件軌並印出與另一條軌（或人工字幕）的到達時間差，供日後比較引擎延遲。
- `bench/README.md` 新增「2026-11-08 延遲量測」小節記錄以上數字與方法。

## Non-Goals (optional)

- 不改 MAI 的提交策略（實驗證明沒幫助）。
- 不改翻譯排程節奏（譯文更新刻意放慢以免暫譯閃動；使用者確認慢的是逐字稿）。
- 不改 `/ws/transcribe` 與 ASR 容器設定；不改 `audioMs` 的計算（仍是收到的位元組數 ÷ 32）。

## Impact

- Affected specs: none
- Affected code:
  - New: bench/lag_gateway.py
  - Modified: webapp/static/pcm-worklet.js, webapp/static/index.html（說明文字與資產版本號）, bench/README.md, README.md（引擎說明一句）
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes（音訊仍是 16 kHz PCM16 連續串流，只有每則訊息的長度改變；錄音與 `audioMs` 不受影響）
