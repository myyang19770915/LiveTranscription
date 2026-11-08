## 1. 閘道器

- [x] 1.1 spec「Tentative transcript from the cloud engine」情境「Intermediate text arrives before its delta」；設計決策「伺服器把 intermediate 當獨立的 tentative 欄位送，不混進 displayText」：`webapp/mai_asr.py` 處理 intermediate、delta 剝頭、completed／reconnect 清空；`webapp/server.py` 的 `TranscriptDisplay.tentative()`。驗證：`webapp/test_server.py` 新增該情境的測試（事件序列與 payload 順序），`python -m unittest -q test_server` 全過。

## 2. 瀏覽器

- [x] 2.1 [after: 1.1] spec 情境「Tentative text on the page」；設計決策「瀏覽器的 tentative 只影響顯示與暫譯」：`webapp/static/app.js` 的 `tentative` 狀態、`pendingSource()`、面板 span、暫譯接尾巴、字幕 pending、重設清空；`refine.css` 的 `.tentative`；`index.html` 版本號；README 補一句。驗證：`bench/translate_e2e.mjs` 注入 tentative 事件的檢查（面板、字幕 pending、匯出不含、清空）。

## 3. 驗收

- [x] 3.1 [after: 2.1] `YUQIAO_SESSION=… node bench/translate_e2e.mjs <wav> <dir>` exit 0；`catalog_e2e.mjs`、`series_e2e.mjs` 通過；單元測試全過。
