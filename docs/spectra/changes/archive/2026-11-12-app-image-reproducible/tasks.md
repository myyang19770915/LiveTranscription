## 1. app image

- [x] 1.1 `webapp/Dockerfile` 複製整個 `webapp/`（新增 `webapp/.dockerignore` 排除 `__pycache__`、`*.pyc`），compose 的 app 加上以 `/api/health` 判斷的健康檢查。驗證：`docker compose build app` 成功；以剛建好的 image、不掛載原始碼執行 `python -c "import server"` 成功且 image 內有 `migrations/`；重建 app 後 `docker compose ps` 顯示 app 為 healthy、網頁登入正常。

## 2. 固定版本

- [x] 2.1 `compose.yaml` 的 `qwenllm/qwen3-asr:latest`、`ghcr.io/ggml-org/llama.cpp:server-cuda`、`ghcr.io/ggml-org/llama.cpp:server` 改為 tag@digest，digest 取自本機目前執行中容器所用的 image。驗證：`docker compose config` 的三個 image 帶 digest；`docker compose up -d` 後 asr、translate、embed 的 image ID 與修改前相同（沒有重建或換版）。
- [x] 2.2 新增 `docker/asr/constraints.txt`（目前 ASR 容器 `pip freeze --exclude-editable`），`docker/asr/entrypoint.sh` 只在 `confucius4-r2t2` 尚未以 `/workspace` 可編輯安裝時，帶 `-c` constraints 安裝。驗證：重啟 ASR 後 log 不再出現安裝訊息、`/health` 就緒、`test_asr_session` 全部通過；`bash -n docker/asr/entrypoint.sh` 通過。
- [x] 2.3 [after: 1.1, 2.1, 2.2] README 說明固定版本的位置與更新方法（pull 新版、以 `docker image inspect` 取 digest、在 ASR 容器重產 constraints、重建後跑測試）。驗證：人工審閱；`test_server` 全部通過。
