## Why

待辦目前只能從會議紀要產生（AI 抽取或在紀要頁手動加），會議以外交辦的事情（臨時口頭交辦、訊息裡談好的事）進不了看板，只能另外記。Jira 看板最常用的動作就是直接建立項目；使用者在檢視 P3 成果後選擇補上這一塊。

## What Changes

- 待辦看板加「＋ 新增待辦」（也可按 `c`）：在右側面板填內容、團隊、負責人、到期日，可選系列；建立後是已確認、未開始的待辦，來源顯示「看板新增」。
- 看板建立的待辦不屬於任何會議；選了系列的話，下次這個系列開會時會出現在「會前未完成事項」，也會納入會中進度提示。
- 看板的詳細面板可以修改待辦內容；看板新增的待辦可以刪除（建錯時用，需再按一次確認）。會議紀要產生的待辦不能在看板刪除，維持用「已取消」。
- 新增以待辦為主的 API（`/api/actions`、`/api/actions/{id}`、`/api/actions/{id}/status`、`/api/actions/{id}/updates`），看板所有待辦（含會議來的）都改走這組 API；紀要頁維持原本的會議 API。

## Non-Goals

- 在看板新增決議、問題、風險（只有待辦）。
- 子任務、留言、附件、優先級。
- 把看板新增的待辦事後掛到某場會議。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `action-tracking`: 新增「Board-created action items」需求：看板直接建立、修改內容、刪除看板建立的待辦，不屬於會議的待辦如何顯示與權限判斷，以及選了系列時納入會前未完成事項與會中進度提示。

## Impact

- 資料庫：新增 webapp/migrations/008_board_items.sql（`minute_items.team_id` 回填並設為必填、`meeting_id` 可為空、`series_id`、插入時自動帶入團隊的 trigger）。
- 後端：webapp/actions.py（新 API、看板查詢改以待辦的團隊判斷權限）、webapp/series.py（未完成事項與進度提示包含系列的看板待辦）、webapp/minutes.py（項目內容 helper 支援沒有會議的待辦）。
- 前端：webapp/static/actions.js、webapp/static/actions.html、webapp/static/actions.css、webapp/static/action-status.js（改以項目網址呼叫）、webapp/static/minutes.js、webapp/static/board.js（泳道）。
- 測試：webapp/test_server.py、bench/actions_e2e.mjs、bench/boardcheck.js。
