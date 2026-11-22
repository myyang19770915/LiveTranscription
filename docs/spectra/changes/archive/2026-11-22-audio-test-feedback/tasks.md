## 1. 測試先行

- [x] 1.1 新增 `bench/audio_test_e2e.mjs`（Playwright，`--use-fake-device-for-media-stream`、`--use-fake-ui-for-media-stream`，以 `YUQIAO_SESSION` 登入，不開始會議、不寫資料庫）：(a) 來源「麥克風」按測試音源，2.5 秒內 `#micStatus` 可見、在 `#testMic` 內、文字以「訊號正常」開頭；(b) 來源「分頁／系統聲音」時，以 `addInitScript` 讓 `navigator.mediaDevices.getDisplayMedia` 回傳假麥克風的串流（含音訊軌），按測試音源後同樣可見並為「訊號正常」；(c) 以 `addInitScript` 讓擷取回傳靜音串流（`AudioContext` 的 `createMediaStreamDestination`，不接任何來源），5.5 秒後狀態為規格 Example 表中該來源的文字且有 `error` class；(d) 未測試時選「分頁／系統聲音」，`#micStatus` 仍可見。驗證：在改程式前執行 `node bench/audio_test_e2e.mjs`，(a)–(d) 中與可見性、靜音提示相關的檢查如預期 `FAIL`。

## 2. 介面

- [x] 2.1 [after: 1.1] 實作「Audio test result is always visible」：`webapp/static/index.html` 把 `.mic-health`（`#micStatus` 加 `aria-live="polite"`、`#micTestLevel`）從 `.mic-field` 移進 `#testMic` 按鈕作為第三行；`webapp/static/app.js` 的 `toggleMicTest` 在測試開始 5 秒後若從未超過訊號門檻，以 `setMicStatus(..., 'error')` 顯示規格 Example 表的文字，之後超過門檻改回「訊號正常：…」，`stopMicTest` 清除這個計時。驗證：`node bench/audio_test_e2e.mjs` 全部 `ok`。
- [x] 2.2 [after: 2.1] `webapp/static/refine.css` 調整按鈕內狀態列（`styles.css` 的顏色與 `mobile.css` 的字級沿用）：音量條為按鈕內容全寬、高 4px，狀態文字過長時以省略號截斷；`index.html` 調高 `app.js` 與 `refine.css` 的快取版本號。驗證：`bench/audio_test_e2e.mjs` 另存桌面 1280、窄螢幕 1000、手機 390 寬的測試中截圖到 `docs/spectra/changes/audio-test-feedback/evidence/`，目視確認不溢出、不截斷按鈕主標題。
- [x] 2.3 [after: 2.1] 確認既有行為不變：`bench/ui_polish_e2e.mjs` 中 `#micStatus` 相關檢查（https 說明、不支援麥克風）通過；`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過。
