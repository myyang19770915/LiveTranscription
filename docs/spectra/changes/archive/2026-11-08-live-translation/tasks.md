## 1. 伺服器：翻譯模式的連線

- [x] 1.1 `/ws/transcribe` 接受 `mode: "translate"`（webapp/server.py）：不檢查會議、`audio` 為 None、事件沒有 `audioMs`、`finally` 不收尾錄音；沒有 `mode` 的標頭維持 4404 流程。驗證：webapp/test_server.py 新增測試——翻譯模式在 FakeUpstream 下收到事件且沒有 `audioMs`、`meetings` 無新列、`output/teams` 無新檔、不屬於任何團隊的使用者也能連；既有 4404、4401、跨站 403 測試不變；`python -m unittest -q test_server` 全部通過。（Translate-only sessions：Translate handshake stores nothing、Meeting handshake unchanged）

## 2. 頁面：模式切換與翻譯流程

- [x] 2.1 即時會議頁的「開會／即時翻譯」切換（index.html `#modeRow`、app.js `liveMode`、refine.css `.controls.translate` 的格子、mobile.css 設定視窗）：翻譯模式隱藏團隊、主題、系列與系列面板，按鈕「開始翻譯」，不建會議、連線帶 `mode: "translate"`、錄音與逐字稿不存伺服器但可下載，會議中鎖住切換；設定記在瀏覽器 [after: 1.1]。驗證：bench/translate_e2e.mjs（新）以假麥克風跑一段：欄位隱藏、按鈕文案、`/api/meetings` 數量不變、匯出逐字稿觸發下載、重新整理後模式仍是即時翻譯；bench/catalog_e2e.mjs 與 bench/series_e2e.mjs 仍通過（開會模式不變）。（Translate-only sessions：Translating a video、User without a team）

## 3. 浮動字幕

- [x] 3.1 webapp/static/subtitles.js、subtitles.css：`Subtitles.open/close/update`，Document PiP 視窗顯示最近兩句譯文與暫譯，原文切換與四段字級記在 `localStorage.subtitles`，視窗關閉後按鈕復原，不支援時按鈕停用並說明；app.js 的 `renderTranslation()` 與 `render('transcript')` 呼叫 `Subtitles.update`，頁尾加「浮動字幕」按鈕 [after: 2.1]。驗證：translate_e2e 以替身 `documentPictureInPicture` 檢查視窗內容、原文切換、A+、關閉復原、無 API 時停用；「最近兩句」的切句以 `Subtitles.lastSentences` 在 e2e 內用 Example 表的資料檢查。（Floating subtitles window）
- [x] 3.2 README（即時翻譯模式、浮動字幕與瀏覽器限制）、bench/README（translate_e2e）、docs/roadmap.md 更新 [after: 3.1]。驗證：內容檢查。
