## 1. 伺服器

- [x] 1.1 Sessions are saved for their owner（邊收邊寫）：`webapp/interpret.py` 的 `Recording` 改為依 design「伺服器邊收邊寫」與「波形高度」，在使用者資料夾的 `.recording-…` 暫存資料夾以無緩衝檔案寫 `input.wav`／`output.wav`，只保留計數與波形高度；`save()` 寫 `session.json`、`transcript.txt`、`bars.json` 後改名成紀錄編號，沒有音訊時不留資料夾；`_run` 的長度上限與結束回報改用計數。驗證：`InterpretTests` 新增「Audio is on disk during the session」（途中 `input.wav` 為 44 + 14400 位元組、列表為空）與「The waveform of a session」的 `bars.json` 值；既有「兩段 3 秒譯音」與存檔、失敗相關測試照樣通過
- [x] 1.2 Sessions are saved for their owner（波形 API）：新增 `GET /api/interpret/sessions/<id>/bars`，有 `bars.json` 時回傳，沒有時由兩個 WAV 算出；權限與 404 規則同其他紀錄 API。驗證：`InterpretTests` 測別人的 id、不合格式的 id 回 404，刪掉 `bars.json` 後回傳值與原本相同 [after: 1.1]
- [x] 1.3 The source text comes from 語橋's recognition（伺服器）：`upstream()` 依 design「原文只送變動的部分」處理 `keep`。驗證：`InterpretTests` 以 spec 範例表五列逐一送出，存下的 `sourceText` 符合「Held text after」；沒有 `keep` 的舊格式仍整段取代 [after: 1.1]

## 2. 頁面

- [x] 2.1 Saved sessions can be replayed from any point／The source text comes from 語橋's recognition（頁面）：`webapp/static/interpret.js` 依 design「頁面不保留音訊」與「原文只送變動的部分」，移除 `inChunks`／`outChunks`，口譯中只記波形高度；結束且存檔後呼叫 `loadSession(saved)` 並顯示「已存檔：<id>」；`loadSession()` 改讀 `session.json` 與 `bars`，重播改用兩個 `<audio>` 播放伺服器上的 WAV；原文改送 `keep`／`text`；`Interpret.state()` 改報 `inBars`／`outBars`；更新 `webapp/static/interpret.html` 的快取版本。驗證：`bench/interpret_e2e.mjs` 改為回應 `bars` 與 WAV，新增「口譯中沒有音訊片段」「原文以 keep／text 送出且依序為範例的三則」「結束後載入剛存好的紀錄並可播放」三項，既有重播、拖曳檢查全部通過 [after: 1.2, 1.3]

## 3. 全部驗證

- [x] 3.1 確認長時間口譯的記憶體與傳輸問題已解決且既有功能不變：完整 `test_server` 通過；`bench/interpret_e2e.mjs` 通過；`PlainWordingTests` 通過（新文字不含技術名稱） [after: 2.1]
