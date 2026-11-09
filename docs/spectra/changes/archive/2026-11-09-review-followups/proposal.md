## Why

回溯補做的 verify／review（2026-11-09）檢查了 `minutes-mail`、`action-reminders`、`board-panel-polish`、`board-panel-align`、`overlay-fixed-height`、`pip-subtitle-history`，沒有 Critical，但找到幾個會讓人收不到信或畫面出錯的問題：成員自填的怪地址會讓同團隊其他人收不到紀要；部分收件人被拒時仍顯示成功；`SMTP_TLS` 填錯值會以明文登入；寄提醒到一半服務重啟，後面的提醒會永久漏寄；矮視窗配大字級時，畫面＋字幕的暫譯會跑出框外；另有幾個小的介面與文件不一致。

## What Changes

- **Email 格式**：只接受 ASCII 的一般地址（local part 不含引號、逗號、分號、角括號等，網域由英數與連字號組成且有點）；收件人計算時也略過不合格的已存地址，避免一個成員的地址影響整封信。
- **部分收件人被拒**：寄出後檢查 SMTP 回報被拒的收件人；有被拒時記為失敗並列出被拒的地址，頁面顯示紅字，可再寄一次。
- **`SMTP_TLS`**：只接受 `starttls`／`ssl`／`none`；其他值記錄錯誤並改用 `starttls`，不會以明文登入。
- **寄送時未預期的例外**：一律記為失敗（只記錄例外類別），定稿仍會成功回應。
- **提醒不漏寄**：一次執行中還沒寄出的負責人，遇到取消或任何例外時撤銷佔位；寄送失敗時同一天 30 分鐘後重試；排程改為每 5 分鐘檢查一次「今天的提醒時間到了沒、跑過沒」，主機休眠或時區變化都不會錯過。
- **畫面＋字幕**：字級上限跟著視窗高度縮小（不超過 5.5vh），字幕框 `overflow:hidden`，矮視窗也保持在半個視窗內、暫譯看得到。
- **看板詳細面板**：切換提醒後焦點留在開關上；網路錯誤時恢復開關並顯示「切換失敗」；新增待辦表單的系列說明改到下方小字；控制項寬度 `min(220px, 100%)`，極窄螢幕不出現橫向捲軸。
- **浮動字幕**：會議模式切句只做一次；原文按鈕提示改為「顯示原文」；e2e 改用 260px 高的視窗並檢查最新一段在可見範圍內。
- **文件**：README「畫面＋字幕」段落改為固定行數與同一字級；overlay.js 註解更新。

## Non-Goals

- 修正 spec 的 @trace 清單收進未追蹤檔案（spxa 封存時產生；改以本機 git exclude 避免再發生，不在本變更內改寫既有 trace）。
- 並行定稿的自動化測試、`worker()` 的整合測試（以 `due_now` 純函式測試取代）。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `user-auth`: Member e-mail address 的格式規則收緊。
- `minutes-mail`: Mail server configuration（`SMTP_TLS` 的值、未預期例外）與 Send record（部分收件人被拒記為失敗）。
- `action-reminders`: Reminder timing（中途中斷不漏寄、失敗當天重試、每 5 分鐘檢查）。
- `live-translation`: Screen view with subtitles（字級隨視窗高度縮小）。

## Impact

- webapp/auth.py、webapp/mailer.py、webapp/reminders.py
- webapp/static/actions.js、webapp/static/actions.css、webapp/static/overlay.css、webapp/static/overlay.js、webapp/static/subtitles.js、webapp/static/app.js、webapp/static/index.html、webapp/static/actions.html、webapp/static/minutes.html（資產版本）
- webapp/test_server.py、bench/translate_e2e.mjs、README.md
