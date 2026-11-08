## Context

開會頁（`webapp/static/index.html`、`app.js`）右上角的 `#status` 膠囊由 `setStatus(text, kind)` 控制，kind 有 `idle`（灰點）、`live`（主色閃爍）、`error`（紅）。目前只在開始、進行中、結束與出錯時更新，待機時永遠是「系統待機」。後端有不需登入的 `/api/health`，只回 `{"status":"ok"}`，不檢查任何下游服務。

下游服務各自有健康端點（compose.yaml 的 healthcheck 使用同一路徑）：ASR 容器 `http://asr:8272/health`（模型載入後回 200 `{"status":"ready"}`），翻譯容器 `http://translate:5000/health`（llama.cpp，載入中回 503）。從 app 容器實測兩者回應時間 0.02 秒與 0.004 秒。

## Goals / Non-Goals

**Goals:**

- 待機時，狀態膠囊顯示開會與即時翻譯需要的本機服務是否就緒，沒就緒時直接變紅並說明是哪一項。

**Non-Goals:**

- 雲端服務（MAI、雲端精修）、說話者辨識、問答索引不檢查。
- 服務沒就緒時不擋「開始會議」。
- 其他頁面不顯示服務狀態。

## Decisions

### 新端點 /api/services 需登入，/api/health 維持原樣

`/api/health` 不需登入，給 Docker 與外部監控使用；若讓它回報下游服務，未登入的人就能探測內部服務狀態。新端點走既有登入中介層（`/api/*` 預設需登入），回應只含服務的通用名稱與是否正常。

### 三項檢查並行，每項逾時 2 秒

`asyncio.gather` 同時檢查 ASR、翻譯、資料庫；HTTP 檢查用 `httpx.AsyncClient(timeout=2.0)`，只有 HTTP 200 算正常，連線失敗、逾時、非 200 都算未就緒（翻譯模型載入中的 503 會顯示為未就緒，符合「還不能用」）。整體最慢約 2 秒，不需要快取：每個開著的開會頁每 30 秒只打一次。

### ASR 健康網址由 ASR_WS_URL 推得，可用 ASR_HEALTH_URL 覆寫

`ws://asr:8272/asr_stream_api_v1` → `http://asr:8272/health`（`wss` → `https`）。部署若把 ASR 放到不同路徑，可設 `ASR_HEALTH_URL`。

### 待機才檢查，30 秒一次，分頁在背景時暫停

前端只在沒有進行中的會議（`stream` 為空）且不在啟動流程時更新狀態。`visibilitychange` 回到前景時立即檢查。會議結束後的訊息（「會議已結束」或錯誤）保留到下一次排定的檢查，不立刻覆蓋。

### 就緒用主色實心圓點，不閃爍

新增 kind `ready`：圓點為 `--accent` 實心、文字用一般文字色；與 `live`（主色閃爍）區分。未就緒沿用 `error` 的紅色。

## Implementation Contract

- **Behavior**：登入後打開開會頁，服務都正常時右上角約 1 秒內顯示主色圓點與「服務就緒」；停掉翻譯容器後，最多 30 秒（或切回分頁時立即）變為紅色「翻譯服務未啟動」；滑過膠囊顯示「請確認 Docker 服務已啟動」。會議進行中顯示不變。
- **Interface**：`GET /api/services` → 200 `{"ready": true, "services": [{"key": "asr", "name": "語音辨識", "ok": true}, {"key": "translate", "name": "翻譯", "ok": true}, {"key": "database", "name": "資料庫", "ok": true}]}`；順序固定 asr、translate、database。未登入 → 401（既有中介層）。`server.service_ok(url) -> bool`、`server.database_ok() -> bool` 供測試替換。
- **Failure modes**：下游錯誤一律轉成 `ok: false`，端點本身不回 5xx；前端 fetch 失敗或非 200 時顯示紅色「無法連線到伺服器」；401 時導向登入頁（與其他 API 一致）。
- **Acceptance**：`test_server` 新增測試（全部正常、單項失敗、多項失敗、未登入 401、ASR 健康網址推導）；`bench/translate_e2e.mjs` 以 `page.route` 假造 `/api/services` 回應，檢查就緒文字與 kind、未就緒時紅色與文字、會議進行中不被覆蓋；真實服務下開頁顯示「服務就緒」。
- **Scope**：`webapp/server.py`、`webapp/static/app.js`、狀態樣式、`index.html` 版本號、測試、README。不改 `/api/health`、其他頁面、雲端服務。

## Risks / Trade-offs

- 只用雲端引擎（MAI）的部署若沒開本機 ASR，會一直顯示紅色「語音辨識服務未啟動」，雖然仍可開會。→ 目前部署都有本機 ASR；若日後有純雲端部署，再依 `mai` 設定調整檢查項目。
- 每個開著的頁面每 30 秒多 3 個輕量請求 → 健康端點實測都在 0.02 秒內，負擔可忽略。
