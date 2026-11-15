## 1. 手機設定區只剩語言列

- [x] 1.1 （Requirement: Narrow screens keep the settings dialog unchanged）手機寬度（760px 以下）時 `#qualityRow` 與 `#cloudRefineRow` 一樣搬進設定對話框，排在「雲端精修」之後，回到寬螢幕時搬回 `#refineGroup` 原位（`webapp/static/app.js` 的 `mobileSettingsNodes`）；手機寬度時 `.controls > .hint-stack` 與 `.controls > .refine-group` 不顯示（`webapp/static/mobile.css`），設定區格線只有 3 欄 1 列。驗證：`bench/ui_polish_e2e.mjs` 新增的檢查——390px 即時翻譯模式下語音語言、翻譯成各寬至少 120px 且同一列、設定區內沒有精準模式、對話框依序有辨識引擎／雲端精修／精準模式；調到 1280px 後精準模式回到 `#refineGroup`。

## 2. 非安全連線時說明麥克風無法使用

- [x] 2.1 （Requirement: Insecure page explains the microphone is unavailable）新增 `mediaUnavailable()`：非安全連線回傳「需要 https 連線才能使用麥克風」，安全連線但沒有 `navigator.mediaDevices.getUserMedia` 回傳「此瀏覽器不支援麥克風」，否則為空。`requestMicrophone()` 與 `requestDisplayAudio()` 在呼叫媒體 API 前先檢查，丟出的錯誤訊息為該說明加上建議：非安全且為沒有連接埠的主機名稱時，列出 `https://` 加上目前的 hostname、路徑、查詢字串；IP 或有連接埠時改為「請改用 https 網址，或在這台電腦上以 localhost 開啟」；`toggleMicTest()` 的錯誤狀態改顯示這段說明；頁面載入與 `updateSourceUI()` 在沒有測試中的音源時也顯示它（`webapp/static/app.js`）。驗證：`bench/ui_polish_e2e.mjs` 以 `--host-resolver-rules` 把 `asr.example.test` 指到本機、用 http 開啟，檢查載入後的狀態文字、有連接埠時的提示不列網址、以攔截轉送模擬 80 埠時提示為 `https://asr.example.test/?team=3`、分享音訊選項停用、頁面沒有出現 `undefined is not an object`；localhost 移除 getUserMedia 時說明不支援；localhost 按測試音源仍接上假麥克風；390px 從對話框開始會議送出精準模式與引擎設定。
- [x] 2.2 靜態資源版本：`webapp/static/index.html` 中 `app.js` 與 `mobile.css` 的 `?v=` 改為新版本，手機瀏覽器不會用到舊檔。驗證：開會頁 HTML 中 `app.js`、`mobile.css` 的網址帶新版本字串。

## 3. 文件與回歸

- [x] 3.1 `bench/README.md` 的 ui_polish_e2e 說明補上新檢查的範圍；`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全數通過，`bench/ui_polish_e2e.mjs` 全數通過。驗證：兩個指令的輸出。
