## Why

`lab/realtime-translate` 的即時口譯測試台（Azure GPT-Realtime-Translate：說話後直接出譯音與譯文）已經驗證可用，但它是放在本機、用自己的伺服器跑，只有開發機上看得到，金鑰也從本機 `.env` 讀。要讓管理員在語橋裡直接用、紀錄跟著帳號走、花費進到系統的用量紀錄，需要把它整併進語橋。

## What Changes

- 新增「即時口譯」頁 `/interpret`，只開放給系統管理員；一般成員打開會看到「沒有權限」，未登入會被導到登入頁。團隊管理頁（`/admin`）加一個進入連結。
- 新增 `/ws/interpret`：伺服器代理到 Azure `/openai/v1/realtime/translations`，金鑰只留在伺服器（`AZURE_gpt_realtime_translate_ENDPOINT`／`_KEY`／`_DEPLOYMENT`，選填 `_TRANSCRIBE_DEPLOYMENT`）；`compose.yaml` 傳入這些變數。輸出中文時轉成台灣繁體。
- 原文：頁面同時用既有的 `/ws/transcribe` 翻譯模式辨識原文（中文、中英混合、粵語走本機 Confucius，其他語言走 Azure MAI），顯示在「原文」欄，並交給伺服器一起存檔。
- 頁面功能照測試台：音源（麥克風／分頁音訊）、說話語言、輸出語言（模型支援的 57 種）、「同步播放譯音」勾選框（不勾只看譯文，照樣存檔）、即時波形、三種重播（整段／只聽譯音／只聽原音），點或拖動波形從該處依目前模式播放。
- 每次中斷自動存檔到 `output/interpret/<帳號>/<紀錄 ID>/`（原音、譯音、原文、譯文、花費）；頁面下方「我的紀錄」可載入、重播、下載、刪除，只看得到也只能刪自己的。
- 花費：翻譯依譯音長度每小時 2.04 美元（`INTERPRET_USD_PER_HOUR`），記進資料庫新表 `interpret_usage`；團隊管理頁的用量區多一張「即時口譯（GPT-Realtime-Translate）」卡片。原文走 MAI 的部分照原本的 MAI 用量紀錄累計（含 50 美元上限），翻譯不算進 MAI 上限。
- 提供 `python -m interpret_usage add <秒數> <用途>` 手動補記；整併後把測試台已花的翻譯用量補記一次。

## Non-Goals

（寫在 design.md 的 Goals / Non-Goals。）

## Capabilities

### New Capabilities

- `realtime-interpret`: 管理員用的即時口譯頁：Azure GPT-Realtime-Translate 代理、原文辨識、個人存檔與重播、翻譯花費紀錄。

### Modified Capabilities

（無。既有的即時翻譯模式、開會頁、MAI 用量規則都不變；新頁面重用既有辨識連線的翻譯模式，不改它的行為。）

## Impact

- 新增程式：webapp/interpret.py（頁面、WebSocket 代理、紀錄 API、存檔）、webapp/interpret_usage.py（翻譯用量）、webapp/migrations/019_interpret_usage.sql、webapp/static/interpret.html、webapp/static/interpret.js、webapp/static/interpret.css
- 修改：webapp/server.py（掛上 router）、webapp/static/admin.html（入口連結與翻譯用量卡片）、compose.yaml（傳入 Azure 翻譯變數與 `INTERPRET_USD_PER_HOUR`）、.env.example（變數說明，不含值）、README.md（功能說明）
- 測試：webapp/test_server.py（假的 Azure 上游）、bench/interpret_e2e.mjs（瀏覽器端）
- 外部服務：Azure GPT-Realtime-Translate（付費，每小時約 2.04 美元）；原文走 MAI 時另計 MAI 費用
- 資料：output/interpret/ 會存放管理員的錄音與文字
- `lab/realtime-translate/` 保留不動，仍可單獨在本機使用
