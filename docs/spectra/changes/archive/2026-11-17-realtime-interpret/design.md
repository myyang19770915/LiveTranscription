## Context

即時口譯測試台 `lab/realtime-translate/` 是一支獨立的 FastAPI 程式（`server.py` + `index.html`），跑在開發機的 127.0.0.1:8770：

- 從本機 `.env` 讀 Azure 金鑰，直接代理到 Azure GPT-Realtime-Translate。
- 原文是「伺服器回連語橋 `/ws/transcribe`」取得的：用 `docker exec` 幫 t05313 發一張 session token，再把 16 kHz 音訊送進去。
- 紀錄存在 `lab/realtime-translate/sessions/`，花費記在 `costs.jsonl`。

使用者確認測試台可用，要整併進語橋。使用者的決定（2026-11-17）：

- 只開放系統管理員。
- 紀錄只有本人看得到。
- 翻譯花費併入現有用量紀錄，但不算進 MAI 的 50 美元上限。
- 測試台的舊紀錄留在 lab，不搬。

語橋現況：

- 頁面權限用 `team_access.Admin`，沒有權限的頁面回 `FORBIDDEN_PAGE`。
- 會議檔案放在 `output/teams/<team>/<meeting>/`（`team_access.OUTPUT_DIR`）。
- MAI 用量是 `mai_usage` 模組加上 `mai_usage` 表（day, purpose, seconds），團隊管理頁有一張用量卡片。
- `/ws/transcribe` 有翻譯模式（`mode: "translate"`）：不建會議、不留紀錄，MAI 用量以 purpose `live` 計。
- 同一使用者同時最多 `MAX_STREAMS_PER_USER`（預設 2）條串流。
- 中文轉繁體有 `TO_TRADITIONAL`（OpenCC s2tw）；口譯的 `zh` 譯文改用 `TO_TAIWAN`（OpenCC s2twp，連用詞一起換成台灣說法，並修正「明瞭」被誤轉），因為 spec 要求「这个软件」→「這個軟體」，s2tw 做不到。

## Goals / Non-Goals

**Goals:**

- 管理員在語橋裡的 `/interpret` 就能做到測試台的所有功能：
  - 選音源、說話語言、輸出語言；
  - 同步播放譯音可關；
  - 波形、三種重播、點或拖動波形依模式播放；
  - 個人紀錄可載入、下載、刪除。
- 金鑰只在伺服器，經 `compose.yaml` 傳入 app 容器。
- 翻譯花費記進資料庫，團隊管理頁看得到。

**Non-Goals:**

- 不開放給一般成員，也不放進頁首導覽（不改 site-navigation 的連結規則）。只從團隊管理頁進入；要開放給成員另提 change。
- 不改開會頁、既有的即時翻譯模式和 `/ws/transcribe` 的行為。
- 不把口譯結果變成會議紀錄，不進逐字稿校對、紀要、搜尋、問答。
- 不支援選聲音或術語表：模型沒有這些參數（實測 `session.audio.output.voice` 等都回 Unknown parameter）。
- 不搬測試台的舊紀錄，也不刪 `lab/realtime-translate/`。
- 不做自動清除舊紀錄，由使用者自己在頁面刪除。
- 不處理英文譯文偶爾缺空格的問題：那是模型輸出本身的樣子。

## Decisions

### 原文由瀏覽器另開 /ws/transcribe

頁面同時開兩條連線：

- `/ws/interpret`：24 kHz，給 Azure 翻譯。
- `/ws/transcribe` 翻譯模式：16 kHz，給本機 Confucius 或 MAI 辨識原文。

辨識結果由頁面顯示，並把最新的定稿原文用 `{"type":"source"}` 交給 `/ws/interpret` 存檔。

- 這樣重用了既有的辨識、MAI 計量、串流上限與存取檢查，伺服器不用自己回連。
- 測試台的回連做法要替使用者發 session token，在系統內是多此一舉。
- 另一個做法是在 `/ws/interpret` 內直接驅動 `TranscriptDisplay`，但要拆 `/ws/transcribe` 的大函式，風險高，也就不採用。

