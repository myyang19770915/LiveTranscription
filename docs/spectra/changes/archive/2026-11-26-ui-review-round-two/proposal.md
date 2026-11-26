## Why

2026-11-26 全站檢視的第 4 到 8 項還沒處理：手機上有幾組按鈕小於 44px 而且緊貼；頂端列目前頁的標示只比背景亮一點；「我的紀錄」每列六個外觀相同的文字動作，刪除和其他沒有區別，還沒載入紀錄時空的波形與文字框佔了大半頁；會議紀錄列表每場會議兩顆等重的按鈕，37 場就是 74 顆；另外有幾處說明文字的排版細節。

## What Changes

- 手機（760px 以下）的觸控目標至少 44px 高：頂端列的品牌連結、搜尋連結、頭像與主題鈕；搜尋頁的「全文搜尋／問答」切換與種類分頁；校對頁時間軸的發言片段把可點的範圍加高到 44px、各列拉開。
- 頂端列目前頁除了原本的底色與文字顏色，再加一條 2px 的底線，不只靠顏色分辨。
- 「我的紀錄」每列的動作分出主次：「載入」是有框的按鈕；原音、譯音、文字收進「下載」選單；「轉成會議紀錄」維持文字按鈕；「刪除」用危險色。波形與原文、譯文區在載入一筆紀錄之後才出現，之前由列表下的一行說明代替。
- 會議紀錄列表的每一列整列可點，點了開逐字稿校對；會議主題是連結；「會議紀要」「逐字稿校對」改成安靜的文字連結，不再是填色按鈕。
- 細節：用量管理與成效指標數字卡的說明不留孤字；會議紀要頁的說明與狀態上下排列，不再擠在同一列的兩端。

## Non-Goals (optional)

- 團隊管理頁奇數個團隊時最後一張卡右邊留空：這是兩欄格線的正常結果，「建立新團隊」是第一張卡也是 system-settings 規格的要求，不動。
- 檢查器回報的「相機圖示蓋住姓氏」與「成員列左緣差 9px」：相機圖示只在滑鼠移上或鍵盤聚焦時出現，成員列實際對齊，判定為誤報，不改。
- 團隊管理的「輸入公司帳號」欄位已有無障礙名稱（aria-label），不另加看得見的標籤。
- 「下載」選單不另寫一套鍵盤方向鍵操作：它是三個連結的清單，Tab 可以走到，Esc 與點外面由瀏覽器的 popover 關閉。
- 桌面寬度的按鈕尺寸不變；44px 的要求只在 760px 以下。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `visual-tokens`: 頂端列目前頁的標示加上底線；新增手機觸控目標至少 44px 高的要求。
- `realtime-interpret`: 新增「我的紀錄」每列動作的主次，以及重播區在載入紀錄後才出現。
- `meeting-catalog`: 新增會議紀錄列表整列可點、兩個連結是文字連結。

## Impact

- 程式：webapp/static/topbar.css、webapp/static/search.css、webapp/static/speakers.css、webapp/static/interpret.html、webapp/static/interpret.js、webapp/static/interpret.css、webapp/static/meetings.html、webapp/static/review.css、webapp/static/metrics.css、webapp/static/minutes.css，以及引用這些檔案版本參數的各個 HTML。
- 測試：新增 bench/ui_round_two_e2e.mjs；webapp/test_server.py 補靜態檢查；bench/minutes_e2e.mjs 對列表兩個連結的檢查仍須通過。
- 文件：bench/README.md。
- 不動 API、資料庫與相依套件。
