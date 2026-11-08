## Context

開始會議時 app.js 先 `POST /api/meetings` 建立會議，再以 `meeting_id` 開 `/ws/transcribe`；伺服器以 `team_access.require_member` 確認會議屬於使用者的團隊，並把送往 ASR／MAI 的音訊寫進 `audio.wav`，辨識事件附上 `audioMs`。逐字稿與段落由瀏覽器定期 `PUT /api/meetings/<id>/files/*` 與段落 API 存回。譯文顯示在 `#translation`（`renderTranslation()`：定稿 `translated` 與暫譯 `draftText`），原文在 `#transcript`。

## Goals / Non-Goals

- 目標：同一頁多一個「不留紀錄」的用法；字幕能浮在最上層。開會模式零改動。
- 不做：透明疊層、翻譯紀錄、手機上的浮動字幕（Document PiP 只有桌機 Chrome／Edge）。

## Decisions

### 模式切換

`.controls` 第一列是 `#modeRow`：兩顆按鈕「開會」「即時翻譯」（`aria-pressed`），選擇記在 `localStorage.liveMode`。`body.translate-mode` 時：`#setupMeeting`、`#teamRow`、`#topicRow`、`#seriesRow`、`#seriesPanel` 隱藏（`.controls.translate` 的 `grid-template-areas` 不含這幾列，與既有「沒有進階列」的 `:has()` 變體組合）；開始按鈕文案「開始翻譯／即時轉錄與翻譯」，結束後狀態「翻譯已結束」；頁首狀態「即時翻譯中」。手機上 `#modeRow` 搬進設定視窗最上方（加進 `mobileSettingsNodes`）。會議進行中不能切換模式（和其他設定一樣鎖住）。

**替代方案**：另開一頁 `/translate`。捨棄原因：音源、語言、翻譯、精修邏輯全在 app.js，複製一份會分岐；同頁切換也符合使用者「在這頁增加」的要求。

### 翻譯模式的連線

app.js 在翻譯模式不呼叫 `createMeeting`、`MeetingSeries.started/ended`，`meetingId` 為空，連線標頭多 `mode: "translate"`。伺服器：`mode == "translate"` 時跳過 `require_member`，`audio = None`，`TranscriptDisplay(language, glossary, None)`（既有程式已容許 `audio` 為 None：不附 `audioMs`，MAI 不寫檔），`finally` 不呼叫 `finish_recording`。沒有 `mode` 的標頭維持原本的 4404 流程。登入（4401）與同源檢查不變。

瀏覽器端：`storeTranscript`、`storeSegments` 本來就在沒有 `meetingId` 時直接返回；`stopRecording` 的 `storeMeetingFile` 改為翻譯模式時略過伺服器儲存、不顯示「無法存到 output」，錄音留在瀏覽器，「會議錄音」下載按鈕照常出現。匯出檔名前綴改為 `translate-`（以開始時的模式為準，結束後切換模式不影響）。頁尾的儲存說明隨模式改為「不存到伺服器，可按匯出下載」。

### 浮動字幕（subtitles.js）

`Subtitles.open()` 以 `documentPictureInPicture.requestWindow({width: 760, height: 180})` 開視窗，載入 `/assets/tokens.css` 與 `/assets/subtitles.css`（複製目前主題的 `data-theme`），內容：工具列（「原文」切換、A−、A+、關閉）、貼齊底部的 `.sub-body`（放不下時先掉最舊的字）內有 `.sub-source`（最近一句原文，預設隱藏）、`.sub-text`（最近兩句定稿譯文）、`.sub-draft`（暫譯，較淡）。`Subtitles.update({source, translation, draft})` 由 `renderTranslation()` 與 `render('transcript', …)` 呼叫；「最近兩句」以 `。！？` 與換行切句，`!?.` 只在後面接空白或結尾時才算句尾（3.5、U.S. 不切開），取最後兩句。設定 `{source: false, size: 2}`（字級 1–4：28／34／40／48px）記在 `localStorage.subtitles`。視窗 `pagehide` 時按鈕回到未開啟；頁面關閉時視窗一起關閉（瀏覽器行為）。`documentPictureInPicture` 不存在時按鈕 `disabled`，`title`「需要桌面版 Chrome 或 Edge 116 以上」。

**替代方案**：把字幕畫到 canvas 再用影片子母畫面（支援 Firefox／Safari）。捨棄原因：文字不可選、不能有切換按鈕、需持續重繪；需要時可再加為退路。

### 驗證

- 單元測試：`mode: "translate"` 的連線在 FakeUpstream 下收到辨識事件、事件沒有 `audioMs`、`meetings` 表沒有新列、`output/teams` 下沒有新檔；非任何團隊成員也能連；沒有 `mode` 且沒有會議仍是 4404。
- e2e `bench/translate_e2e.mjs <16k wav> <dir>`：切到即時翻譯後欄位隱藏、按鈕文案；以假麥克風開始 8 秒；逐字稿出現；結束後 `/api/meetings` 數量不變；匯出逐字稿觸發下載。浮動字幕：以 `addInitScript` 把 `documentPictureInPicture.requestWindow` 替換成 `window.open` 的彈出視窗，檢查彈出視窗內有譯文、切換原文、A+ 改字級、關閉後按鈕復原；沒有該 API 時按鈕停用。

## Implementation Contract

- 開會模式：`bench/catalog_e2e.mjs`、`bench/series_e2e.mjs` 與全部單元測試結果不變。
- 翻譯模式：伺服器不新增任何列或檔案；`/ws/transcribe` 在翻譯模式仍拒絕未登入（4401）與跨站（4403）。
- 字幕視窗內容與主頁 `#translation` 的最後兩句一致，暫譯以不同樣式顯示。

## Risks / Trade-offs

- [使用者在翻譯模式誤以為有存檔] -> 狀態列與結束提示寫明「不會存到伺服器，可按匯出下載」。
- [Document PiP 只有 Chromium] -> 按鈕停用時說明；其他瀏覽器仍可用主頁的翻譯欄。
- [`mode` 標頭被濫用來繞過團隊檢查] -> 翻譯模式沒有任何會議資料可讀寫，只是把音訊送去辨識並回傳；與開會的差別只在「不存」。

## Migration Plan

純前端與一個 WebSocket 標頭欄位，無資料庫變更。

## Open Questions

無。
