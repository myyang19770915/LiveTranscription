## 1. 送音批次化

- [x] 1.1 設計決策「Worklet 累積 20 毫秒再送」：`webapp/static/pcm-worklet.js` 累積 `round(sampleRate/50)` 個取樣才 `postMessage` 一則 Float32Array；`index.html` 更新 worklet 的資產版本號（`audioWorklet.addModule` 路徑在 `app.js`，若帶版本號一併更新）。驗證：新增 `bench/workletcheck.js`（Node 假 AudioWorklet 環境，48 kHz 餵 10×128 取樣 → 恰 1 則 960 長度且順序正確；再餵 2×128 → 沒有新訊息），`node bench/workletcheck.js` exit 0；`bench/translate_e2e.mjs` 逐字稿仍出現。

## 2. 引擎說明

- [x] 2.1 設計決策「引擎說明直接寫慢多少」：`webapp/static/index.html` 的 `#asrEngineRow` `.field-note` 改「雲端時音訊會傳送到 Azure，文字約慢 1 秒；最快是本機」，`title` 補同句；`README.md` 引擎段補一句。驗證：`bench/translate_e2e.mjs` 新增檢查 `#asrEngineRow .field-note` 文字含「約慢 1 秒」。

## 3. 量測工具與紀錄

- [x] 3.1 設計決策「量測工具 bench/lag_gateway.py」：新增腳本（參數與 `--compare` 如 design），`bench/README.md` 工具列表加一條，並新增「2026-11-08 延遲量測」小節記錄 proposal 的數字與方法。驗證：`YUQIAO_SESSION=… python bench/lag_gateway.py zh_jian local 20 30 <out>` 印出落後秒數；`--compare` 對兩條軌印出中位數。
- [x] 3.2 [after: 1.1, 3.1] 以 `lag_gateway.py` 用 20 毫秒與 160 毫秒封包各跑一次 en_tesla（local）比較到達時間，把結果補進 `bench/README.md` 的延遲小節。驗證：小節含兩次量測的中位數。
