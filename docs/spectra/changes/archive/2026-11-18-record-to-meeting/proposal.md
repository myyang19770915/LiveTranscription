## Why

「我的紀錄」裡的即時翻譯與即時口譯紀錄有原文、譯文和錄音，但只屬於個人，不能校對、做會議紀要、待辦或搜尋。使用者事後想把某一次改成正式會議紀錄時，只能重開一場會議，原本的內容就浪費了。

## What Changes

- 「我的紀錄」每筆紀錄加「轉成會議紀錄」：選團隊與標題後，建立一場屬於該團隊的會議，帶入逐句原文、譯文與錄音，之後與一般會議一樣可以校對、播放、做紀要。
- 即時翻譯紀錄從此連同逐句資料（每句的開始與結束時間、原文、譯文）一起保存，與會議保存段落的方式相同；有逐句資料的紀錄轉換時直接帶入，不另外處理、不花費。
- 即時口譯紀錄，以及在此之前存下、沒有逐句資料的即時翻譯紀錄：轉換時錄音已經存在，不需要即時辨識模型：所有語言一律用 Qwen3-ASR 重新辨識，斷句、修正與翻譯照精準模式原本的做法，產生逐句資料；畫面顯示處理進度，完成後才建立會議。會使用外部辨識與翻譯服務（畫面註明），精準模式未設定時這類紀錄不能轉換並說明原因。
- 原紀錄保留（仍依保存期限刪除），標示「已轉成會議紀錄」並連到該會議；同一筆紀錄只能轉換一次。

## Non-Goals

- 不把會議轉回個人紀錄。
- 不保留口譯模型說出的譯音（output.wav）；會議只有一條原音。
- 不設定會議系列、詞彙表；轉換後可在會議頁照常設定。
- 不在轉換時合併多筆紀錄。

## Capabilities

### New Capabilities

- `record-to-meeting`: 從「我的紀錄」把一筆即時翻譯或即時口譯紀錄轉成團隊會議紀錄，包含即時翻譯紀錄保存逐句資料、以精準模式為沒有逐句資料的紀錄產生段落、轉換進度與已轉換標示。

### Modified Capabilities

(none)

## Impact

- Affected specs: record-to-meeting（新增）
- Affected code: webapp/interpret.py（保存逐句資料、轉換 API）、webapp/record_meeting.py（新增：重新取樣、離線執行精準模式、建立會議）、webapp/quality_pass.py（只讀使用其 QualityPass）、webapp/static/app.js（即時翻譯送出逐句資料）、webapp/static/interpret.js、webapp/static/interpret.html、webapp/static/interpret.css（按鈕、對話框、進度、已轉換標示）、webapp/static/admin.css（對話框裡的下拉選單套用共用樣式）、各頁 HTML 的 `?v=` 版本、webapp/test_server.py、bench/record_meeting_e2e.mjs（新增）
- 外部服務：Qwen3-ASR 與精準模式的文字模型（deepseek-v4-flash），只在轉換沒有逐句資料的紀錄時使用；不使用 MAI
- webapp/quality_pass.py：`QualityPass` 新增選填參數 `engine`，轉換時指定轉錄 API
