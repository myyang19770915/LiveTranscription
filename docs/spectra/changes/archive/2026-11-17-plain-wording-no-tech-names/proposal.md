## Summary

把網頁上所有看得到的供應商、模型與技術名稱（Azure、MAI、Confucius、GPT-Realtime-Translate、LDAP、Docker、WebSocket、環境變數名稱、模型名稱）改成一般用語，並加一個測試防止之後又寫回去。

## Motivation

使用者要求：「系統中，我不想讓使用者看到背後是用什麼 model 或技術，請幫我檢查，並用一般用語敘述即可。」目前開會頁、隱私提示、紀要、問答、會議列表、成效指標、團隊管理和即時口譯頁都直接寫出供應商與模型名稱，有些錯誤訊息還列出 `.env` 設定名稱。這些對一般使用者沒有意義，也透露了系統內部的組成。

## Proposed Solution

- 畫面文字改用一般用語：「本機」「雲端辨識」「雲端翻譯服務」「外部服務」「公司帳號」「紀要功能」「問答功能」。隱私提示仍要清楚說明資料會不會離開語橋主機，所以保留「雲端」「本機」「外部服務」這類說法。
- 「尚未設定」類訊息不再列出環境變數，改成「尚未設定，請聯絡系統管理員」。紀要頁不再顯示模型名稱。
- 伺服器回給頁面的訊息（紀要、問答未設定，即時口譯未設定或連不上）也一併改寫。
- 新增 `plain-wording` 規格與一個 `test_server` 測試：掃描 `webapp/static` 的 HTML／JS 可見字串（排除註解與程式識別字）和伺服器回給頁面的訊息常數，出現禁用名稱就失敗。
- 既有規格中寫死畫面字樣的需求跟著修改，相關 bench 的期望字樣同步更新。

## Non-Goals

- 不改程式內部識別字：engine 值 `local`／`mai`／`hybrid`、API 路徑與欄位、環境變數名稱、資料表名稱。
- 不改 log、註解、README、`docs/`、bench 的說明文字；這些是給維運人員看的。
- 不改命令列工具（例如 `python -m interpret_usage`、`python -m mai_usage`）的輸出，只有管理者在主機上會看到。
- 不改登入方式或帳號來源，只改說明文字。

## Alternatives Considered

- 只改一般成員看得到的頁面、保留管理員頁的技術名稱：使用者沒有區分，而且團隊管理頁的「LDAP 帳號」等字樣一般管理者也不需要知道，所以全部一起改。
- 把技術名稱移到滑鼠移上去才顯示的 title：仍然看得到，不符合需求。

## Impact

- Affected specs: plain-wording (new); meeting-setup-layout, privacy-notice, meeting-minutes, service-status, realtime-interpret (modified)
- Affected code:
  - Modified: webapp/static/admin.html, webapp/static/index.html, webapp/static/app.js, webapp/static/privacy-note.js, webapp/static/meetings.html, webapp/static/metrics.js, webapp/static/minutes.js, webapp/static/ask.js, webapp/static/interpret.html, webapp/static/interpret.js, webapp/minutes.py, webapp/qa.py, webapp/interpret.py, webapp/test_server.py, bench/interpret_e2e.mjs, bench/privacy_e2e.mjs, bench/qa_e2e.mjs, bench/series_e2e.mjs, bench/translate_e2e.mjs, bench/ui_polish_e2e.mjs
  - New: none
  - Removed: none
