## Why

會議進行中，開會頁每 10 秒、以及會議結束時，把定稿段落（時間、原文、譯文）存到伺服器；會後校對、紀要、說話者辨識、問答都靠這份結構化資料。存檔失敗時（網路斷線、伺服器重啟、登入過期），目前只在瀏覽器主控台印出警告：不會重試，畫面上看不出來，關掉頁面也不會提醒。錄音與純文字備份還在，但段落的時間軸與之後的紀要都會缺一塊，而且使用者不知道。

## What Changes

- 存檔失敗時自動重試：5、15、30 秒後，之後每 60 秒一次，每次送出當下最新的段落；成功後恢復正常排程。
- 開會頁狀態列旁顯示存檔狀態：成功時「段落已儲存 14:03:21」；失敗時以警示樣式顯示「段落尚未儲存，15 秒後重試」；登入過期（401）時顯示「登入已失效，段落尚未儲存，請重新登入」並停止重試。
- 還有段落未存檔（等待中或失敗）時，關閉或重新整理頁面前跳出瀏覽器的離開確認。

## Non-Goals

- 不把未存檔的段落存進瀏覽器的本機儲存。
- 開始新會議後，不再替上一場重試（新會議會清空段落，無法再送出上一場的內容）；這與現況相同，只是現在畫面上看得到失敗。
- 不改伺服器 API。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `meeting-timeline`: 新增「存檔失敗看得到並會重試」需求。

## Impact

- Affected specs: meeting-timeline
- Affected code:
  - Modified: webapp/static/app.js, webapp/static/index.html, webapp/static/styles.css
  - New: bench/savecheck.js
  - Removed: 無
