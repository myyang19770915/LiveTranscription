## Why

Azure MAI-Transcribe-2-Streaming 依音訊長度計費（每小時 0.54 美元）。2026-11-14 起精準模式固定用 MAI 處理中文以外的語言，即時辨識也可以選 MAI，但系統完全沒有記錄送了多少音訊給 MAI。使用者要求記錄使用金額，自 2026-11-14 起累計超過 50 美元時要被告知、由他決定是否繼續。

## What Changes

- 每條送音訊給 MAI 的連線（即時辨識的 MAI 引擎、精準模式的 MAI 連線）把實際送出的音訊秒數累加到資料庫，依日期與用途分列；只記秒數，不記任何內容、會議或使用者。長時間的連線每累積 5 分鐘音訊就寫入一次，連線結束時寫入剩餘的部分。
- 系統管理員可以在「團隊管理」頁上方看到 MAI 的累計用量：小時數、換算金額、上限、是否接近（八成）或超過上限；資料來自新的管理員 API。
- 累計金額第一次達到八成與達到上限時，各在伺服器日誌記一次警告。超過上限不會自動停用 MAI，由管理員決定。
- 評測腳本直接連 MAI、不經過 app 的用量，以指令手動登記：`python -m mai_usage add <秒數> <用途>`；`python -m mai_usage` 印出累計。
- 單價與上限是設定值：`MAI_USD_PER_HOUR`（預設 0.54）、`MAI_BUDGET_USD`（預設 50）。

## Non-Goals (optional)

- 不自動停用或限制 MAI：使用者要的是被告知後自己判斷。
- 不寄信或推播通知：先以管理頁與日誌提示。
- 不讀取 Azure 的實際帳單；金額是「送出的音訊秒數 × 單價」的估計。
- 不記錄每場會議或每位使用者的用量。
- 不計其他雲端模型（DeepSeek 等）的費用：那些由 litellm 記錄。

## Capabilities

### New Capabilities

- `mai-usage`: 記錄送給 Azure MAI 的音訊長度並換算累計金額，讓管理員看到是否接近或超過上限

### Modified Capabilities

(none)

## Impact

- 新增 webapp/mai_usage.py、webapp/migrations/018_mai_usage.sql
- 修改 webapp/mai_asr.py、webapp/chunk_asr.py、webapp/quality_pass.py、webapp/server.py、webapp/static/admin.html、webapp/test_server.py
- 修改 compose.yaml、.env.example、README.md
- 資料庫新增一張表 mai_usage（日期、用途、秒數）
