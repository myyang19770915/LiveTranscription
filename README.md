# 語橋 Live — 即時會議逐字稿與翻譯

**Language:** 繁體中文 | [English](README.en.md)

語橋 Live 是本機部署的即時會議轉錄與跨語翻譯 Web App。使用者可從麥克風、Chrome 分頁／系統聲音或兩者混合收音；左欄顯示逐字稿，右欄先顯示暫譯，語句完成後再以完整句修訂。適合單人參與線上會議、觀看影片及線上課程時使用。

產品 UI 不顯示底層模型名稱；本 README 保留模型、框架與部署細節，供維護、驗證與授權檢查。語音辨識使用 Confucius4-R2T2，文字翻譯使用本機 Gemma 4 E2B Q4_0。

> 第一次啟動需要下載 Docker image、ASR/VAD 模型與 Gemma 權重；下載後模型快取會保留在 Docker named volumes。辨識與翻譯請求在本機 Docker 網路中處理，不會送到第三方推論 API。首次下載仍會連到 Hugging Face 等模型來源。

## 功能一覽

- 即時語音逐字稿、分段即時翻譯、逐字稿複製與文字檔匯出。
- 來源可選麥克風、Chrome 分頁／系統音訊，或兩者混合；可選輸入裝置並先看音量測試。
- 可選來源語言與目標語言，也可交換方向，例如日→中、中→日、英→中、中→英。
- 中日雙向自動模式：逐輪辨識中文或日文，中文翻日文、日文翻繁體中文，並在譯文標示方向。
- 中文辨識及中文翻譯顯示為台灣繁體；原模型文字由 OpenCC `s2twp` 轉換，日文文字不會被轉換。
- 桌面雙欄；手機採逐字稿／翻譯分頁、固定會議操作列和設定視窗，支援直向與橫向；可提供姓名、品牌或專有名詞作為會議情境。
- 右上角可切換明亮／暗色主題，選擇會保存在目前瀏覽器。
- 本機 Docker 部署，不依賴雲端 ASR 或翻譯 API。

## 技術與服務架構

| 層 | 技術 | 用途 |
| --- | --- | --- |
| Web UI | 原生 HTML、CSS、JavaScript、MediaDevices、Web Audio API、AudioWorklet | 音源選擇、混音、16 kHz PCM 編碼、雙欄逐字稿與翻譯呈現 |
| Web/API | Python 3.12、FastAPI、Uvicorn、WebSocket | 靜態頁面、音訊 WebSocket 代理、翻譯 API、OpenCC 繁體轉換 |
| ASR | `qwenllm/qwen3-asr` 容器 + Confucius4-R2T2 | 以 16 kHz、單聲道 PCM 音訊串流辨識 |
| VAD | FireRedVAD Stream-VAD | ASR 服務端語音活動處理所需模型 |
| 翻譯 | Google Gemma 4 E2B-it QAT Q4_0 GGUF + `llama.cpp` CUDA server | 本機、多語文字翻譯；透過 OpenAI 相容 Chat Completions API 呼叫 |
| 執行環境 | Docker Compose、NVIDIA Container Toolkit | 管理容器、GPU、服務依賴與模型快取 |

### 部署拓樸

```mermaid
flowchart LR
  browser[Chrome 瀏覽器<br/>語橋 Live UI]
  subgraph docker[Docker Compose／本機 GPU 主機]
    app[app<br/>FastAPI + Uvicorn<br/>靜態頁面、WebSocket、翻譯 API]
    asr[asr<br/>Confucius4-R2T2 + VAD<br/>GPU 串流辨識]
    translate[translate<br/>llama.cpp + Gemma 4<br/>GPU 文字翻譯]
    asrCache[(model-cache<br/>ASR 與 VAD 權重)]
    translateCache[(translation-model-cache<br/>GGUF 權重)]
  end
  browser <-->|HTTP、WebSocket、SSE<br/>localhost:18082| app
  app <-->|內部 WebSocket<br/>asr:8272| asr
  app <-->|內部 HTTP<br/>translate:5000| translate
  asrCache --- asr
  translateCache --- translate
```

Compose 定義 `app`、`asr`、`translate` 三個服務。`asr` 與 `translate` 僅在 Compose 內網提供服務，預設只有 `app` 的主機連接埠 `18082` 對外映射；兩個 named volume 保留下載的權重。`app` 啟動時會等待另兩個服務的健康檢查通過。

### Docker image 與模型權重分別下載在哪裡

Docker image 是「執行環境」，模型權重是服務啟動時載入的「模型檔」；兩者分開下載並存放：

