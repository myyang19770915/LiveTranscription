## 1. 閘道器

- [x] 1.1 spec「Translation requests go to a keyed external service when configured」三個情境與「Term discovery asks an external model for a JSON object」：`webapp/server.py` 讀 `TRANSLATE_KEY`、`TRANSLATE_EXTRA`，以一個函式把送往本機翻譯模型的請求轉成外部服務的請求（金鑰、移除 llama.cpp 專用欄位、併入 EXTRA），用在串流翻譯與修補、`/api/translate`、`/api/terms`；`/api/terms` 在外部服務時改用 `json_object` 並在系統訊息附上結構；`/api/config` 回 `cloudTranslate`。完成時：設了金鑰的草稿請求帶 `Authorization` 與 EXTRA、沒有三個 llama.cpp 欄位；沒設金鑰時請求與現在相同；精修請求仍送 `TRANSLATE_REFINE_URL`。驗證：`webapp/test_server.py` 的 `WebAppTests` 新增 `test_a_keyed_translation_service_…`、`test_single_sentence_translation_and_repair_…`、`test_term_discovery_asks_a_keyed_service_…`、`test_translate_extra_…`；測試模組載入時把翻譯與精準模式的設定固定成未設定，不受容器 `.env` 影響。
- [x] 1.2 spec service-status「Service readiness endpoint」的「Translation health URL」範例表：`/api/services` 的翻譯檢查改用 `TRANSLATE_HEALTH_URL`（未設定時 `TRANSLATE_URL` + `/health`）。驗證：`test_server.py` 新增測試比對表中兩列的檢查網址。

## 2. 隱私標示

- [x] 2.1 spec privacy-notice「The live page states where audio and text go」的範例表與「External translation with the local engine」情境：`PrivacyNote.text(engine, refine, quality, cloudTranslate)` 依表回傳；`webapp/static/app.js` 把 `/api/config` 的 `cloudTranslate` 傳入；更新 `index.html` 的資源版本號。驗證：`bench/privacycheck.js` 加入表中新增的五列，`node bench/checks.js` 全過；`/api/config` 讀取失敗時視為外部翻譯、讀到之前顯示「資料去向／確認中…」，以 `bench/privacy_e2e.mjs`（真實瀏覽器攔截 `/api/config`）確認四種情況。

## 3. 部署與文件

- [x] 3.1 [after: 1.1, 1.2] `compose.yaml`：`app` 傳入 `TRANSLATE_URL`、`TRANSLATE_MODEL`（可由 .env 覆寫，預設值不變）、`TRANSLATE_KEY`、`TRANSLATE_EXTRA`、`TRANSLATE_HEALTH_URL`，不再 `depends_on` `translate`；`translate` 加上 profile `local-translate`；新增 `qwen-asr` 服務（與 `asr` 同一個映像檔，`qwen-asr-serve Qwen/Qwen3-ASR-1.7B`，profile `qwen-asr`，權重放在 `model-cache`）。`.env.example` 與 `README.md` 說明本機翻譯與雲端翻譯兩種設定、Qwen3-ASR 的啟用方式與顯示卡記憶體需求。驗證：`docker compose config` 成功；`README.md` 的設定表有新增的變數。
- [x] 3.2 [after: 3.1, 2.1] 全部單元測試通過（`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server`）與 `node bench/checks.js` 全過。
