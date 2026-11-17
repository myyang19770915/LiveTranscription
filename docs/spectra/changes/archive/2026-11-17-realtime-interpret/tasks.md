## 1. 翻譯用量

- [x] 1.1 Translation cost is recorded for administrators（資料層）：依「翻譯用量用新表 interpret_usage」新增 `webapp/migrations/019_interpret_usage.sql` 與 `webapp/interpret_usage.py`（`record`、`add`、`summary`、`cost`、`python -m interpret_usage [add <seconds> <purpose>]`），規則照 `mai_usage`；依「翻譯費用依譯音秒數計」，單價讀 `INTERPRET_USD_PER_HOUR`（預設 2.04）。驗證：`test_server` 新測試涵蓋 spec 的 usage figures 範例表（0→0、1800→1.02、129→0.07、3600 秒每小時 3 美元→3）、不合法用途與 inf/負秒數 CLI 回 2、寫入後 `summary()["byPurpose"]` 正確
- [x] 1.2 `GET /api/admin/interpret-usage` 只給管理員（成員 403），回傳 `seconds`、`usd`、`usdPerHour`、`byPurpose`；在 `webapp/server.py` 掛上 router。驗證：`test_server` 測試 alice 得 403、管理員得到 1.1 寫入的數字 [after: 1.1]

## 2. 伺服器：頁面權限、代理與存檔

- [x] 2.1 The interpret page is for system administrators：依「只開放系統管理員，紀錄只給本人」新增 `webapp/interpret.py` 的 `GET /interpret`（管理員 200、成員 403 沒有權限頁、未登入轉 `/login?next=%2Finterpret`）與 `GET /api/interpret/config`（`configured`、`usdPerHour`、58 個 `targets`，不含端點與金鑰），掛進 `webapp/server.py`。驗證：`test_server` 測試三種身分的回應與 config 內容不含 KEY 字串 [after: 1.2]
- [x] 2.2 Translation is proxied with the key kept on the server：`WS /ws/interpret` 依序檢查 4401／4403（先於 Azure）、4429 串流名額、4408 啟動逾時、4400 語言、4503 未設定，再以 `api-key` 連 Azure translations 端點、`session.update` 設輸出語言、轉送 24 kHz 音訊、回傳 `audio`／`out`，`zh` 譯文經 `TO_TAIWAN`（s2twp 加「明瞭」修正）轉成台灣用語，超過 `MAX_STREAM_HOURS`（24 kHz 每小時 172,800,000 位元組）關 4413，`{"type":"stop"}` 送 `session.close` 後最多等 8 秒。驗證：`test_server` 以假的 Azure 上游（替換 `websockets.connect`）測各關閉碼、Azure 未被連線的情況、「这个软件」→「這個軟體」、上游收到的 `session.update` 與 append 內容、日誌不含金鑰 [after: 2.1]
- [x] 2.3 Sessions are saved for their owner：依「口譯紀錄以檔案存在 output/interpret/<帳號>/」在中斷時寫 `input.wav`、`output.wav`（譯音依到達時間放置、不重疊、補靜音）、`session.json`、`transcript.txt`，`sourceText` 取最後一則 `{"type":"source"}`；無音訊不存；ID 重複加 `-2`；同時依 1.1 記用量（purpose `live`），用量寫入失敗只記 warning。驗證：`test_server` 測 spec 的 placing translated audio 範例表、10 秒輸入與兩段 3 秒譯音的檔案長度、15.4 秒譯音 `usd` 為 0.0087 且 `interpret_usage` 增加 15.4 秒、資料庫失敗時仍存檔 [after: 2.2]
- [x] 2.4 紀錄 API 只作用在本人：`GET /api/interpret/sessions`（新到舊）、`GET /api/interpret/sessions/{id}`、`GET .../{input.wav|output.wav|transcript.txt}`、`DELETE /api/interpret/sessions/{id}`，別人的 ID、不合 `^\d{8}-\d{6}(-\d+)?$` 的 ID（含 `..`）、其他檔名一律 404。驗證：`test_server` 測 t05313 讀 myyang 的紀錄得 404、路徑穿越得 404、刪除後列表不再出現 [after: 2.3]

## 3. 前端頁面

