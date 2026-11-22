## 1. 開放 qwen-asr 主機連接埠

- [x] 1.1 `compose.yaml` 的 `qwen-asr` 服務加上 `ports: "${QWEN_ASR_PORT:-18000}:8000"`，並在服務註解寫明「沒有驗證，只給區網」。驗證：`docker compose --profile qwen-asr config` 顯示 `qwen-asr` 的 published 18000 → target 8000；`docker compose --profile qwen-asr up -d qwen-asr` 後 `docker compose ps qwen-asr` 顯示 `0.0.0.0:18000->8000/tcp` 且 healthy。
- [x] 1.2 [after: 1.1] 主機可以實際辨識：`curl http://localhost:18000/v1/models` 回傳含 `Qwen/Qwen3-ASR-1.7B`；以 multipart（`model=Qwen/Qwen3-ASR-1.7B`、`file=` 一段 16 kHz wav）`POST http://<主機區網 IP>:18000/v1/audio/transcriptions` 回 200 且 JSON 有 `text`。另確認語橋網頁 `GET http://localhost:18082/api/health` 仍回 `{"status":"ok"}`（app 對 `http://qwen-asr:8000/v1` 的連線不受影響）。

## 2. 文件

- [x] 2.1 [after: 1.1] `README.md` 服務架構段落不再寫「只有 app 對主機開埠」，改為同時列出 `qwen-asr`（profile `qwen-asr`）的主機連接埠 18000；環境變數表加 `QWEN_ASR_PORT`（預設 `18000`）。驗證：內容檢查，搜尋 README 中「18000」出現在架構段落與環境變數表。
- [x] 2.2 [after: 2.1] `README.md` 新增小節「給其他系統使用 Qwen3-ASR」，寫明：呼叫網址與 multipart 欄位、curl 範例、`/v1/models` 檢查方式；沒有驗證只限受信任區網，不可接到 Cloudflare Tunnel 或路由器轉發；Windows 防火牆只對「私人」設定檔開 18000 入站；其他系統的請求與精準模式共用顯示卡、大量請求會拖慢精準模式；18000 被占用時改 `QWEN_ASR_PORT`。驗證：內容檢查，並照小節裡的 curl 範例實際執行一次成功（與 1.2 相同結果）。
