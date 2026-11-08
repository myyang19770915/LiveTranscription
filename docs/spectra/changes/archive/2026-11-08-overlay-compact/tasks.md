## 1. 字幕框大小

- [x] 1.1 spec「Screen view with subtitles」的高度限制；設計決策「內容區貼齊底部、最多 4 行、捲到最新」：`index.html` 以 `.ov-body` 包住內容四個元素；`overlay.css` 加 `.ov-body` 高度上限與底部對齊、`.overlay-subs { max-height: 50vh }`；`overlay.js` 重繪後 `scrollTop = scrollHeight`；資產版本號更新。驗證：任務 3.1 的 e2e 檢查「長譯文時內容區 ≤ 4 行、框 ≤ 50vh、暫譯可見」。

## 2. 原文開關

- [x] 2.1 設計決策「原文開關改為覆蓋層自己的設定、預設開」：`overlay.js` 的 `load()` 讀 `source`（非布林用 `true`），「原文」按鈕改寫自己的設定，`render()` 依此顯示；`README.md` 畫面＋字幕段改為「原文預設顯示，可關」。驗證：任務 3.1 的 e2e 檢查「預設原文顯示」「關掉後重新整理仍關且 PiP 設定不變」。

- [x] 2.2 spec「Current speech and its draft share a colour」與「Floating subtitles window」的顏色對照；設計決策「進行中的原文與暫譯同色」：`app.js` 改傳 `{done, pending, translation, draft}`；`subtitles.js`／`subtitles.css` 與 `overlay.js`／`overlay.css` 的原文行分 `.sub-done`＋`.sub-now`／`.ov-done`＋`.ov-now`，暫譯與 `now` 同用 `--sub-now`（`tokens.css`）；浮動字幕與覆蓋層都套用；資產版本號更新。驗證：任務 3.1 的 e2e 檢查「進行中原文與暫譯同色、與定稿不同」（兩個介面）。

## 3. 驗收

- [x] 3.1 [after: 1.1, 2.1, 2.2] `bench/translate_e2e.mjs`：新增上述三組檢查與顏色對照檢查（長內容餵入 `Overlay.update`；原文預設；關掉原文後重新整理與 PiP 不受影響），既有檢查通過。驗證：`YUQIAO_SESSION=… node bench/translate_e2e.mjs <wav> <dir>` exit 0。
