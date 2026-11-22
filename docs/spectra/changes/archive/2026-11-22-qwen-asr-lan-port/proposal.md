## Why

區網內的其他系統也想使用本機的 Qwen3-ASR 1.7B 語音辨識（`qwen-asr` 服務，vLLM 的 OpenAI 相容 API），但目前它只在 Compose 內網提供，主機上沒有開連接埠，外部系統連不到。

## What Changes

- `compose.yaml` 的 `qwen-asr` 服務加上 `ports: "${QWEN_ASR_PORT:-18000}:8000"`，主機所有網卡的 18000（可用 `.env` 的 `QWEN_ASR_PORT` 改）轉到容器內 vLLM 的 8000。只有以 `--profile qwen-asr` 啟動時才開。
- 服務上方的註解說明：這個連接埠沒有驗證，只給區網用。
- `README.md` 更新：
  - 「服務架構」段落原本寫「除了 `app` 的 18082，其他服務都只在 Compose 內網」，改為也列出 `qwen-asr` 的 18000。
  - 新增一小節「給其他系統使用 Qwen3-ASR」：呼叫方式（`POST http://<主機 IP>:18000/v1/audio/transcriptions`，multipart 欄位 `model=Qwen/Qwen3-ASR-1.7B`、`file`，附 curl 範例）、`GET /v1/models` 檢查；沒有驗證所以只能在受信任的區網使用，不要把它接到 Cloudflare Tunnel 或路由器轉發；Windows 防火牆需允許 18000 的入站連線（只開「私人」網路設定檔）；其他系統的請求與語橋精準模式共用同一張顯示卡，大量請求會讓精準模式變慢。
  - 環境變數表加一列 `QWEN_ASR_PORT`，預設 `18000`。

## Non-Goals

- 不加 API key 或反向代理驗證：使用者決定只限區網、靠區網與防火牆隔離（2026-11-22 對話）。之後若要開給區網外，需另提變更加驗證。
- 不開放 `asr` 服務（Confucius4-R2T2 串流 WebSocket）：使用者只選了 `qwen-asr`。
- 不改 `.env`：專案慣例 `.env` 只改 `TRANSLATE_*` 行，用 compose 的預設值 18000 即可。
- 不限制其他系統的請求量或排隊：目前只在文件中說明共用顯示卡的影響。
- 不改 Cloudflare Tunnel：`tunnel` 只在 `edge` 網路，`qwen-asr` 不在該網路，維持現狀即可。

## Impact

- Affected specs: none
- Affected code:
  - New: (none)
  - Modified: compose.yaml, README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes。語橋網頁行為不變；`qwen-asr` 仍以 `http://qwen-asr:8000/v1` 給 app 使用，只是多了主機連接埠。主機 18000 若被占用，`qwen-asr` 會啟動失敗，需在 `.env` 設 `QWEN_ASR_PORT` 換埠。