- [x] 3.1 依「前端移植測試台並改用站內樣式」由 `lab/realtime-translate/index.html` 拆出 `webapp/static/interpret.html`、`interpret.js`、`interpret.css`：套用 `tokens.css`（亮暗主題），圓角只用 radius tokens，頁首樣式同其他管理頁；未設定時顯示「尚未設定 Azure 即時口譯」並停用連線鈕。驗證：visual-tokens 的 radius 檢查（`bench/ui_polish_e2e.mjs` 或既有的 border-radius 搜尋測試）通過，亮暗兩種主題截圖人工檢視 [after: 2.1]
- [x] 3.2 The source text comes from 語橋's recognition：依「原文由瀏覽器另開 /ws/transcribe」，頁面在瀏覽器把 24 kHz 降成 16 kHz 送 `/ws/transcribe`（`mode: "translate"`，zh／auto／yue 用 `local`，其他用 `mai`），原文欄標示引擎，定稿原文以 `{"type":"source"}` 送給 `/ws/interpret`；原文連線失敗時顯示原因、翻譯繼續。驗證：`bench/interpret_e2e.mjs` 以假的 WebSocket 確認選 English 時送出 `engine: "mai"`、原文欄顯示「雲端 MAI」、`source` 訊息被送出 [after: 3.1, 2.2]
- [x] 3.3 Playing the translation aloud is optional：連線鈕旁的「同步播放譯音」勾選框（預設勾、記在 localStorage），以 GainNode 立即靜音或恢復，不影響存檔與波形。驗證：`bench/interpret_e2e.mjs` 確認取消勾選後增益為 0、重新整理後保持取消、譯音波形仍畫出 [after: 3.1]
- [x] 3.4 Saved sessions can be replayed from any point：「我的紀錄」列表（載入、原音、譯音、文字、刪除含確認）、三種重播、目前模式標示（預設整段）、點或拖動波形時紅線跟著指標、放開後依目前模式播放、播放中拖動沿用該次模式。驗證：`bench/interpret_e2e.mjs` 載入一筆紀錄，選「只聽譯音」並停止後拖到 7.6 秒，確認以 `out` 模式從約 7.6 秒播放；播放「只聽原音」時點波形仍為 `in` [after: 3.1, 2.4]

## 4. 團隊管理頁、設定與說明

- [x] 4.1 團隊管理頁（`webapp/static/admin.html`）給管理員顯示「即時口譯」連結與「即時口譯（GPT-Realtime-Translate）用量」卡片（累計時數、約多少美元、每小時單價，註明是估計、不算進 MAI 上限）。驗證：`bench/interpret_e2e.mjs` 以管理員開 `/admin` 看到連結與卡片數字，點連結到 `/interpret` [after: 1.2]
- [x] 4.2 `compose.yaml` 的 app 服務傳入 `AZURE_gpt_realtime_translate_ENDPOINT`、`_KEY`、`_DEPLOYMENT`（預設 `gpt-realtime-translate`）、`_TRANSCRIBE_DEPLOYMENT`、`INTERPRET_USD_PER_HOUR`（預設 2.04）；`.env.example` 加上變數名稱與說明（不含值）；`README.md` 說明即時口譯頁、權限、存檔位置與費用。驗證：`docker compose config` 列出這些變數，且 `git diff` 中不含任何金鑰值
- [x] 4.3 確認「與既有即時翻譯模式並存」：開會頁、即時翻譯模式與 `/ws/transcribe` 行為不變，`lab/realtime-translate/` 未被修改。驗證：完整 `test_server` 與 `node bench/translate_e2e.mjs` 通過，`lab/` 不在 git 追蹤中，改以檔案修改時間確認本 change 期間未被修改 [after: 2.4, 3.4, 4.1, 4.2]

## 5. 部署與實測

- [x] 5.1 重建 app 容器（`docker compose up -d --build app`），確認 migration 019 套用；補記測試台的翻譯用量 `python -m interpret_usage add 129 lab`（0.0731 美元換算的估計值）。驗證：`python -m interpret_usage` 印出 lab 129 秒，團隊管理頁卡片顯示約 0.07 美元 [after: 4.3]
- [x] 5.2 以 10 秒中文錄音實際連 Azure 跑一次（約 0.01 美元，先回報花費）：原文為繁體、譯文為英文、紀錄出現在「我的紀錄」、用量增加。驗證：`/api/interpret/sessions` 有新紀錄、`/api/admin/interpret-usage` 秒數增加，並請使用者用麥克風實際試用 [after: 5.1]
