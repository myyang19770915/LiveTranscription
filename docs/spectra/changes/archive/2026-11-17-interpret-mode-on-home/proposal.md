## Why

即時口譯目前只在獨立的 `/interpret` 頁、只給系統管理員試用。使用者希望把它放進語橋首頁，跟「即時翻譯」並列成一個模式，由管理員逐一開放給需要的人。開放之後，浮動字幕、畫面＋字幕這些既有工具也要能顯示口譯的結果。另外，使用者要「兩種模式都存」：即時翻譯不再只留在瀏覽器，跟口譯一樣存成本人的紀錄。

## What Changes

- 首頁的模式切換由「開會／即時翻譯」變成「開會／即時翻譯／即時口譯」。
  - 沒有口譯權限的人看得到「即時口譯」，但按鈕停用，旁邊註明「需要申請權限，請聯絡系統管理員」。
  - 口譯尚未設定時也停用，並說明尚未設定。
- 即時口譯模式下：
  - 原始逐字稿欄顯示語橋辨識的原文；翻譯欄顯示口譯的譯文。
  - 浮動字幕、畫面＋字幕顯示口譯譯文，「原文」切換顯示辨識原文。
  - 不另做文字翻譯；雲端精修、精準模式隱藏；中日雙向與交換方向停用。
  - 輸出語言改用口譯支援的 58 種，並有「同步播放譯音」開關。
  - 隱私標示顯示「雲端口譯」與「音訊會傳送到外部服務」。
  - 每次中斷存成本人紀錄（沿用現有存檔方式）。
- 權限：團隊管理頁新增「即時口譯權限」區塊，管理員以公司帳號逐一加入或移除。系統管理員一律可用。權限在口譯途中也會定時重新檢查。
- 即時翻譯模式改為存檔：每次結束都存成本人紀錄，包含原音、原文、譯文；不再寫「不存到伺服器」。仍然不建立會議、不出現在會議列表；匯出照舊可用。
- `/interpret` 改成「我的紀錄」頁：
  - 每位登入的使用者都能打開，只看得到自己的即時翻譯與即時口譯紀錄。
  - 頁面提供列表、波形重播、下載、刪除；即時翻譯紀錄只有原音。
  - 原本頁面上的口譯操作移到首頁。首頁放「我的紀錄」連結，結束後顯示「已存檔」並可直接開啟那筆紀錄。
- 費用：不設上限，口譯用量依使用者記錄；團隊管理頁的用量卡片加上每人用量。
- 保存期限：紀錄預設保存 90 天，到期自動刪除；系統管理員在團隊管理頁的「紀錄保存期限」修改天數。「我的紀錄」頁註明目前的保存天數。
- 即時翻譯的譯文在進行中每 30 秒送到伺服器一次，結束時再送最後一次；分頁中途關閉時，紀錄最多少最後 30 秒的譯文。

## Non-Goals (optional)

- 保存期限只有一個全系統設定，不做依人或依團隊的期限。
- 不做用量上限、不做依團隊開放。
- 開會模式不加口譯。
- `lab/realtime-translate` 測試台不動。
- 不改 `/ws/transcribe` 開會模式的行為與會議錄音。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `realtime-interpret`：從管理員專用頁改為首頁的模式，由管理員開放權限；紀錄頁開放給每位使用者看自己的紀錄（含即時翻譯紀錄）；用量依使用者記錄。
- `live-translation`：即時翻譯模式改為存成本人紀錄；`/ws/transcribe` 新增 `mode: "interpret"`（只辨識原文、不存檔）。
- `privacy-notice`：即時口譯模式的隱私標示。

## Impact

- Affected specs: realtime-interpret, live-translation, privacy-notice
- Affected code:
  - Modified: webapp/interpret.py, webapp/interpret_usage.py, webapp/server.py, webapp/static/index.html, webapp/static/app.js, webapp/static/refine.css, webapp/static/account.js, webapp/static/admin.html, webapp/static/admin.css, webapp/static/actions.html, webapp/static/ask.html, webapp/static/meetings.html, webapp/static/metrics.html, webapp/static/minutes.html, webapp/static/review.html, webapp/static/search.html (asset versions only), webapp/static/interpret.html, webapp/static/interpret.js, webapp/static/interpret.css, webapp/test_server.py, bench/interpret_e2e.mjs, bench/translate_e2e.mjs, bench/privacy_e2e.mjs, README.md
  - New: webapp/migrations/020_interpret_access.sql, webapp/static/interpret-mode.js, webapp/static/interpret-langs.js, webapp/records_retention.py
