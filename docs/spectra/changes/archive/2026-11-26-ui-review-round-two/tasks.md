## 1. 頂端列與手機觸控

- [x] 1.1 頂端列目前頁多一條 2px 底線（Header links are plain text）：目前頁保留 `--field` 底色與 `--text` 文字，底邊加一條 `--accent` 的 2px 線，其他連結沒有。驗證：新增 `bench/ui_round_two_e2e.mjs`，在 `/meetings` 1440px 檢查目前頁與其他連結的底線（背景圖）、底色與邊框。
- [x] 1.2 手機上的觸控目標至少 44px 高（Touch targets on phones are at least 44px tall）：760px 以下，頂端列的品牌連結、搜尋連結、頭像、主題鈕，搜尋與問答頁的切換，搜尋頁的種類分頁都至少 44px 高；校對頁時間軸每個發言片段可點的範圍至少 44px 高，相鄰兩列不重疊；頁面不出現橫向捲動。驗證：`bench/ui_round_two_e2e.mjs` 在 390px 量這些控制項的高度、時間軸片段的可點範圍與各列間距、頁面寬度。

## 2. 我的紀錄

- [x] 2.1 每列動作分出主次（A record row has one main action）：依序是有框的「載入」、打開選單的「下載」（原音、譯音、文字；即時翻譯的紀錄沒有譯音）、「轉成會議紀錄」與危險色的「刪除」；選單按 Esc 或點外面關閉；瀏覽器沒有 Popover API 時三個下載連結直接顯示在列上。驗證：`bench/ui_round_two_e2e.mjs` 用測試回應的兩筆紀錄檢查動作順序、框線、刪除的顏色、選單內容與連結網址、Esc 關閉；`webapp/test_server.py` 檢查 interpret.js 仍產生三個下載檔的連結。
- [x] 2.2 [after: 2.1] 重播區在載入後才出現（The replay area appears when a record is loaded）：波形、重播按鈕與原文、譯文區在載入一筆紀錄前不顯示，列表下顯示「按「載入」重播一筆紀錄，並顯示它的原文和譯文。」；載入後顯示並帶出該筆文字，刪除載入中的那筆後再收起。驗證：`bench/ui_round_two_e2e.mjs` 檢查載入前後兩區與說明行的顯示狀態與文字。

## 3. 會議紀錄列表

- [x] 3.1 整列可點，兩個連結改成文字連結（A meeting row opens the meeting）：有段落的會議主題是連到校對頁的連結，點列上空白處開校對頁，點「會議紀要」開紀要頁；兩個連結沒有底色與邊框、高度相同；沒有段落的會議維持「沒有校對資料」、不可點。驗證：`bench/ui_round_two_e2e.mjs` 檢查連結樣式、點空白處與點「會議紀要」各到哪一頁、沒有段落的列；`bench/minutes_e2e.mjs` 對列表兩個連結名稱與等高的檢查仍通過。

## 4. 細節與收尾

- [x] 4.1 說明文字的排版：用量管理與成效指標數字卡的說明最後一行不只剩一個詞；會議紀要頁的說明與狀態上下排列。驗證：`bench/ui_round_two_e2e.mjs` 檢查數字卡說明的 `text-wrap` 與會議紀要頁狀態行在說明下方；截圖檢視。
- [x] 4.2 [after: 1.2, 2.2, 3.1, 4.1] 既有測試與說明跟著更新：`test_server` 全數通過；`bench/legibility_focus_e2e.mjs`、`bench/ui_consistency_e2e.mjs`、`bench/web_platform_polish_e2e.mjs`、`bench/page_switching_e2e.mjs`、`bench/usage_admin_e2e.mjs`、`bench/ui_review_e2e.mjs` 沒有新的失敗；bench/README.md 加上新測試的說明；改過的樣式表與腳本在各 HTML 的版本參數更新。驗證：上述指令的輸出，以及我的紀錄、會議紀錄列表、搜尋頁與校對頁（1440 與 390）的截圖逐張檢視。
