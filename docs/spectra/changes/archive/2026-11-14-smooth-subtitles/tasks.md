## 1. 量測

- [x] 1.1 設計決策「以量測工具驗收」：`bench/smooth_e2e.mjs` 把錄好的事件播進真實頁面，回報每個顯示面每分鐘的更新、位移、單格超過 12 px 的跳動、來回、被替換與被收回的字數，並可存截圖。驗證：對 `artifacts/replay/tracks/qk_en_tesla_en_0_240_qzh.json` 執行 90 秒會印出各顯示面的表格；修改前的數字已記錄在提案中。

## 2. 字幕

- [x] 2.1 spec「Subtitle text moves smoothly」「Floating subtitles window」；設計決策「清單貼底，內容變高時以位移動畫補上」「浮動字幕正在講的原文整段顯示在兩行內」：浮動字幕的清單貼底並以 `Subtitles.glide` 平滑位移，節點依位置重用，「正在講」整段顯示於最多兩行，上緣漸淡，減少動態效果時不做動畫。驗證：`bench/translate_e2e.mjs` 浮動字幕的既有檢查通過並新增「正在講最多兩行且結尾可見」；`bench/smooth_e2e.mjs` 的浮動字幕整行跳動次數低於修改前的五分之一。
- [x] 2.2 [after: 2.1] spec「Screen view with subtitles」；設計決策「畫面＋字幕的譯文是三行的清單，暫譯接在最後」：字幕框改為原文區 2 行＋譯文區 3 行的貼底清單，定稿在暫譯原位出現，`Overlay.update` 接受 `history`。驗證：`bench/translate_e2e.mjs` 畫面＋字幕的檢查更新後通過（高度固定、譯文區三行、短視窗、顏色、定稿在原位）；`bench/smooth_e2e.mjs` 的畫面＋字幕整行跳動次數低於修改前的三分之一。

## 3. 暫譯與兩欄

- [x] 3.1 spec「A draft continues the draft already shown」；設計決策「暫譯請求帶上已顯示的暫譯」：`POST /api/translate` 接受 `previous_draft`，只在暫譯請求時寫入提示詞；頁面在同一段話變長時帶上目前顯示的暫譯。驗證：`webapp/test_server.py` 新測試（帶、不帶、定稿請求三種提示詞）；`bench/smooth_e2e.mjs` 暫譯被收回的字數與修改前比較。
- [x] 3.2 spec「The panes follow the newest text smoothly」；設計決策「兩欄跟隨最新文字時平滑捲動」：兩欄跟隨時以平滑捲動到底，使用者往上捲後不跟隨、回到底部後恢復。驗證：`bench/quality_e2e.mjs` 新增檢查（跟隨到底、往上捲 300 px 後新文字不移動捲動位置、捲回底部後跟隨）；`bench/smooth_e2e.mjs` 兩欄的整行跳動次數低於修改前。

- [x] 3.3 spec「The unsettled end of a draft is shown lighter」；設計決策「暫譯不穩定的結尾以較淡的顏色顯示」：`Subtitles.solid` 算出暫譯已穩定的長度，三個顯示面把其後的文字放進 `.unsure`（不透明度 55%）。驗證：`bench/translate_e2e.mjs` 新增檢查（規格範例表的四列、浮動字幕與畫面＋字幕的暫譯結尾在 `.unsure` 內且文字不變）。

## 4. 文件與驗收

- [x] 4.1 [after: 2.2, 3.1, 3.2] `README.md` 說明字幕的新版面與平滑捲動；`bench/README.md` 記錄修改前後的量測表。驗證：兩份文件有對應段落；`python -m unittest -q test_server`、`node bench/checks.js`、`node bench/translate_e2e.mjs` 全數通過。
