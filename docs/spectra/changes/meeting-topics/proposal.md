## Why

會議紀錄目前只能靠開始時間分辨，沒有主題，也不能篩選或搜尋；會議一多，就找不到「上週的週會」或「某位同事開的那場」。使用者 2026-11-05 決定先補主題與篩選，系列會議與逐字稿全文搜尋留待 roadmap P3／P4。

## What Changes

- 會議可以有主題：開始會議前在主頁選填，沒填時一律顯示「MM/DD HH:mm 的會議」；會後在校對頁可修改，團隊成員都能改。
- 會議紀錄列表可依團隊、開始日期區間、建立者篩選，並以關鍵字搜尋主題；篩選在伺服器端進行，不受列表筆數上限影響。
- 列表依開始日期分成「今天」「本週」「更早」三組，每場以主題為標題。
- 校對頁標題顯示主題，並提供返回會議紀錄的連結（2026-11-05 已加上，納入本變更一併驗收）。
- 權限沿用團隊隔離：只看得到、改得到自己團隊的會議；建立者選單也只列出自己團隊的人。

## Capabilities

### New Capabilities

- `meeting-catalog`: 會議主題（填寫、預設顯示、修改）與會議紀錄的篩選、搜尋、分組

### Modified Capabilities

(none)

## Impact

- 受影響程式：webapp/team_access.py（建立會議帶主題、列表篩選、修改主題、建立者清單）、webapp/static/index.html 與 webapp/static/app.js（主題欄位）、webapp/static/meetings.html（篩選列與分組）、webapp/static/review.html 與 webapp/static/review.js（主題顯示與修改、返回連結）、webapp/static/review.css
- 新增：webapp/migrations/003_topics.sql
- 測試：webapp/test_server.py
- 文件：README.md
