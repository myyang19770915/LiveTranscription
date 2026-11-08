## Why

即時翻譯的浮動字幕目前是 Document Picture-in-Picture 視窗（live-translation）。使用者實際用它看 YouTube 時希望字幕是半透明、能調透明度、直接疊在影片畫面上；但 Chrome 的 Document PiP 視窗本身一定不透明（瀏覽器限制，沒有透明視窗的選項），再怎麼調底色都看不到後面的影片。

選「分頁／系統聲音」或「麥克風＋系統聲音」當音訊來源時，`getDisplayMedia` 本來就一併給了該分頁的影像軌（`app.js` 的 `captureStreams[0]` 含 video track，目前沒有用到）。把這個畫面放大顯示在本站頁面上、字幕以半透明底色疊在上面，就能做到真正的半透明、可調透明度、可拖曳位置與全螢幕；使用者改看本站分頁（或全螢幕）即可。

## What Changes

- 頁尾新增「畫面＋字幕」按鈕（`#overlay`）。按下後以全視窗覆蓋層（`#screenView`）用 `<video muted autoplay playsinline>` 顯示分享的分頁畫面，字幕框（`.overlay-subs`）疊在畫面上。
- 字幕框內容與浮動字幕相同：最近兩句定稿譯文、暫譯（較淡）、可切換顯示最近一句原文、A−／A+ 四段字級；切句用 `subtitles.js` 的 `lastSentences`，原文開關與字級與浮動字幕共用同一份設定（`localStorage.subtitles`），兩邊改了另一邊也跟著變。
- 新增「背景透明度」滑桿 20–100%（預設 55%，只改字幕框底色的 alpha，文字不變），值記在 `localStorage.overlay`。
- 字幕框可用滑鼠或觸控拖曳到任意位置；位置以覆蓋層寬高的百分比記在 `localStorage.overlay`，下次開啟套用，超出畫面時夾回可見範圍。
- 工具列有「全螢幕」（Fullscreen API，對覆蓋層本身）與「關閉」；Esc 也關閉（全螢幕時 Esc 先離開全螢幕，是瀏覽器行為）。
- 沒有影像軌時（純麥克風來源，或尚未開始）按鈕停用、`title`「需要分頁／系統聲音來源」；工作階段結束（停止、分享中斷）時覆蓋層自動關閉並回到停用。
- 覆蓋層只在本機顯示影像軌，不錄影、不上傳；開會模式與即時翻譯模式都可用。
- `bench/translate_e2e.mjs` 新增檢查；README 補說明。

## Non-Goals (optional)

- 不讓 Document PiP 視窗透明（瀏覽器做不到）；PiP 視窗維持原樣，不加底色深淺。
- 不把分享的畫面錄下來或送到伺服器；不改 `/ws/transcribe`。
- 不做字幕描邊／陰影等字體樣式調整（使用者只要調背景）。
- 不支援手機（手機沒有分頁分享，按鈕與頁尾一起隱藏，與浮動字幕相同）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `live-translation`: 新增 Requirement「Screen view with subtitles」：畫面＋字幕覆蓋層的內容、透明度、拖曳、全螢幕、停用條件與結束時關閉。

## Impact

- webapp/static/app.js：`startMeeting` 成功後把 `captureStreams` 的影像軌交給 overlay（`window.Overlay?.setTrack(track)`），`stopMeeting` 時 `window.Overlay?.setTrack(null)`（關閉覆蓋層並停用按鈕）。
- webapp/static/overlay.js（新增）：`window.Overlay`，含 `setTrack`、`open`、`close`、`update`；訂閱 `Subtitles.update` 的同一份內容（`app.js` 的 `render` 與 `renderTranslation` 改呼叫 `window.Overlay?.update(...)`）。
- webapp/static/subtitles.js：匯出 `settings` 的讀寫（`getSettings`／`setSettings`）與 `lastSentences`，供 overlay 共用；PiP 視窗開著時設定被另一邊改動也要重繪。
- webapp/static/overlay.css（新增）、webapp/static/index.html（按鈕、覆蓋層骨架、資產版本號）、webapp/static/mobile.css（手機隱藏 `#overlay`）。
- bench/translate_e2e.mjs：以 canvas `captureStream()` 假裝影像軌，檢查按鈕可用、覆蓋層出現、滑桿改變底色 alpha、拖曳後位置記住、Esc 關閉、停止後停用；純麥克風時停用。
- README.md（即時翻譯模式／浮動字幕段補「畫面＋字幕」）。
