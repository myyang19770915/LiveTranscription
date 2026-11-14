## Why

顯示卡（32 GB）放不下三個模型：即時辨識（Confucius4）、本機翻譯模型（Gemma 26B，約 15 GB）與精準模式要常駐的 Qwen3-ASR 1.7B（約 10 GB）。2026-11-14 的盲評中，精準模式以 Qwen3-ASR 做第二次辨識得 92 分，現況 82–83 分，使用者決定讓 Qwen3-ASR 常駐、停用本機翻譯模型，翻譯草稿與定稿改由雲端的 `deepseek-v4-flash` 產生。目前閘道器的翻譯請求只會送到本機 llama.cpp：不帶金鑰、帶 llama.cpp 專用參數、詞彙學習用 `json_schema` 格式（DeepSeek 不支援），隱私標示也假設翻譯在本機。

## What Changes

- 新增設定 `TRANSLATE_KEY`：有值時，`TRANSLATE_URL`／`TRANSLATE_MODEL` 指的是外部的 OpenAI 相容服務。翻譯草稿、定稿、單句翻譯與詞彙學習的請求帶上金鑰、拿掉 llama.cpp 專用參數，並併入 `TRANSLATE_EXTRA`（JSON，例如關閉推理）。
- 詞彙學習在外部服務時改用 `json_object` 格式，並在提示中附上要回傳的 JSON 結構。
- 新增設定 `TRANSLATE_HEALTH_URL`：服務狀態改檢查這個網址（未設定時維持 `TRANSLATE_URL` + `/health`）。
- `/api/config` 多回 `cloudTranslate`；開會頁的隱私標示在翻譯走外部服務時，一律說明文字會傳送到外部。
- `compose.yaml`：本機翻譯模型（`translate`）改為選用的 profile `local-translate`，`app` 不再等它；新增以 profile `qwen-asr` 啟用的 `qwen-asr` 服務（`qwen-asr-serve`，Qwen3-ASR 1.7B）供精準模式使用。
- `README.md`、`.env.example` 說明兩種部署方式（本機翻譯／雲端翻譯）與 Qwen3-ASR。

## Non-Goals (optional)

- 不改「雲端精修」的行為：它仍是另一組設定（`TRANSLATE_REFINE_*`），勾選時定稿後再精修一次。
- 不改會議紀要、問答的模型設定（各有自己的變數）。
- 不做本機與雲端翻譯模型的自動切換或備援：外部服務失敗時與現在本機模型失敗時一樣，保留原文並顯示錯誤。
- 不移除本機翻譯模型的支援：沒有設定 `TRANSLATE_KEY` 時行為與現在完全相同。
- 精準模式的隱私說明仍寫「音訊與文字會傳送到外部服務」，即使第二次辨識在本機；改成依設定區分是另一個變更。

## Capabilities

### New Capabilities

- `cloud-translation`: 翻譯模型可以是需要金鑰的外部 OpenAI 相容服務

### Modified Capabilities

- `privacy-notice`: 翻譯走外部服務時，標示一律說明文字會傳送到外部
- `service-status`: 翻譯服務的檢查網址可用 `TRANSLATE_HEALTH_URL` 指定

## Impact

- 修改 webapp/server.py、webapp/static/privacy-note.js、webapp/static/app.js、webapp/static/index.html
- 修改 webapp/test_server.py、bench/privacycheck.js
- 修改 compose.yaml、.env.example、README.md
- 正式環境的 .env 只動 TRANSLATE_* 行；切換時本機翻譯模型停用，所有會議的譯文文字會送到外部服務
