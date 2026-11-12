## Why

部署環境目前無法可靠地重建：
- `webapp/Dockerfile` 只複製 `server.py` 與 `static/`，漏掉 `auth.py` 等其他模組與 `migrations/`。app 能跑，是因為 `compose.yaml` 把整個 `webapp/` bind mount 進容器；換一台機器只用 image 就無法啟動。
- `qwenllm/qwen3-asr:latest`、`llama.cpp:server-cuda`、`llama.cpp:server` 是會變動的 tag，下一次 `docker compose pull` 可能拉到行為不同的版本。
- `docker/asr/entrypoint.sh` 每次啟動都以 `pip install -e /workspace` 重新安裝，而且 `fireredvad`、`sanic` 等依賴沒有版本限制，套件更新後同一份程式可能裝到不同的版本。
- app 服務沒有健康檢查。

## What Changes

- `webapp/Dockerfile` 複製整個 `webapp/`（新增 `webapp/.dockerignore` 排除快取檔），image 本身就能執行；compose 的 bind mount 保留給開發。
- `compose.yaml`：
  - 三個浮動 tag 改為「tag@digest」，固定在目前執行中的版本（`docker image inspect` 取得，與目前容器使用的 image ID 相同，行為不變）；
  - app 加上 `/api/health` 健康檢查。
- 新增 `docker/asr/constraints.txt`：以目前 ASR 容器的 `pip freeze` 產生。`entrypoint.sh` 只在 `confucius4-r2t2` 尚未以 `/workspace` 安裝、或 `pyproject.toml`／`constraints.txt` 內容改變時才安裝，安裝時用這份 constraints 固定版本。
- README 說明如何更新這些固定版本（重新 pull、取 digest、重產 constraints）。

## Non-Goals

- 不建立 image registry 或發版流程。
- 不升級任何套件或 image 版本。
- 不移除開發用的 bind mount。

## Impact

- Affected specs: none
- Affected code:
  - New: webapp/.dockerignore, docker/asr/constraints.txt
  - Modified: webapp/Dockerfile, compose.yaml, docker/asr/entrypoint.sh, README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes（固定在目前版本，執行中的服務行為不變）
