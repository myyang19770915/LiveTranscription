## 1. 先寫會失敗的掃描測試

- [x] 1.1 Visible text names no supplier, model or technology：在 `webapp/test_server.py` 新增 `PlainWordingTests`，依 design「用測試掃描可見字串」收集 `webapp/static` 下 `.html`／`.js` 的可見字串與伺服器訊息常數（`minutes.NOT_CONFIGURED`、`qa.NOT_CONFIGURED`、`interpret` 的未設定與連不上訊息），遇到禁用字時列出檔名與字。另加一個小測試，直接用 spec 範例表的四個字串驗證判斷函式（前兩個失敗、第三個通過、識別字不檢查）。驗證：改字前執行 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server.PlainWordingTests`，掃描測試失敗並列出 Context 中的檔案，範例表測試通過

## 2. 開會頁與隱私提示

- [x] 2.1 The spoken language decides the recognition engine／Cloud refinement and 精準模式 state what each does／Readiness in the meeting page status：開會頁辨識列改為「本機（語橋主機）」「雲端辨識（音訊會傳送到外部服務）」，提示改「其他語言用雲端辨識」，雲端精修說明改「雲端服務」，「外部模型服務」改「外部服務」，「WebSocket 連線失敗」改「連線失敗」，服務未啟動的 title 改「請聯絡系統管理員」（`webapp/static/index.html`、`webapp/static/app.js`）。驗證：`bench/translate_e2e.mjs`、`bench/ui_polish_e2e.mjs`、`bench/series_e2e.mjs` 的期望字樣改成新字樣後通過 [after: 1.1]
- [x] 2.2 The live page states where audio and text go：隱私提示的句子改為「音訊會傳送到外部服務」「中文以外的音訊會傳送到外部服務」「文字會傳送到外部服務」（`webapp/static/privacy-note.js`）。驗證：`bench/privacy_e2e.mjs` 改期望後通過 [after: 1.1]

## 3. 列表、指標、紀要、問答、團隊管理

- [x] 3.1 會議列表與成效指標的辨識方式標籤由「雲端 MAI」改為「雲端」（`webapp/static/meetings.html`、`webapp/static/metrics.js`）；團隊管理頁的卡片標題改「雲端辨識用量」「即時口譯用量」，口譯用量句子改「不算進雲端辨識的上限」，「LDAP 帳號」改「公司帳號」（`webapp/static/admin.html`；依 design「管理員頁也一起改」）。驗證：`PlainWordingTests` 不再列出這三個檔案；`bench/interpret_e2e.mjs` 的用量卡片期望改新字樣後通過 [after: 1.1]
- [x] 3.2 Generating minutes：`minutes.NOT_CONFIGURED` 改「紀要功能尚未設定」，`qa.NOT_CONFIGURED` 改「問答功能尚未設定」；紀要頁未設定時顯示「紀要功能尚未設定，請聯絡系統管理員」、外部服務提示不帶模型名稱、「模型提到」改「紀要提到」；問答頁「回答由系統根據…」與未設定訊息改「問答功能尚未設定，請聯絡系統管理員」（`webapp/minutes.py`、`webapp/qa.py`、`webapp/static/minutes.js`、`webapp/static/ask.js`）。驗證：`test_server` 中斷言「紀要模型未設定」「問答需要紀要模型，目前未設定」的測試改新字樣後通過；`bench/qa_e2e.mjs` 改期望後通過 [after: 1.1]

## 4. 即時口譯頁

- [x] 4.1 Translation is proxied with the key kept on the server／The source text comes from 語橋's recognition／Translation cost is recorded for administrators：即時口譯頁說明、語言分組「本機辨識」「雲端辨識」、原文欄「（本機辨識）」「（雲端辨識）」、紀錄列「・雲端」、「也可選用（翻譯品質未經保證）」、「可能不會翻譯」、「原文用雲端辨識時另計雲端辨識費用」、未設定訊息「即時口譯尚未設定，請聯絡系統管理員。」；伺服器 4503 原因「即時口譯尚未設定」、連不上時「連不上翻譯服務，請稍後再試。」（`webapp/static/interpret.html`、`webapp/static/interpret.js`、`webapp/interpret.py`）。驗證：`InterpretTests` 通過，`bench/interpret_e2e.mjs` 原文欄期望改「（雲端辨識）」後通過 [after: 1.1]

## 5. 全部驗證

- [x] 5.1 確認畫面不再出現技術名稱且既有功能不變：`PlainWordingTests` 通過，完整 `test_server` 通過；第 2–4 組列出的 bench 全部通過；用瀏覽器打開開會頁、紀要頁、團隊管理頁、即時口譯頁各看一次，畫面文字與用語對照一致 [after: 2.1, 2.2, 3.1, 3.2, 4.1]
