## Context

浮動字幕（live-translation 的 `subtitles.js`）用 Document Picture-in-Picture 視窗，永遠在最上層但不透明。分享分頁聲音時 `requestDisplayAudio()` 以 `getDisplayMedia({video:true, audio:true, …})` 取得的串流同時含影像軌與音訊軌，`startMeeting` 只把音訊接進 AudioWorklet，影像軌一直存在 `captureStreams[0]` 直到 `stopMeeting` 把所有 track 停掉。`render('transcript', …)` 與 `renderTranslation()` 已經把原文、定稿譯文與暫譯推給 `window.Subtitles?.update(...)`。

## Goals / Non-Goals

**Goals:**

- 字幕真正半透明地疊在分享的分頁畫面上，底色透明度 20–100% 可調，文字不變。
- 字幕框可拖曳、位置記住；覆蓋層可全螢幕；Esc 或關閉按鈕關閉。
- 字幕內容、切句、原文開關與字級與浮動字幕一致且共用設定。
- 無影像軌時按鈕停用並說明原因；工作階段結束自動關閉。

**Non-Goals:**

- 不改 PiP 視窗；不錄影或上傳畫面；不改伺服器；不支援手機；不做字體描邊等字型樣式。

## Decisions

### 畫面＋字幕用頁內覆蓋層顯示分享的影像軌，而不是讓 PiP 透明

Chrome 的 Document PiP 視窗沒有透明選項（Chromium 視窗層級不透明），所以在本站頁面上用 `position: fixed; inset: 0` 的 `#screenView` 放 `<video muted autoplay playsinline>`，`srcObject` 設為只含該影像軌的 `new MediaStream([track])`，`object-fit: contain`、黑底。影像軌來自已存在的 `captureStreams`，不另外呼叫 `getDisplayMedia`，所以不會再跳一次分享選擇器。聲音仍由原分頁播放（覆蓋層的 video 靜音），畫面與聲音約差一個擷取週期（估計 100–200 ms，可用 e2e 以外的實機觀察確認；沒有量測就不在文件上寫確切數字）。

**替代方案**：擴充功能把字幕注入 YouTube 分頁。捨棄：要另外安裝與維護擴充功能，超出本站範圍。

### 字幕內容與設定共用 subtitles.js

`subtitles.js` 新增 `getSettings()`、`setSettings(partial)`（寫入 `localStorage.subtitles` 後同時重繪 PiP 視窗與覆蓋層）與既有 `lastSentences`。`app.js` 的 `render`／`renderTranslation` 改成呼叫 `window.Subtitles?.update(...)` 之後再 `window.Overlay?.update(...)`（同一份 `{source, translation, draft}`）。覆蓋層的「原文」「A−」「A+」透過 `Subtitles.setSettings` 改設定，所以兩邊一致。

### 覆蓋層自己的設定存 localStorage.overlay

`{opacity: 55, x: 50, y: 88}`：`opacity` 為底色不透明度百分比（20–100，滑桿 `input[type=range]` step 5，預設 55），`x`／`y` 為字幕框中心相對覆蓋層寬高的百分比（預設置中、靠下 88%）。底色為 `rgba(0,0,0,opacity/100)`（兩種主題都用黑底白字，疊在影片上最易讀），文字顏色與陰影不隨滑桿變。開啟時位置夾回 `[框寬/2, 寬−框寬/2]` 範圍，讓框永遠整個可見。

### 拖曳用 Pointer Events

`.overlay-subs` 的拖曳把手是整個字幕框（工具列的按鈕與滑桿除外）：`pointerdown` 記起點並 `setPointerCapture`，`pointermove` 更新 `left/top`（以中心百分比換算），`pointerup` 寫入 `localStorage.overlay`。滑鼠與觸控同一套。

### 按鈕狀態由影像軌決定

`Overlay.setTrack(track|null)`：有軌（且 `readyState === 'live'`）時 `#overlay` 可用；`null` 或軌 `ended` 時關閉覆蓋層、按鈕 `disabled`、`title`「需要分頁／系統聲音來源」。`startMeeting` 在取得 `captureStreams` 後呼叫 `setTrack(captureStreams[0].getVideoTracks()[0] || null)`；`stopMeeting` 呼叫 `setTrack(null)`。按鈕 `aria-pressed` 反映覆蓋層開關。

