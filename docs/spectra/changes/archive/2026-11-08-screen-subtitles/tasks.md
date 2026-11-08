## 1. 共用字幕設定

- [x] 1.1 `webapp/static/subtitles.js` 匯出 `getSettings()` 與 `setSettings(partial)`：寫入 `localStorage.subtitles` 後重繪 PiP 視窗並呼叫 `window.Overlay?.update()`；PiP 視窗內的原文／A−／A+ 改經由 `setSettings`。驗證：既有 `bench/translate_e2e.mjs` 的「both settings are remembered」「settings are applied again after a reload」仍通過。

## 2. 畫面＋字幕覆蓋層

- [x] 2.1 [after: 1] 實作 spec「Screen view with subtitles」與設計決策「畫面＋字幕用頁內覆蓋層顯示分享的影像軌，而不是讓 PiP 透明」：新增 `webapp/static/overlay.js`（`window.Overlay`：`setTrack`、`open`、`close`、`update`、`isOpen`）與 `overlay.css`，`index.html` 加頁尾按鈕 `#overlay`（「畫面＋字幕」，初始 `disabled`、`title`「需要分頁／系統聲音來源」）與 `#screenView` 骨架（video、`.overlay-subs` 含工具列：原文、A−、A+、透明度滑桿 20–100 step 5、全螢幕、✕；內容 `.ov-source`／`.ov-text`／`.ov-draft`／`.ov-empty`），資產版本號更新；`mobile.css` 手機隱藏 `#overlay`。行為：開啟時 video `srcObject` 為只含影像軌的 MediaStream，字幕內容與 `Subtitles` 相同（`lastSentences` 2 句譯文、1 句原文、暫譯較淡），滑桿改 `--ov-alpha`（底色 `rgba(0,0,0,var(--ov-alpha))`），Esc 關閉，`aria-pressed` 反映開關。驗證：任務 4.1 的 e2e 檢查「覆蓋層出現且 video 有 srcObject」「譯文一致」「滑桿 30 → alpha 0.3」「Esc 關閉」。
- [x] 2.2 [after: 2.1] 拖曳與記憶（設計決策「覆蓋層自己的設定存 localStorage.overlay」）：Pointer Events 拖曳 `.overlay-subs`（按鈕與滑桿除外），中心位置以百分比寫入 `localStorage.overlay`（`{opacity,x,y}`，預設 `{55,50,88}`，壞值用預設），開啟時套用並夾回可見範圍；全螢幕按鈕對 `#screenView` 呼叫 `requestFullscreen`，失敗時 toast「無法全螢幕」。驗證：任務 4.1 的「拖曳後 x/y 改變且重新開啟後套用」。
- [x] 2.3 [after: 2.1] 設計決策「按鈕狀態由影像軌決定」：`webapp/static/app.js`：`startMeeting` 取得 `captureStreams` 後 `window.Overlay?.setTrack(captureStreams[0].getVideoTracks()[0]||null)`；`stopMeeting` 呼叫 `setTrack(null)`（覆蓋層關閉、按鈕停用）；`render('transcript', …)` 與 `renderTranslation()` 在 `Subtitles.update` 之後也呼叫 `Overlay.update`。驗證：任務 4.1 的「分頁來源後按鈕可用」「純麥克風時停用」「停止後停用」。

## 3. 文件

- [x] 3.1 [after: 2] `README.md` 即時翻譯模式／浮動字幕段補「畫面＋字幕」（用途、PiP 不能透明的原因、需分頁／系統聲音來源、透明度與拖曳、全螢幕）；`bench/README.md` 的 `translate_e2e.mjs` 條目補新檢查。驗證：內容審閱。

## 4. 驗收

- [x] 4.1 [after: 2] `bench/translate_e2e.mjs`：以 `addInitScript` 替換 `getDisplayMedia` 為 canvas `captureStream()` 影像軌＋假麥克風音訊軌的串流；新增檢查：分頁來源開始後 `#overlay` 可用、按下後 `#screenView` 顯示且 video 有 `srcObject`、`.ov-text` 與頁面譯文一致、滑桿 30 後 `--ov-alpha` 為 0.3、拖曳後 `localStorage.overlay` x/y 改變並在重新開啟後套用、Esc 關閉且 `aria-pressed=false`、停止後 `#overlay` 停用；純麥克風開始時 `#overlay` 停用且 `title` 含「分頁／系統聲音」。驗證：`YUQIAO_SESSION=… node bench/translate_e2e.mjs <wav> <dir>` exit 0，且 `catalog_e2e.mjs`、`series_e2e.mjs` 仍通過。
