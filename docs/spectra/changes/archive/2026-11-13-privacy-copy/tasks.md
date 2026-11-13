## 1. 隱私標示

- [x] 1.1 spec「The live page states where audio and text go」的範例表：新增純函式模組 `webapp/static/privacy-note.js`，`PrivacyNote.text(engine, refine)` 回傳 `{label, sentence}`，六種組合與範例表一致，未知的引擎值視為 `local`。驗證：新增 `bench/privacycheck.js`，`node bench/privacycheck.js` 六列全部印出 ok、exit 0。
- [x] 1.2 [after: 1.1] spec「The live page states where audio and text go」的「Engine changed before a meeting」與「No claim of on-device processing」情境：`webapp/static/index.html` 的頁首標示與頁尾第一段文字改由 `webapp/static/app.js` 以 `PrivacyNote.text(asrEngine(), 雲端精修是否勾選且可見)` 填入，在讀完 `/api/config` 套用記住的選擇後、以及引擎或雲端精修變更時更新；頁首副標改為「多語即時逐字稿與翻譯。」、meta description 改為「即時多語會議逐字稿與翻譯。」；會議模式的儲存說明改為「錄音與逐字稿存入會議紀錄」；存檔失敗提示改為「無法存入會議紀錄（原因），改為下載」；譯文空狀態改為「譯文會顯示在這裡」、翻譯狀態「READY」改為「就緒」；更新 `app.js` 的資源版本號並載入 `privacy-note.js`。驗證：以瀏覽器（gstack browse，`http://localhost:18082`）登入後確認頁首顯示「自架主機」，以腳本把引擎改成 `mai` 並觸發 change 後顯示「雲端辨識／音訊會傳送到 Azure」；在 `webapp/static/index.html`、`webapp/static/app.js`、`webapp/static/login.html` 搜尋「不離開你的設備」「端對端本機處理」「output 資料夾」「Translation appears here」皆無結果。

## 2. 登入頁

- [x] 2.1 spec「The sign-in page shows no real account name」：`webapp/static/login.html` 帳號欄 placeholder 改為「公司帳號」。驗證：`webapp/test_server.py` 的 `SignedOutTests` 新增測試，`/login` 的內容含 `placeholder="公司帳號"` 且不含 `myyang`。

## 3. 整體驗證

- [x] 3.1 [after: 1.2, 2.1] `bench/README.md` 若引用了舊文字則一併更新；全部單元測試通過：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 結果為 OK，且 `node bench/privacycheck.js` exit 0。
