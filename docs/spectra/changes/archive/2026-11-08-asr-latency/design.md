## Context

`pcm-worklet.js` 的 `PCM16Processor.process()` 每次（128 個取樣）就 `postMessage(input.slice())`；`app.js` 的 `workletNode.port.onmessage` 對每則訊息算音量、`resampleTo16k` 線性重採樣、`floatToPCM16` 後 `socket.send`。閘道器 `browser_to_asr` 與 `MaiBridge.browser_to_mai` 以同樣節奏轉送。量測方法與數字見 proposal。

## Goals / Non-Goals

**Goals:** 瀏覽器送音每 20 毫秒一包；引擎延遲差異讓使用者看得到；量測工具留在 bench。

**Non-Goals:** 不改 MAI 提交、翻譯排程、伺服器、`audioMs`。

## Decisions

### Worklet 累積 20 毫秒再送

`PCM16Processor` 持有 `Float32Array` 緩衝與 `target = Math.round(sampleRate / 50)`（AudioWorkletGlobalScope 的 `sampleRate`；48 kHz 時 960、44.1 kHz 時 882），`process()` 把輸入複製進緩衝，滿 `target` 就 `postMessage` 一個剛好 `target` 長的陣列並清空。訊息格式不變（Float32Array），所以 `app.js` 不改；重採樣改以整批做，128 取樣邊界的線性內插接縫也隨之減少。20 毫秒與 MAI `FRAME`（20 毫秒）同長，`PauseDetector.feed` 每則剛好一幀。音量條每秒更新 50 次仍流暢。

**替代方案**：主執行緒累積後再送。捨棄：worklet 端累積最省訊息數，也不用改主執行緒。

### 引擎說明直接寫慢多少

`.field-note` 與 `title` 寫「文字約慢 1 秒」（實測中位數 1.33 秒，取整說「約 1 秒」），不寫小數，避免看起來像保證值。

### 量測工具 bench/lag_gateway.py

參數：片段名（bench/cases.json）、引擎（local／mai／hybrid）、封包毫秒、秒數、輸出 jsonl；以翻譯模式連線（不建會議、不寫檔）。輸出每個事件的 `sent_s`（已送音訊秒數）、`t`（自開始的秒數）與文字。另有 `--compare <另一條 jsonl>`：把兩條軌的文字正規化後，對每 8 個字元的片段找到另一條軌到達時間，印出中位數／p10／p90；有人工字幕（zh／ja）時也印出 lagcheck 同法的落後秒數。

## Implementation Contract

- 行為：開始工作階段後，`/ws/transcribe` 收到的二進位訊息每則 640 位元組（最後一則可短），辨識與錄音結果不變；辨識引擎欄位顯示新的說明文字。capability 層級可觀察行為不變。
- 介面：worklet 訊息仍是 `Float32Array`（長度 `round(sampleRate/50)`）。`bench/lag_gateway.py <case> <engine> <chunk_ms> <seconds> <out.jsonl> [--compare other.jsonl]`。
- 失敗模式：worklet 輸入為空（裝置暫停）時不送；`stopMeeting` 時緩衝內不足 20 毫秒的尾端丟棄（最多 20 毫秒，EOS 前的尾音本就由引擎收尾）。
- 驗收：`bench/translate_e2e.mjs`、`catalog_e2e.mjs`、`series_e2e.mjs` 通過；新增單元檢查 `bench/workletcheck.js`（Node 以假的 `AudioWorkletProcessor`／`registerProcessor`／`sampleRate=48000` 載入 worklet，餵 10 次 128 取樣確認只送出 1 則 960 長度訊息，且內容順序正確）；`python bench/lag_gateway.py zh_jian local 20 30 out.jsonl` 可執行並印出落後秒數。
- 範圍：In 上述四個檔案與文件；Out 伺服器與引擎。

## Risks / Trade-offs

- 送音延遲多最多 20 毫秒（累積等待），遠小於省下的處理開銷；實測差異以 e2e 外的 `lag_gateway.py --compare` 確認。
