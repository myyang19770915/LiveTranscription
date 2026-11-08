## Why

開會頁右上角的狀態膠囊平常只寫「系統待機」，圓點是灰色。它只反映這一頁有沒有在錄音，不會檢查後端服務；語音辨識或翻譯服務沒開時照樣顯示「系統待機」，要按下「開始會議」才會變紅。使用者希望打開頁面就知道服務有沒有準備好：都正常時顯示「服務就緒」，有服務沒開時直接變紅。

## What Changes

- 新增 `GET /api/services`（需登入）：同時檢查本機語音辨識（ASR 容器的 `/health`）、翻譯（翻譯容器的 `/health`）與資料庫（`SELECT 1`），每項最多等 2 秒，回傳 `{"ready": bool, "services": [{"key", "name", "ok"}]}`；名稱只用「語音辨識」「翻譯」「資料庫」，不出現模型名稱。
- 開會頁在沒有進行中的會議時，載入後立即檢查一次，之後每 30 秒檢查一次（分頁在背景時暫停，回到前景立即檢查）：
  - 全部正常：圓點亮起（主色、不閃爍），文字「服務就緒」。
  - 有服務沒回應：圓點與文字變紅，文字「語音辨識服務未啟動」；多項時「語音辨識、翻譯服務未啟動」；滑過顯示建議（請確認 Docker 服務已啟動）。
  - 檢查請求本身失敗（app 本身連不上）：紅色「無法連線到伺服器」。
- 會議或即時翻譯進行中不檢查，狀態維持「即時轉錄中／即時翻譯中」；結束後顯示的「會議已結束」或錯誤訊息保留到下一次檢查（最多 30 秒）再換成服務狀態。
- README 端點表與「狀態」說明更新。

## Non-Goals (optional)

- 不檢查雲端服務（Azure MAI、雲端精修）：它們在外部，打 API 會產生費用與延遲；選雲端引擎時仍只在開始後才知道錯誤。
- 不檢查說話者辨識與問答索引服務：它們不影響開會與即時翻譯。
- 不在服務未就緒時停用「開始會議」按鈕：使用者可能只用雲端引擎，或服務剛好正在啟動。
- 不改其他頁面（會議紀錄、校對頁等）的頂列。

## Capabilities

### New Capabilities

- `service-status`: 開會頁在待機時顯示後端服務（語音辨識、翻譯、資料庫）是否就緒，以及檢查用的 `/api/services` 端點。

### Modified Capabilities

(none)

## Impact

- Affected specs: service-status（新增）
- Affected code:
  - Modified: webapp/server.py（`/api/services`、`service_ok`、`database_ok`）、webapp/static/app.js（定期檢查與狀態顯示）、webapp/static/styles.css 或 refine.css（就緒狀態樣式）、webapp/static/index.html（資產版本號）、webapp/test_server.py、bench/translate_e2e.mjs、README.md
- API：新增 `GET /api/services`；既有 `/api/health` 不變。