| Compose 服務 | Docker image / 建置方式 | 模型權重如何取得 | 定義位置 |
| --- | --- | --- | --- |
| `asr` | [`qwenllm/qwen3-asr:latest`](https://hub.docker.com/r/qwenllm/qwen3-asr)，由 Docker Hub 下載 ASR 執行環境 | 啟動 ASR server 時載入 Hugging Face 上的 `netease-youdao/Confucius4-R2T2`；entrypoint 另以 `hf download` 下載 `FireRedTeam/FireRedVAD` 的 Stream-VAD | [`compose.yaml`](compose.yaml) 的 `asr.image`；[`docker/asr/entrypoint.sh`](docker/asr/entrypoint.sh) |
| `translate` | [`ghcr.io/ggml-org/llama.cpp:server-cuda`](https://github.com/ggml-org/llama.cpp/pkgs/container/llama.cpp)，由 GitHub Container Registry 下載含 CUDA 的 llama.cpp server | llama.cpp 啟動時依 `--hf-repo`、`--hf-file` 從 Hugging Face 下載 Gemma GGUF | [`compose.yaml`](compose.yaml) 的 `translate.image` 與 `command` |
| `app` | 不使用預先發佈的專案 image；Compose 由 `build: ./webapp` 本機建置。[`webapp/Dockerfile`](webapp/Dockerfile) 以 `python:3.12-slim` 為基底，安裝 `webapp/requirements.txt` | 不下載或保存 ASR／翻譯模型；執行 FastAPI 與靜態 Web UI | [`compose.yaml`](compose.yaml) 的 `app.build`、[`webapp/Dockerfile`](webapp/Dockerfile) |

模型快取位置也分開：ASR 與 VAD 共用 `model-cache`，掛載到 ASR 容器的 `/models`，Hugging Face 快取目錄是 `/models/huggingface`；Gemma 權重使用 `translation-model-cache`，掛載至翻譯容器的 `/root/.cache`。因此一般執行 `docker compose down` 後仍會保留模型；只有 `docker compose down -v` 才會刪除這些 named volumes。

啟動順序由 Compose 管理：`docker compose up --build -d` 先準備／下載 images，啟動 `asr` 與 `translate`，兩者健康檢查成功後才啟動 `app`。ASR、VAD、Gemma 權重會在各自容器第一次啟動時下載或載入，日後重啟會使用快取。可在 [`compose.yaml`](compose.yaml) 查看 image、GPU、命令、環境變數、volume 與健康檢查的完整設定。

### 模型 serve 與程式串接位置

```mermaid
sequenceDiagram
  participant UI as Browser UI
  participant APP as app / FastAPI
  participant ASR as asr / ASR WebSocket
  participant LLM as translate / llama.cpp
  UI->>APP: PCM16 audio via /ws/transcribe
  APP->>ASR: WebSocket + secret + language header
  ASR-->>APP: streaming transcript events
  APP-->>UI: Traditional Chinese displayText
  UI->>APP: POST /api/translate/stream
  APP->>LLM: POST /v1/chat/completions (stream=true)
  LLM-->>APP: OpenAI-compatible SSE tokens
  APP-->>UI: SSE translation updates
```

- **ASR 啟動：** [`docker/asr/entrypoint.sh`](docker/asr/entrypoint.sh) 安裝專案與 Hugging Face CLI、檢查並下載 Stream-VAD，最後執行 [`ws_server.py`](ws_server.py)，並把 `ASR_MODEL_PATH` 與 `VAD_MODEL_PATH` 傳入。ASR image、環境變數、掛載路徑與健康檢查位於 [`compose.yaml`](compose.yaml) 的 `asr` 區塊。
- **Gemma 啟動：** `compose.yaml` 的 `translate.command` 啟動 llama.cpp server，`--hf-repo` 和 `--hf-file` 指定權重，`--port 5000` 在 Compose 內網提供服務。Gemma 的 GPU offload、context、parallel 與模型快取設定也都在同一個 `translate` 區塊。
- **音訊接到 ASR：** [`webapp/static/app.js`](webapp/static/app.js) 將瀏覽器音訊轉為 PCM16 並連至 `/ws/transcribe`；[`webapp/server.py`](webapp/server.py) 的 `transcribe()` 讀取瀏覽器 WebSocket，再透過 `ASR_WS_URL`（Compose 設為 `ws://asr:8272/asr_stream_api_v1`）連進 ASR 容器，轉送音訊與辨識事件。FastAPI 會加入 `ASR_SECRET_KEY` 及語言設定，並用 OpenCC 產生繁體顯示文字。
- **逐字稿接到翻譯：** `app.js` 的 `runTranslation()` 呼叫 `/api/translate/stream`；`server.py` 的 `translate_stream()` 與 `translation_payload()` 透過 `httpx` 呼叫 `TRANSLATE_URL`（Compose 設為 `http://translate:5000`）上的 `/v1/chat/completions`，逐段轉送 SSE。模型權重檔名稱則由 `TRANSLATE_MODEL` 提供。
- **Web UI 啟動：** [`webapp/Dockerfile`](webapp/Dockerfile) 建置 Python/FastAPI app image。Compose 將本機 `./webapp` 掛載到容器 `/app`；Uvicorn 以 `webapp/server.py` 的 `app` 啟動並服務靜態頁面。主機瀏覽器使用 `http://localhost:18082`，不會直接連到 ASR 或 llama.cpp。

### 會議資料流

```mermaid
flowchart TD
  mic[麥克風<br/>getUserMedia] --> mix[瀏覽器 AudioContext<br/>混音與 AudioWorklet]
  tab[Chrome 分頁／系統音訊<br/>getDisplayMedia] --> mix
  mix --> pcm[重取樣 16 kHz<br/>單聲道 PCM16]
  pcm -->|二進位音訊<br/>WS /ws/transcribe| gateway[FastAPI WebSocket 代理]
  gateway -->|內部 WebSocket| asr[Confucius4-R2T2<br/>串流 ASR]
  asr -->|辨識增量| gateway
  gateway -->|OpenCC s2twp<br/>中文轉台灣繁體| transcript[瀏覽器左欄<br/>即時逐字稿]
  transcript --> scheduler[前端分段排程<br/>短語暫譯／句尾或停頓修訂]
  scheduler -->|POST /api/translate/stream| api[FastAPI 翻譯代理]
  api -->|Chat Completions<br/>stream=true| llm[llama.cpp<br/>Gemma 4 E2B Q4_0]
  llm -->|token 串流| api
  api -->|SSE 累積譯文<br/>中文轉繁體| scheduler
  scheduler -->|每輪完成才更新<br/>保留上一版譯文| translation[瀏覽器右欄<br/>暫譯與定稿]
  transcript --> export[複製／匯出文字]
  translation --> export
```

1. 瀏覽器經使用者授權取得音訊；混合模式將兩路音訊合成。AudioWorklet 取樣，前端轉成 16 kHz 單聲道 PCM16，再透過 `/ws/transcribe` 傳送。分享畫面時只讀取音訊軌，影像不進入此資料流。
2. FastAPI 為 ASR 建立內部 WebSocket、加上服務密鑰與語言設定，並將辨識增量回送瀏覽器。中文顯示文字在服務端以 OpenCC `s2twp` 轉為台灣繁體；辨識原文不因此改寫。
3. 前端依固定節奏對新增短語要求暫譯；遇句尾標點、約 1.8 秒停頓、過長語段或結束會議時，要求完整句修訂。翻譯代理以 OpenAI 相容請求呼叫 llama.cpp，將模型 token 串流包成 SSE 回傳。
4. 前端累積每輪 SSE，完成後才原位替換右欄暫譯；修訂期間保留上一版，不逐 token 重建畫面。只有使用者原本在右欄底部附近時才自動跟隨捲動。複製與匯出使用當下可見的逐字稿與譯文。

### 主要檔案

| 路徑 | 職責 |
| --- | --- |
| [`compose.yaml`](compose.yaml) | 三個服務、GPU、健康檢查、port 與模型快取 volume |
| [`docker/asr/entrypoint.sh`](docker/asr/entrypoint.sh) | 準備 VAD 權重並啟動串流 ASR |
| [`ws_server.py`](ws_server.py)、[`r2t2/`](r2t2)、[`pyproject.toml`](pyproject.toml) | ASR WebSocket 服務、辨識模型介面與容器內安裝設定；沿用並調整自上游專案 |
| [`webapp/server.py`](webapp/server.py) | FastAPI 路由、ASR WebSocket 代理、翻譯 API 與繁體轉換 |
| [`webapp/static/app.js`](webapp/static/app.js) | 音源擷取、PCM 串流、翻譯分段排程及畫面狀態 |
| [`webapp/static/pcm-worklet.js`](webapp/static/pcm-worklet.js) | 瀏覽器音訊取樣處理器 |
| [`webapp/static/index.html`](webapp/static/index.html) 與 CSS | 語橋 Live 介面、深淺主題與雙欄排版 |
| [`webapp/test_server.py`](webapp/test_server.py)、[`smoke_test.py`](smoke_test.py) | API／代理單元測試與真實 WebSocket 音訊冒煙測試 |

### 專案範圍與上游來源

此 repo 只保留語橋 Live 執行、部署與測試所需的檔案。ASR 部分的 `ws_server.py`、`r2t2/` 與 `pyproject.toml` 來自並改作自 [Netease Youdao 的 Confucius4-R2T2 原始專案](https://github.com/netease-youdao/Confucius4-R2T2)；原始碼授權文件保留在 [`LICENSE`](LICENSE)。未使用的上游範例、`r2t2_llama/`、測試資源與大型二進位檔不收錄於此，請到上游專案查看。`r2t2_llama/` 是上游可選的 ASR 後端；本專案的 Gemma 翻譯另由 llama.cpp Docker image 提供，兩者不要混淆。

ASR 與翻譯模型權重均未上傳此 repo，部署時由各自容器下載。使用模型前請另外查閱 [Confucius4-R2T2 模型卡](https://huggingface.co/netease-youdao/Confucius4-R2T2)及[上游模型授權條款](https://github.com/netease-youdao/Confucius4-R2T2/blob/master/MODEL_LICENSE)。

## 模型介紹與語言範圍

### Confucius4-R2T2：語音辨識

使用 [Netease Youdao 的 Confucius4-R2T2](https://huggingface.co/netease-youdao/Confucius4-R2T2)，以 Qwen3-ASR 架構為基礎，針對中文和英文即時辨識最佳化。模型卡亦列舉日文、韓文、法文、德文、義大利文、葡萄牙文、俄文、西班牙文、阿拉伯文等語言。官方沒有在此專案中對 UI 列出的每一個語言／方向組合提供同等品質保證。

網頁另外提供粵語、印尼文、泰文、越南文、土耳其文、印度文、馬來文、荷蘭文、瑞典文、丹麥文、芬蘭文、波蘭文、捷克文、菲律賓文、波斯文、希臘文、羅馬尼亞文、匈牙利文和馬其頓文等選項，並標示為實驗性。這些是目前 ASR 服務介面可接受的語言提示，不代表 Confucius4-R2T2 或本專案已針對它們驗證辨識品質。

來源選單的「中英自動偵測」涵蓋此產品主要優化的中英文使用情境；其他語言建議明確指定來源。翻譯模型選單採相同語言清單，但 Gemma 4 的「35+ 種開箱支援語言」不等於所有選單語言和方向都經本專案品質驗證。低資源語言、混合語句、專有名詞與很短的片段尤其要用實際會議內容確認。

### Gemma 4 E2B-it QAT Q4_0：文字翻譯

採用 Google 發佈的 [Gemma 4 E2B-it 量化 GGUF repo](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf) 中 `gemma-4-E2B_q4_0-it.gguf`，是一個 instruction-tuned、以 QAT Q4_0 量化的文字生成模型。GGUF 權重大約 **3.35 GB**；整個 repo 約 **4.34 GB**，另含約 987 MB 的多模態 projector。本專案只做文字翻譯，透過 `--no-mmproj` 不載入 projector。實際 GPU 使用量會再包含 CUDA runtime、KV cache、上下文和 ASR，並非只等於權重檔大小。

Gemma 4 在本專案負責**逐字稿後的文字翻譯**；語音辨識由 Confucius4-R2T2 負責。模型會收到來源／目標語言、目前語句，以及最近少量翻譯上下文，並被要求只回傳譯文。短片段通常較快出結果，完整句子的翻譯品質與延遲則受 GPU、ASR 分段時機和語句長度影響。選用 E2B Q4 是為了降低單人會議的資源占用和等待；若需要更高翻譯品質，可以換大模型，但需要更多 VRAM，延遲也可能上升。

## Gemma 4 如何 serve

本專案以 [`llama.cpp` CUDA server image](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) 啟動 Gemma。主要設定位於 [`compose.yaml`](compose.yaml) 的 `translate` service：

```yaml
image: ghcr.io/ggml-org/llama.cpp:server-cuda
gpus: all
command:
  - --hf-repo
  - google/gemma-4-E2B-it-qat-q4_0-gguf
  - --hf-file
  - gemma-4-E2B_q4_0-it.gguf
  - --host
  - 0.0.0.0
  - --port
  - "5000"
  - --n-gpu-layers
  - "99"
  - --ctx-size
  - "3072"
  - --parallel
  - "1"
  - --flash-attn
  - on
  - --no-mmproj
  - --reasoning
  - "off"
  - --no-webui
volumes:
  - translation-model-cache:/root/.cache
```

第一次 Compose 啟動時，llama.cpp 會從 Hugging Face 下載指定 repo 與 GGUF 到 `translation-model-cache`，再在 GPU 上載入。`--hf-file` 明確指定 Q4_0 權重檔，避免自動挑到另一個量化；`--n-gpu-layers 99` 嘗試把模型層 offload 到 GPU；`--ctx-size 3072` 和 `--parallel 1` 將服務設定在單一會議／單一請求的使用情境；`--no-mmproj` 不載入不需要的多模態投影器；`--reasoning off` 避免翻譯前額外輸出推理文字。Compose 會把翻譯服務的健康檢查納入 app 啟動依賴。

Compose 將目前預設值抽成環境變數，可在 `.env` 指定不同的 repo 或檔案：

```dotenv
TRANSLATE_MODEL_REPO=google/gemma-4-E2B-it-qat-q4_0-gguf
TRANSLATE_MODEL_FILE=gemma-4-E2B_q4_0-it.gguf
```

若單獨啟動 llama.cpp（不經 Compose），等價的基本命令如下；要載入相同 CUDA image、使用 GPU 及保留模型快取，請使用 Docker 版本：

```bash
docker run --rm --gpus all -p 5000:5000 \
  -v gemma4-cache:/root/.cache \
  ghcr.io/ggml-org/llama.cpp:server-cuda \
  --hf-repo google/gemma-4-E2B-it-qat-q4_0-gguf \
  --hf-file gemma-4-E2B_q4_0-it.gguf \
  --host 0.0.0.0 --port 5000 \
  --n-gpu-layers 99 --ctx-size 3072 --parallel 1 \
  --flash-attn on --no-mmproj --reasoning off --no-webui
```

llama.cpp 提供 OpenAI 相容的 `POST /v1/chat/completions`。本專案的 FastAPI 服務會以 `TRANSLATE_URL=http://translate:5000` 呼叫它；UI 不會直接連到模型服務。

## 系統需求

- Windows 11/WSL2 或 Linux、Docker Desktop / Docker Engine 與 Docker Compose v2。
- NVIDIA GPU，以及已設定 GPU container runtime 的 Docker/NVIDIA Container Toolkit。Compose 使用 `gpus: all`，ASR 與 Gemma 共用可見 GPU。
- 足夠的 VRAM 和系統記憶體。`.env.example` 的 `GPU_MEMORY_UTILIZATION=0.40` 是 ASR 的 vLLM GPU 記憶體配置比例，不是整台 GPU 的保留 GB；翻譯服務會額外佔用 VRAM。模型首次下載需可連線至 Docker registry 和 Hugging Face，並預留多 GB 磁碟空間。
- 使用麥克風或系統聲音時，建議使用最新版 Chrome。瀏覽器音訊擷取需在 `localhost` 或 HTTPS 等安全來源，並由使用者在瀏覽器分享對話框中選擇及授權。

## 快速啟動

在專案根目錄使用 PowerShell：

```powershell
Copy-Item .env.example .env
```

先將 `.env` 中的 `ASR_SECRET_KEY` 改成自行產生的長隨機字串，再啟動服務：

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f asr translate app
```

第一次需要下載程式 image、ASR 權重、FireRedVAD Stream-VAD 與 Gemma GGUF；等待 `asr` 與 `translate` healthcheck 通過後，開啟 [http://localhost:18082](http://localhost:18082)。若 `APP_PORT` 在 `.env` 改過，請改用該連接埠。停止看 log 使用 `Ctrl+C`，服務本身仍會在背景執行。

## 登入與團隊

語橋 Live 給多個團隊共用：每個人用公司 LDAP 帳號登入，每場會議屬於一個團隊，**不同團隊的會議紀錄互相看不到**。

1. 在 `.env` 設定 `POSTGRES_PASSWORD`（長隨機字串）、`ADMIN_USERS`（系統管理員的 LDAP 帳號，逗號分隔）與 `LDAP_*`（見[設定參考](#設定參考)）。
2. `docker compose up -d db app`；app 啟動時自動建立或升級資料表。
3. 先驗證 LDAP 設定（密碼以不顯示的方式輸入）：
   ```powershell
   docker exec -it asr_confucius4-r2t2-app-1 python -m auth check-ldap <帳號>
   ```
4. 系統管理員登入後，從頁首「團隊管理」（`/admin`）建立團隊、加入成員。成員可以在對方第一次登入前先用帳號加入。
5. 一般使用者登入後，在「團隊」選單選擇這場會議所屬的團隊再開始。沒有任何團隊的帳號無法開始會議。

權限規則：
- 所有頁面、API 與轉錄 WebSocket 都要登入（`/api/health` 除外）；登入狀態保存 12 小時，可隨時登出。
- 同一帳號 5 分鐘內密碼錯 5 次，鎖定 5 分鐘。
- 團隊成員都能看、聽、修改自己團隊的會議；系統管理員**沒有**隱含權限，必須是該團隊成員才看得到。成員被移除後立即失效。
- 其他網站的頁面無法借用已登入的 cookie 呼叫 API 或開啟錄音。
- 會議檔案存在 `output/teams/<團隊 id>/<會議 id>/`；本功能上線前存在 `output/` 根目錄的舊檔案保持原樣，不經網頁提供。

**連不到公司 LDAP 時（開發測試）**：compose 有一個只供開發用的 OpenLDAP（profile `dev-ldap`，不對外開 port），內含測試帳號 `myyang`、`alice`、`bob`，密碼為 `yq-test-<帳號>`（見 [docker/dev-ldap/users.ldif](docker/dev-ldap/users.ldif)）：

```powershell
docker compose --profile dev-ldap up -d dev-ldap
```

`.env` 對應設定：`LDAP_URL=ldap://dev-ldap:389`、`LDAP_BASE_DN=ou=people,dc=yuqiao,dc=test`、`LDAP_BIND_DN=cn=admin,dc=yuqiao,dc=test`、`LDAP_BIND_PASSWORD` 與 `DEV_LDAP_ADMIN_PASSWORD` 相同、`LDAP_USER_FILTER=(uid={username})`。改接公司 LDAP 時換掉這幾行並 `docker compose up -d app`，再 `docker compose --profile dev-ldap rm -sfv dev-ldap` 移除測試目錄。正式環境不要啟動這個 profile。

**腳本與 benchmark**：重播、冒煙測試等腳本不放密碼，改用容器內發出的 session：

```powershell
$env:YUQIAO_SESSION = docker exec -w /app asr_confucius4-r2t2-app-1 python -m auth issue-session <帳號> --hours 12
$env:YUQIAO_TEAM = "研發部"   # 帳號只屬於一個團隊時可省略
```

## 會議使用方式

手機以 HTTPS 網址開啟後，預設顯示翻譯閱讀區；用「逐字稿／翻譯」分頁切換內容。頂部可選語言，底部的開始／結束、清除與匯出按鈕持續可見，長文字只在閱讀區內捲動。「設定」會開啟音源、麥克風測試與會議情境視窗；瀏覽器不支援的系統聲音擷取選項會停用。手機直向與橫向皆可使用，桌面維持雙欄顯示。

預設的「中日雙向自動」適合中文與日文使用者交替對話，目標語言會鎖定為「中文 ⇄ 日文」。這個模式讓 ASR 自動辨識語言，於 VAD 偵測到停頓時結束當輪發言並重設語言狀態。辨識結果攜帶語言資訊，代理優先使用中文／日文標籤；標籤缺漏或落在其他語言時，以假名／漢字和當輪語言作為備援。翻譯會依每段來源自動選擇相反語言，保留暫譯與句末修訂，跨輪內容分開處理。日文原文不會套用繁體轉換，中文譯文以 OpenCC 轉為台灣繁體。換人或換語言時請保留短暫停頓；同時說話、句內混語，以及沒有可靠語言標籤的純漢字短句，仍可能判斷錯誤。

1. 選擇「語音語言」及「翻譯成」；已知來源語言時請明確選擇。可用交換按鈕快速切換中英或日中方向。
2. 選音訊來源：
   - **麥克風**：在下方選擇裝置，例如 USB 麥克風或 MDR 耳機麥克風；先按「測試音源」並說話確認音量條活動。
   - **分頁／系統聲音**：開始後，Chrome 會開啟分享選擇器。播放 YouTube 時選影片分頁並勾選「分享分頁音訊」；桌面會議可選畫面並勾選 Chrome 提供的系統音訊選項。
   - **麥克風＋系統聲音**：同時錄入電腦端與自己的發言。建議用耳機，避免喇叭回授。
3. 可在「會議情境」輸入參與者姓名、公司、產品或專有詞彙，幫助 ASR 辨識專有名詞。
4. 按「測試音源」確認訊號，再按「開始會議」。說話時左欄顯示逐字稿，右欄先以淡色區塊顯示「暫譯」，句尾標點、約 1.8 秒停頓或結束會議後會用完整語句修訂並固定在上方。暫譯可能變動；底部按鈕可複製或匯出當前可見文字。

系統聲音由 `getDisplayMedia()` 的瀏覽器分享選擇器取得。Chrome 需要讓使用者明確挑選分頁／畫面與音訊；若選擇器沒有分享音訊，應改選可分享分頁音訊的分頁或重新選擇。即使畫面分享 API 同時回傳 video track，本專案只把音訊接入轉錄流程，不會上傳畫面影像。停止會議會關閉音訊串流；本專案不錄製或保留原始音訊。

## 會後校對

會議結束後，從頁首「會議紀錄」（`/meetings`）進入。列表只顯示你所屬團隊的會議，每場標示已校對幾段；按「校對」開啟 `/meetings/<會議 id>`，「返回會議紀錄」會回到原本的列表（篩選條件保留）。

- **會議主題**：開始會議前可在「團隊」旁填主題（選填，最多 100 字）；沒填時顯示「MM/DD HH:mm 的會議」。會後在校對頁按「修改主題」可改或清空，團隊成員都能改。
- **找會議**：列表可依團隊、建立者、開始日期區間篩選，並以關鍵字搜尋主題（不分大小寫；逐字稿內容不在搜尋範圍內）。結果依「今天」「本週」（週一起算）「更早」分組；篩選條件會寫進網址，重新整理或分享連結都會保留。

- **對照錄音**：轉錄、譯文、錄音三者用同一條時間軸。伺服器把送去辨識的同一份音訊存成 `audio.wav`，每個辨識事件附上當下的音訊位置（`audioMs`），每段因此知道自己在錄音的哪裡。點一段就播放那段；文字比聲音晚到，所以播放會往前多放 3 秒、往後 0.5 秒（`bench/lagcheck.py` 實測中日文落後中位 0.5–3.8 秒），還可以再「往前 2 秒」「往後 2 秒」。
- **修正轉錄**：按「修改原文」，改完「儲存並重譯」。重譯和會議中的精修用同一份程式（`webapp/static/translation-context.js`）：前兩段原文與譯文作上下文、附後一段開頭、會議詞彙、自動學習詞彙，可勾選雲端精修，並套用相同的防重複檢查。完成後可「一併重譯下一段」（它的前文變了）。
- **確認正確**：沒有錯的段落可直接確認，也會留下紀錄。
- **修改紀錄**：每次修改、重譯、確認都新增一筆（誰、何時、前後原文與譯文），不會覆蓋；ASR 原文永遠保留。「歷程」可查看。
- **同時修改**：兩人改同一段時，後送出的人會看到「這段已被其他人修改，已重新載入」。
- **匯出 ASR 微調資料**：會議紀錄頁選團隊與日期區間，下載 zip：每個已確認或已修改的段落一個 WAV（16 kHz 單聲道，段落本身的區間），加上 `manifest.jsonl`，每行欄位為 `audio`、`text`（修正後）、`asr_text`（原始辨識）、`language`、`engine`、`meeting_id`、`seq`、`start_ms`、`end_ms`、`edited`、`reviewed_by`。

**資料保存**：錄音在 `output/teams/<團隊 id>/<會議 id>/audio.wav`，每小時約 115 MB（16 kHz × 16 bit × 單聲道 = 32 KB/s）；段落、修改紀錄與會議詞彙在 Postgres（`segments`、`segment_history`）。本功能上線前的會議沒有段落資料，列表中顯示「沒有校對資料」。

## 會議紀要

會議紀錄列表按「會議紀要」，或在會議頁上方的分頁列切到「會議紀要」（`/meetings/<會議 id>/minutes`）；「逐字稿校對」與「會議紀要」共用同一個標頭，切換分頁不會增加瀏覽紀錄，「返回會議紀錄」回到原本篩選的列表。

- **產生紀要**：整場逐字稿（校對後的原文）一次送給紀要模型，不分段；模型整理出摘要與四類條目：決議、待辦、待確認問題、風險。15 段的會議實測約 9 秒（deepseek-v4-flash）。產生時整場逐字稿會傳送到外部模型服務，頁面會註明。
- **每條都有證據**：條目必須引用逐字稿的段落編號，點時間點會在右側開啟證據側欄，顯示引用段落與前後各一段上下文，可直接播放那段錄音，不必離開紀要頁；需要修正時按「到校對頁修正」；引用不存在段落的條目一律不採用，頁面會顯示略過幾條。
- **負責人與到期日**：負責人只能是會議所屬團隊的成員；模型提到但不在團隊裡的人名會顯示為「模型提到『小王』，不是團隊成員」，負責人保持「未指派」。到期日依會議日期換算（例如會議在 11/04 週三，「下週五」為 11/13），並保留原話。
- **人工確認**：AI 條目一開始是「待確認」。團隊成員可以改內容、類型、負責人、到期日，按「確認」或「駁回」，也可以手動新增（手動新增視為已確認）。摘要可編輯。兩人同時修改時，後送出的人會看到「這個條目已被其他人修改，已重新載入」。
- **重新產生**：只替換仍「待確認」的 AI 條目；已確認、已駁回、手動新增的條目與編輯過的摘要都保留，也不會重複產生相同內容。
- **下載 Markdown**：只包含已確認的條目，待辦附負責人與到期日，每條附錄音時間點。

**紀要模型**：`MINUTES_URL`、`MINUTES_MODEL`、`MINUTES_KEY`（OpenAI 相容），沒設定時沿用雲端精修的 `TRANSLATE_REFINE_*`。之後改用 context 更大的模型，或指向本機部署的大模型，只需修改這三個設定並 `docker compose up -d app`。

## 設定參考

| `.env` 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `APP_PORT` | `18082` | 主機上網頁/API 的 port，容器內固定為 8080 |
| `ASR_MODEL_PATH` | `netease-youdao/Confucius4-R2T2` | ASR Hugging Face repo 或相容模型路徑 |
| `ASR_SECRET_KEY` | 請自行設定 | ASR 容器間的服務密鑰；不要把預設值用於共享或公開服務 |
| `GPU_MEMORY_UTILIZATION` | `0.40` | ASR vLLM 可配置 GPU 記憶體的比例；Gemma 另外使用 GPU |
| `ASR_MAX_MODEL_LEN` | `16384` | ASR vLLM 模型最大長度設定 |
| `CUDA_VISIBLE_DEVICES` | `0` | 容器可見的 GPU device index |
| `TRANSLATE_MODEL_REPO` | Google QAT Q4_0 GGUF repo | llama.cpp 下載的模型 repo |
| `TRANSLATE_MODEL_FILE` | `gemma-4-E2B_q4_0-it.gguf` | repo 中指定的 GGUF 權重檔 |
| `TRANSLATE_REFINE_URL` / `_MODEL` / `_KEY` | 空（關閉） | 選用：OpenAI 相容的雲端模型（例如 litellm `http://host.docker.internal:4001/v1`），用於「雲端精修」；設定後頁面出現開關 |
| `AZURE_MAI_ENDPOINT` / `_API_KEY` / `_DEPLOYMENT` | 空（關閉） | 選用：Azure Foundry 的 MAI-Transcribe-2-Streaming；可填入口網站的 https 端點，程式會改用 `wss://<resource>.services.ai.azure.com/mai/v1/realtime`。設定後頁面出現「辨識引擎」選單 |
| `TRANSLATE_PUNCTUATE_MAI` | 空（關閉） | 實驗：`1` 時 MAI 中文改由雲端模型補標點（benchmark 顯示會切斷句子，預設不開） |
| `POSTGRES_PASSWORD` | 必填 | 會議資料庫 `db` 的密碼；資料庫只在 Compose 內網，不對外開 port |
| `ADMIN_USERS` | 空 | 系統管理員的 LDAP 帳號（逗號分隔），只有他們能管理團隊 |
| `LDAP_URL` | 必填 | 例如 `ldaps://ldap.example.com`；沒設定時登入回應「無法連線登入伺服器」 |
| `LDAP_BASE_DN` / `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | 空 | 搜尋後綁定：以服務帳號在 Base DN 下找出使用者，再用使用者密碼綁定 |
| `LDAP_USER_FILTER` | `(sAMAccountName={username})` | 找使用者的條件（AD 預設）；OpenLDAP 常用 `(uid={username})` |
| `LDAP_USER_DN_TEMPLATE` | 空 | 沒有服務帳號時改用直接綁定，例如 `uid={username},ou=people,dc=example,dc=com` |
| `LDAP_DISPLAY_ATTR` | `displayName` | 頁首顯示的名稱欄位 |
| `LDAP_CA_FILE` | 空 | ldaps 使用自簽 CA 時，容器內可讀到的 CA 憑證路徑 |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | 前面有 HTTPS 反向代理時，填代理的 IP，app 才會相信它轉來的 `https` |
| `MEETING_TIMEZONE` | `Asia/Taipei` | 會議列表的日期篩選、紀要的會議日期與 ASR 微調資料匯出，都以這個時區計算 |
| `MINUTES_URL` / `_MODEL` / `_KEY` | 空（沿用 `TRANSLATE_REFINE_*`） | 產生會議紀要的模型（OpenAI 相容，整場一次送出，需足夠的 context） |
| `SESSION_COOKIE_SECURE` | 空 | 以 HTTPS 對外提供時設 `1`，登入 cookie 一律加上 Secure，不會經由明文 HTTP 送出 |

**辨識引擎**（頁面選單，預設本機）：
- 本機 Confucius：音訊不離開設備。
- 混合：中文、中英、中日雙向用本機，其他語言用雲端 MAI。目前 benchmark 最佳（約 87 分，見 [bench/README.md](bench/README.md)）。
- 雲端 MAI：所有語言用 MAI；中文與日文由停頓偵測補標點。

複製 [`.env.example`](.env.example) 成 `.env` 後修改。不要將含真實密鑰的 `.env` 提交到 Git。

## 服務端點

| Endpoint | 用途 |
| --- | --- |
| `GET /` | 會議 Web App（未登入導向 `/login`） |
| `GET /api/health` | FastAPI 簡易健康檢查（不需登入） |
| `POST /api/login`、`POST /api/logout`、`GET /api/me` | LDAP 登入、登出、目前使用者與所屬團隊 |
| `GET /admin`、`/api/admin/teams…` | 團隊管理（限系統管理員） |
| `POST /api/meetings`、`GET /api/meetings`、`GET /api/meetings/{id}` | 建立會議（需指定自己的團隊）、列出與讀取自己團隊的會議 |
| `GET /meetings`、`GET /meetings/{id}` | 會議紀錄列表、會後校對頁 |
| `GET /api/meetings?team=&from=&to=&creator=&q=` | 會議列表（自己團隊）；參數皆選填：團隊 id、開始日期區間（`YYYY-MM-DD`，`MEETING_TIMEZONE` 當地日期）、建立者帳號、主題關鍵字 |
| `GET /api/meetings/creators` | 自己團隊中建立過會議的人（篩選選單用） |
| `PATCH /api/meetings/{id}` | 修改主題 `{title}`（最多 100 字，空字串＝清除） |
| `PUT /api/meetings/{id}/segments` | 會議頁保存定稿段落（依序號更新，不覆蓋已校對的段落） |
| `GET /api/meetings/{id}/audio?start=&end=` | 錄音區間（毫秒），回傳 WAV |
| `POST /api/meetings/{id}/segments/{seq}/edit`、`/translation`、`/confirm` | 修改原文、寫入重譯結果、確認正確；都帶 `version`，過期回 409 |
| `GET /api/meetings/{id}/segments/{seq}/history` | 段落的修改紀錄 |
| `GET /api/teams/{team}/asr-export?from=&to=` | 匯出 ASR 微調資料 zip |
| `GET /meetings/{id}/minutes` | 會議紀要頁 |
| `GET /api/meetings/{id}/minutes`、`POST …/minutes/generate` | 紀要內容與狀態；在背景產生（執行中 409、模型未設定 400、沒有段落 422） |
| `PATCH …/minutes/summary`、`POST …/minutes/items`、`PATCH …/minutes/items/{itemId}`、`POST …/items/{itemId}/confirm`、`…/reject` | 編輯摘要、新增、修改、確認、駁回條目（皆帶 `version`，過期回 409） |
| `GET /api/meetings/{id}/minutes.md` | 下載 Markdown 會議紀錄（只含已確認條目） |
| `PUT /api/meetings/{id}/files/{recording\|transcript}` | 儲存會議錄音或逐字稿到 `output/teams/<團隊>/<會議>/` |
| `WS /ws/transcribe` | 瀏覽器至 app 的即時 PCM 音訊 WebSocket；首包需帶 `meeting_id`，非團隊成員以關閉碼 4404 拒絕 |
| `POST /api/translate` | 請求 Gemma 文字翻譯；JSON 欄位為 `text`、`source`、`target` 和可選 `history` |
| `POST /api/translate/stream` | 串流翻譯；相同欄位加可選 `draft`，回傳 SSE `data: {"text":"...","done":false}`，完成時 `done=true` |
| ASR `ws://asr:8272/asr_stream_api_v1` | 僅供 Compose 網路中的 app 使用 |
| llama.cpp `http://translate:5000/v1/chat/completions` | 僅供 Compose 網路中的 app 使用 |

### 翻譯 API 範例

```powershell
$body = @{ text = "この会議を翻訳します。"; source = "ja"; target = "zh" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:18082/api/translate -ContentType 'application/json' -Body $body
```

## 品質優化紀錄（2026-11）

這一輪改善用 [bench/](bench/README.md) 驅動：10 段公開 YouTube 影片（英 3、日 4、中 3，每段 4 分鐘）先錄成固定的 ASR 軌，再重播進真實網頁，最後由評審依 [rubric](bench/rubric.md) 盲評（意義 45、術語 15、完整 15、流暢 15、斷句 10）。同一段影片由同一位評審同時看所有版本，分數才可比較；單支分數在不同輪次會浮動 ±5。

### 分數演進

| 階段 | 平均 | 說明 |
|---|---|---|
| Baseline（Confucius + 本機 Gemma） | 約 79 | 改善前 |
| 本機優化 v6 | 約 81.5 | 下表 1–9 項，全部本機 |
| + 雲端精修（deepseek-v4-flash） | 約 82 | 第 10 項 |
| MAI + 雲端精修 | 約 85–86 | 第 11 項；英日大幅進步，中文退步 |
| **混合（英日 MAI、中文 Confucius）+ 雲端精修** | **約 87** | 目前建議設定 |

### 改了什麼

| # | 問題 | 改法 | 程式位置 |
|---|---|---|---|
| 1 | 每段翻譯只看到自己，前後文斷裂、代名詞與術語不一致 | 帶前 2 段原文與譯文當上下文（原文 500 字、譯文 600 字上限） | `app.js` `runTranslation()`；`server.py` `translation_payload()` |
| 2 | 句子在逗號處被切，譯者不知道後半句，語意反轉 | 定稿時附上「後文」約 120 字，只供參考、不翻譯；說明放在原文之前，避免模型順手翻進來 | `app.js` `runTranslation()` 的 `following`；`server.py` `following_note()` |
| 3 | 逗號停頓太早定稿，後文還沒出現 | 逗號結尾的停頓要等後面至少 8 個字才定稿 | `segmentation.js` `settled()` |
| 4 | ASR 同音錯字被照翻（城市設計→程式設計、農藥→尼古丁） | 翻譯規則說明原文是 ASR：同音錯字若與上下文矛盾，翻成原本想說的詞；假設語氣與問句保持原樣 | `translation_quality.py` `policy()` |
| 5 | s2twp 把一般詞改成 IT 用語（迴圈、擴充套件、演演算法） | 繁簡轉換改用 `s2tw`（只轉字，不轉詞） | `server.py` `TO_TRADITIONAL` |
| 6 | 日文長時間沒有標點，整段變成 300 字的文字牆 | 超過 90 字改在句號或敬體句尾切；超過 160 字才在普通動詞後、新詞開頭處切 | `segmentation.js` `plan()` 的 `ja-loose`／`ja-plain` |
| 7 | 定稿後才聽到下一句，前一句的翻譯無法修正 | 第 N+1 句定稿後，背景帶前後文重譯第 N 句（延遲精修） | `app.js` `queueRefinement()`、`correctNext()` |
| 8 | 精修把前後句的譯文重複翻進本句 | 精修結果太長，或含有鄰句譯文的開頭或結尾時，丟棄並保留原譯 | `app.js` `plausibleRefinement()` |
| 9 | 按停止後，結尾的最後幾句被切成碎片 | 收尾等待從 10 秒延長到 20 秒 | `app.js` `stopMeeting()` |
| 10 | 本機 Gemma 26B 的翻譯能力有上限 | 選用「雲端精修」：延遲精修改送 OpenAI 相容的雲端模型；推理型模型需要額外 token 空間，否則回傳空白 | `server.py` `translation_backend()`；頁面開關 `#cloudRefine` |
| 11 | 日文與英文的 ASR 錯字是最大扣分 | 新增 Azure MAI-Transcribe-2-Streaming 當第二個辨識引擎；可選本機、混合或 MAI | `mai_asr.py`；`server.py` `asr_engine()`、`TranscriptDisplay`；頁面選單 `#asrEngine` |
| 12 | MAI 的中文和日文不輸出標點，也沒有伺服器端 VAD | 本機能量 VAD 在停頓 0.4 秒時送 commit，依停頓長短補上「。」或「，、」；英文由 MAI 自己加標點，中途不送 commit（送了會在句中補句號） | `mai_asr.py` `PauseDetector`、`MaiBridge.close_item()` |
| 13 | 補上的標點落到下一段開頭（「、しかし」） | 段落開頭的標點歸給前一句 | `app.js` `runTranslation()` |
| 14 | 斷句點位置以舊文字長度計算，補標點改寫目前段落後就會錯位 | 改在套用 `displayText` 之後才記錄斷句點 | `app.js` `onMessage()` 的 `markEnd` |
| 15 | Azure 偶爾回 `service_unavailable` | 自動重連，最多 5 次；斷線期間的音訊會遺失 | `mai_asr.py` `MaiBridge.mai_to_queue()` |
| 16 | 中文 MAI 停頓規則補的標點不夠準 | 實驗：改由雲端模型加標點，只採用標點、不改字。實測模型會在話還沒講完時加「。」切斷句子，中文從 80.7 降到 73.7，所以預設關閉 | `server.py` `punctuate_item()`；`mai_asr.py` `merge_marks()`；`TRANSLATE_PUNCTUATE_MAI` |

### 還沒解決的

- 剩下的扣分大多來自 ASR 錯字，例如 unsupervised 聽成 supervised、WeWork 聽成 Uiwak、陳屍浴室聽成沉屍於世；以及翻譯模型對成語和雙關的理解。
- 台語（閩南語）不在 MAI 的支援清單上。實測 MAI 和 Confucius 都只能辨識一部分；MAI 開自動偵測時甚至會輸出緬甸文。台語請選「中文」，並使用本機或混合模式。
- 印尼語 MAI 錯字率 4.4%（Confucius 6.8%），可以使用。

## 驗證與日常維護

健康檢查與日誌：

```powershell
Invoke-RestMethod http://localhost:18082/api/health
docker compose ps
docker compose logs --tail 100 app asr translate
```

執行 FastAPI 代理單元測試：

```powershell
docker compose exec -T app python -m unittest -v test_server
```

測試使用 `db` 中另一個資料庫 `yuqiao_test`（自動建立、每個測試前清空），LDAP 以 ldap3 的模擬伺服器代替，不會連到公司 LDAP。

執行本機 WAV WebSocket smoke test（需要 Python 專案環境、`websockets` 套件，以及自行準備的 16 kHz／單聲道／16-bit PCM WAV）：

```powershell
$env:YUQIAO_SESSION = docker exec -w /app asr_confucius4-r2t2-app-1 python -m auth issue-session <帳號> --hours 1
python smoke_test.py --audio C:\path\to\sample-16k-mono.wav
```

常用容器操作：

```powershell
docker compose restart app
docker compose down
```

`docker compose down` 會停止並移除容器，但**保留** ASR 與翻譯模型快取。`docker compose down -v` 會刪除 named volumes 中的模型快取，下一次啟動必須重新下載；只有確定要清掉模型時才使用。

## 疑難排解

- **服務等很久或健康狀態未通過**：首次啟動需下載大型權重；看 `docker compose logs -f asr translate`。確認 Hugging Face 網路可用、磁碟空間足夠，再查看 `docker compose ps`。
- **GPU out of memory**：ASR 與 Gemma 同時用同一張卡。先確認沒有其他 GPU 工作；降低 `GPU_MEMORY_UTILIZATION`、ASR max model length 或翻譯 context，並避免同時執行其他大型模型。縮小 ASR 配額可降低它的配置量，但也可能影響吞吐。
- **Chrome 沒有麥克風或裝置選單空白**：在網址列的網站權限中允許麥克風，再重新載入頁面；確認 Windows 輸入裝置沒有停用，並在網頁選中 MDR 對應的麥克風（MDR 藍牙耳機通常會以一個或多個輸入端點顯示）。音量測試條會協助確認瀏覽器實際收到訊號。
- **YouTube／線上會議沒有聲音**：需在 Chrome 分享選擇器明確勾選分享分頁音訊或系統音訊。僅分享畫面不會提供音訊。系統和 Chrome 版本會影響可選範圍；可先在「音訊來源」選「分頁／系統聲音」測試。
- **轉錄延遲或短語句不完整**：ASR 的串流分段與模型推論會影響文字到達時機。新字形成短語後約 250 ms 發出暫譯；每輪暫譯完成後才原位更新，不會逐 token 重建畫面。句尾標點、約 1.8 秒停頓或過長語段會觸發完整句修訂；修訂期間保留上一版可讀譯文。單一會議只保留一個正在執行的翻譯請求，較新的完整句會取代未完成的暫譯請求。背景噪音、過短句子與多人重疊說話仍會降低品質。
- **翻譯沒有更新**：查看 `docker compose logs -f translate app`；確認 `translate` healthcheck 通過。先以中英、日中等方向測試，再排查其他實驗性語言。
- **CSS/JavaScript 看起來仍是舊版**：強制重新整理瀏覽器（`Ctrl+Shift+R`）。靜態資源 URL 有版本參數，以避免一般快取使用舊檔。

## 隱私與授權

此 app 以 LDAP 登入並依團隊隔離會議紀錄（見[登入與團隊](#登入與團隊)）；讓其他裝置或網際網路存取時，仍需在前面加上 HTTPS（登入密碼與 session cookie 會經過網路），並做好網路存取控制。啟動時下載模型會連線至外部 registry／Hugging Face；推論請求則留在本機 Docker 網路。請自行確認 ASR 模型、Gemma 4、`llama.cpp` 與相依套件的授權條款符合你的使用方式；Gemma 4 QAT repo 的模型卡標示 Apache-2.0，仍應以實際下載檔案隨附的 license 為準。

## 參考資料

- [Confucius4-R2T2 模型卡](https://huggingface.co/netease-youdao/Confucius4-R2T2)
- [Google Gemma 4 E2B-it 模型卡](https://huggingface.co/google/gemma-4-E2B-it)
- [Google Gemma 4 E2B-it QAT Q4_0 GGUF repo](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf)
- [llama.cpp server 文件](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [MDN：`getDisplayMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [上游 Confucius4-R2T2 簡體中文模型說明](https://github.com/netease-youdao/Confucius4-R2T2/blob/master/README.zh.md)
