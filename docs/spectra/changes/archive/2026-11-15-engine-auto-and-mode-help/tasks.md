## 1. 引擎依語音語言決定

- [x] 1.1 實作 The spoken language decides the recognition engine（design：頁面依語言算出實際引擎再送出）：webapp/static/app.js 新增 `LOCAL_ENGINE_LANGUAGES`（`zh`、`yue`、`auto`、`zh_ja`，註明須與 `server.asr_engine()` 一致）與 `engineForLanguage(language)`；`asrEngine()` 改為 MAI 有設定時回傳 `engineForLanguage($('language').value)`、否則 `local`，不再讀 localStorage `asrEngine`。完成時：在瀏覽器主控台以 `engineForLanguage('ja')==='mai'`、`engineForLanguage('zh_ja')==='local'` 驗證，開始會議送出的 `engine` 符合規格範例表（由 2.1 的檢查腳本確認）。
- [x] 1.2 實作 design「引擎欄位改為唯讀說明，保留在進階裡」[after: 1.1]：webapp/static/index.html 的 `#asrEngineRow` 移除 `<select id="asrEngine">`，改為 `#asrEngineValue` 文字與規則說明「依語音語言自動選擇：中文、粵語、中英、中日雙向用本機，其他語言用雲端 MAI」；app.js 在 `updateTranslationDirection()`（語言變更與交換方向都會呼叫）及 `/api/config` 載入後更新文字，並移除所有 `$('asrEngine')` 的讀寫（`setControls`、`onchange`、localStorage 還原、`showAdvanced` 的事件清單）。完成時：選中文顯示「本機模型（語橋主機）」，選日本語或按交換方向後顯示「雲端 MAI（音訊會傳送到 Azure）」，頁面主控台沒有錯誤。
- [x] 1.3 讓 The live page states where audio and text go 依語言決定的引擎計算 [after: 1.2]：語言變更（含交換方向）時呼叫 `showPrivacy()`，`PrivacyNote.text` 收到的引擎是 `local` 或 `mai`。完成時：沒有外部翻譯與精修時，中文顯示「自架主機」，切到日本語顯示「雲端辨識／音訊會傳送到 Azure」，不用重新整理。

## 2. 收合摘要與兩種模式的說明

- [x] 2.1 實作 Folded heading names the advanced options in use 的新規則（design：收合摘要不再列引擎）[after: 1.2]：`advancedSummary()` 移除 `ENGINE_SUMMARY`，只列「雲端精修」（勾選、可見且精準模式未勾選）與「精準模式」，都沒有時「預設」。完成時：規格摘要範例表的五列在檢查腳本中逐列通過。
- [x] 2.2 實作 Cloud refinement and 精準模式 state what each does（design：兩種模式各用兩行說明，取代原本的單行附註）[after: 1.2]：webapp/static/index.html 兩個開關的 `<small>` 改為 `.toggle-desc` 與 `.toggle-fit` 兩行（雲端精修第二行 id `cloudRefineFit`），文字照規格範例表；`title` 改成同樣內容；精準模式勾選時 `cloudRefineFit` 改為「精準模式已包含，不需另外開啟」、取消後恢復；在 webapp/static/refine.css 加兩行說明的樣式（次要文字色、可換行，沿用 tokens.css 的字級 token）。完成時：1280px 展開進階與 390px 設定對話框內兩段說明都可見且不被截斷，深色與明亮主題都可讀（截圖確認）。
- [x] 2.3 確認 Advanced settings fold away by default 與 Narrow screens keep the settings dialog unchanged 在改版後仍成立 [after: 2.2]：`#asrEngineRow` 仍在進階群組與窄螢幕對話框中排第一（順序 辨識引擎、雲端精修、精準模式），`aria-controls` 不變；更新 webapp/static/index.html 中 app.js 與 refine.css 的 `?v=` 版本參數讓瀏覽器載入新檔。完成時：bench/ui_polish_e2e.mjs 既有的折疊、窄螢幕、390px 檢查全部通過。

## 3. 檢查腳本與回歸

- [x] 3.1 改寫並擴充 bench/ui_polish_e2e.mjs [after: 2.3]：摘要表改為以語言＋兩個開關為輸入；移除以 localStorage `asrEngine` 設定引擎的寫法；新增檢查：各語言的 `#asrEngineValue` 文字與 `asrEngine()`、localStorage 舊值 `asrEngine=mai` 加中文時仍為 `local`、交換方向後更新、隱私標示隨語言改變、開始會議送出的 `engine`、兩段說明在 1280px 與 390px 可見、精準模式勾選時 `cloudRefineFit` 文字改變。完成時：以 `YUQIAO_SESSION=<token> node bench/ui_polish_e2e.mjs <dir>` 執行全數通過，並暫時還原 app.js 確認新檢查會失敗。
- [x] 3.2 改寫 bench/translate_e2e.mjs 中讀取 `#asrEngine option` 與「約慢 1 秒」附註的檢查，改為檢查唯讀引擎文字 [after: 1.2]：完成時：`node --check bench/translate_e2e.mjs` 通過，且該檢查的斷言改為 `#asrEngineValue` 的文字（若環境可執行則實跑）。
- [x] 3.3 確認 Quality pass is opt-in and hidden until configured 的伺服器行為未變並記錄 [after: 3.1]：執行 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全數通過（已知偶發的 `test_a_third_stream` 另行註記）；bench/README.md 的 ui_polish_e2e 說明補上新增的檢查。