代價是一次口譯占兩條串流名額。

### 口譯紀錄以檔案存在 output/interpret/<帳號>/

每次口譯存成一個資料夾（`input.wav`、`output.wav`、`session.json`、`transcript.txt`），跟會議檔案一樣放在 `output/` 底下，不進資料庫：

- 列表直接讀資料夾即可。
- 刪除就是刪資料夾。
- 只有本人能讀寫，路徑以登入帳號決定，不接受瀏覽器給的帳號。
- 紀錄 ID 用正規式驗證，防止路徑穿越。

### 翻譯用量用新表 interpret_usage

新增 migration `019_interpret_usage.sql`，結構與 `mai_usage` 相同（day, purpose, seconds），依 team-accounts / 資料表結構以版本化 SQL migration 管理 的做法自動套用。模組 `interpret_usage` 提供 `record`、`summary`、`GET /api/admin/interpret-usage` 和 `python -m interpret_usage`。

- 不併入 `mai_usage` 表：那張表和它的 50 美元上限都只算 MAI，使用者要求翻譯不算進上限。
- 分表後，兩邊的規則可以各自演進。

### 翻譯費用依譯音秒數計

單價是使用者提供的「GPT-Realtime-Translate Global Output 每小時 2.04 美元」，所以以收到的譯音長度（PCM 位元組 ÷ 48000）計，存在 `INTERPRET_USD_PER_HOUR`，預設 2.04。金額是估計，不是帳單。

### 只開放系統管理員，紀錄只給本人

- 頁面、WebSocket、API 都用 `team_access` 的管理員檢查。
- 紀錄 API 一律以 `user.username` 決定資料夾。
- 別人的 ID 回 404，不洩漏是否存在。

### 與既有即時翻譯模式並存

live-translation / 翻譯模式的連線 規定翻譯模式不建會議、不留紀錄，這次不改：口譯頁仍以翻譯模式辨識原文，`/ws/transcribe` 不存任何東西。存檔只發生在新的 `/ws/interpret`，屬於新功能，不違反那個決定。

### 前端移植測試台並改用站內樣式

`interpret.html`、`interpret.js`、`interpret.css` 由測試台的 `index.html` 拆出：

- 套用 `tokens.css`（含亮暗主題；與團隊管理頁相同，不另外載入 `themes.css`），圓角用 radius tokens（visual-tokens 規則）。
- 頁首用其他管理頁的樣式。
- 瀏覽器負責把 24 kHz 的麥克風音訊降成 16 kHz，送給 `/ws/transcribe`。

## Implementation Contract

**行為：**

- 管理員打開 `/interpret`：
  - 能連線、說話，聽到或不聽譯音，看到原文與譯文。
  - 按中斷後紀錄出現在「我的紀錄」，可載入重播、下載、刪除。
- 團隊管理頁：
  - 有「即時口譯」連結；
  - 有翻譯用量卡片（累計小時數、約多少美元、每小時單價）。
- 一般成員打不開頁面，也連不上 WebSocket。

**介面：**

- `GET /interpret`：管理員 200，成員 403 沒有權限頁，未登入轉登入頁。
- `GET /api/interpret/config` → `{"configured": bool, "usdPerHour": 2.04, "targets": [58 個代碼]}`。不含端點與金鑰。
- `WS /ws/interpret`：
  - 啟動訊息 `{"target","sourceLang"}`。
  - 之後是二進位 24 kHz PCM16，或文字 `{"type":"source","text"}`、`{"type":"stop"}`。
  - 送給瀏覽器的訊息：
    - `{"type":"status","state":"connected"}`
    - `{"type":"audio","audio"}`
    - `{"type":"out","delta"}`
    - `{"type":"status","state":"closed","saved":<id|null>,"usd"}`
    - `{"type":"error","message"}`
  - 關閉碼：4401 未登入、4403 非管理員、4400 語言不支援、4408 沒有啟動訊息、4413 超過時長、4429 串流數已滿、4503 未設定。