## Implementation Contract

**Behavior**

- 頁尾出現「畫面＋字幕」按鈕（`#overlay`，`.text-btn`，位於「浮動字幕」旁）。未開始、或音訊來源是純麥克風時 `disabled`，`title`「需要分頁／系統聲音來源」。
- 以「分頁／系統聲音」或「麥克風＋系統聲音」開始後按鈕可用；按下開啟 `#screenView`（`hidden` 屬性切換），裡面顯示分享的畫面，字幕框顯示與浮動字幕相同的內容：`.ov-source`（最近一句原文，依設定顯示）、`.ov-text`（最近兩句定稿譯文）、`.ov-draft`（暫譯、較淡）、沒有內容時 `.ov-empty`「等待語音…」。
- 字幕框工具列：原文切換（`aria-pressed`）、A−、A+、背景透明度滑桿（`input[type=range]` 20–100）、全螢幕、關閉（✕）。滑桿改變 `.overlay-subs` 的 `--ov-alpha`，底色 `rgba(0,0,0,var(--ov-alpha))`，文字顏色不變。
- 拖曳字幕框改變位置；重新開啟覆蓋層或重新整理後位置、透明度相同。
- Esc 關閉覆蓋層（非全螢幕時）；關閉後 `#overlay` 的 `aria-pressed="false"`，video `srcObject` 清空。
- 工作階段停止（`stopMeeting`，含分享中斷）時覆蓋層關閉、按鈕停用。
- 字級步階與浮動字幕相同（28／34／40／48px，設定 `size` 1–4）。

**Interface**

- `window.Overlay = {setTrack(track|null), open(), close(), update({source, translation, draft}), isOpen(), refresh()}`（`refresh` 由 `Subtitles.setSettings` 呼叫，只重繪不改內容）。
- `window.Subtitles` 新增 `getSettings()` → `{source:boolean, size:1-4}`、`setSettings(partial)`。
- `localStorage.overlay` = `{"opacity": 20-100, "x": 0-100, "y": 0-100}`；壞值用預設 `{55, 50, 88}`。

**Failure modes**

- 影像軌 `ended`（使用者在 Chrome 的分享列按停止）：`track.onended` 已由 `app.js` 觸發 `stopMeeting`，覆蓋層隨之關閉。
- `requestFullscreen` 被拒（例如非使用者手勢）：toast「無法全螢幕」，覆蓋層維持（`.toast` 的 z-index 高於覆蓋層）。全螢幕對整份文件（`documentElement`）而不是覆蓋層本身：覆蓋層反正蓋滿整頁，這樣 toast 在全螢幕時也看得到。
- `localStorage` 不可用：設定只在記憶體內，功能照常。

**Acceptance**

- `bench/translate_e2e.mjs`（無頭瀏覽器沒有分頁可分享）：以 `addInitScript` 把 `navigator.mediaDevices.getDisplayMedia` 換成回傳 canvas `captureStream()` 加假麥克風音訊軌的串流，選「分頁／系統聲音」開始後檢查：`#overlay` 可用 → 按下 `#screenView` 顯示且 video 有 `srcObject` → `.ov-text` 與頁面譯文一致 → 滑桿設 30 後 `.overlay-subs` 的 `--ov-alpha` 為 0.3 → 拖曳到新位置後 `localStorage.overlay` 的 x/y 改變且重新開啟後套用 → Esc 關閉、`aria-pressed=false` → 停止後 `#overlay` 停用。另以純麥克風開始確認按鈕停用且 `title` 含「分頁／系統聲音」。
- 既有檢查（PiP 浮動字幕、模式切換、匯出）維持通過；`catalog_e2e.mjs`、`series_e2e.mjs` 開會模式不變。

**Scope**

- In：以上前端行為、e2e、README。Out：伺服器、PiP 視窗、錄影、手機。

## Risks / Trade-offs

- 使用者要看本站分頁而不是 YouTube 分頁：這是取得真正透明字幕的代價；全螢幕可讓觀看體驗接近原分頁。
- 擷取畫面的幀率與解析度依 Chrome 分享設定（通常 30 fps、原解析度），比直接看影片略差。
- 覆蓋層與 PiP 可同時開（內容相同）；不互斥。