- 紀錄 API：
  - `GET /api/interpret/sessions` → `[{id,startedAt,target,sourceLang,engine,inputSeconds,outputSeconds,usd,preview}]`
  - `GET /api/interpret/sessions/{id}` → session.json
  - `GET /api/interpret/sessions/{id}/{input.wav|output.wav|transcript.txt}`
  - `DELETE /api/interpret/sessions/{id}`
- 用量：
  - `GET /api/admin/interpret-usage` → `{seconds, usd, usdPerHour, byPurpose}`
  - `python -m interpret_usage [add <seconds> <purpose>]`
- 環境變數（compose.yaml 的 app 服務）：
  - `AZURE_gpt_realtime_translate_ENDPOINT`、`AZURE_gpt_realtime_translate_KEY`、`AZURE_gpt_realtime_translate_DEPLOYMENT`（預設 `gpt-realtime-translate`）
  - `AZURE_gpt_realtime_translate_TRANSCRIBE_DEPLOYMENT`（選填）
  - `INTERPRET_USD_PER_HOUR`（預設 2.04）

**失敗情況：**

- Azure 連不上：送 `{"type":"error"}` 後關閉，不存檔，不記用量。
- 用量寫不進資料庫：記 warning，照樣存檔。
- 原文連線失敗：頁面顯示原因，翻譯照常。
- 存檔失敗：記 error，`saved` 為 null，頁面顯示「存檔失敗」。

**驗收：**

- `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全過。新測試用假的 Azure 上游涵蓋：
  - 權限：4401、4403、403、404；
  - 語言檢查（4400）；
  - zh 轉繁；
  - 存檔內容與譯音位置；
  - 只能讀寫自己的紀錄；
  - 用量寫入與金額。
- `node bench/interpret_e2e.mjs` 在瀏覽器驗證：
  - 頁面權限；
  - 同步播放譯音勾選框；
  - 載入紀錄、三種重播與拖動波形依模式播放；
  - 團隊管理頁的入口與用量卡片。
- 部署後由使用者實際用麥克風連一次。真的連 Azure 只跑一段（約 0.01 美元）。

**範圍：** 包含上述頁面、API、用量、compose 設定與說明文件。不含頁首導覽、成員開放、會議整合、舊紀錄搬移。

## Risks / Trade-offs

- [一次口譯占兩條串流名額，預設上限 2] → 管理員同時在開會時無法再開口譯，頁面會顯示 4429 的原因；必要時可調 `MAX_STREAMS_PER_USER`。
- [原文是瀏覽器轉交的] → 管理員自己可以改原文內容，但只影響自己的紀錄，可以接受。
- [付費服務被長時間開著] → 只限管理員；4 小時上限；花費在頁面上即時顯示，團隊管理頁看得到累計。
- [錄音含個人語音] → 只有本人看得到，可以刪除；`output/` 不進 git。
- [模型行為：輸出中文為簡體、說話語言就是目標語言時可能不翻] → 伺服器轉繁體；頁面註明一次只能翻成一種語言。

## Migration Plan

1. 套用程式後重建 app 容器（`docker compose up -d --build app`）；migration 019 會在啟動時自動執行。
2. `.env` 已有 `AZURE_gpt_realtime_translate_*`（使用者自行設定），不需改 `.env`。
3. 補記測試台已花的翻譯用量：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m interpret_usage add 129 lab`。129 秒是 costs.jsonl 的翻譯金額 0.0731 美元 ÷ 2.04 × 3600 換算的估計值，前兩筆是估計，不是帳單。MAI 部分當時就經過語橋 `/ws/transcribe`，已經記在 MAI 用量，不需補記。
4. 回復方式：移除 router 掛載即可。`interpret_usage` 表與 `output/interpret/` 留著不影響其他功能。
