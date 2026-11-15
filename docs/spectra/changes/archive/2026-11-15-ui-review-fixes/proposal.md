## Problem

2026-11-15 由 Codex 以 computer use 實際操作 Edge 巡覽整個介面（報告 `docs/ui-review-codex.md`，截圖 `docs/ui-review-shots/`），列出 14 項。對照截圖與程式碼後，確認以下 4 項是真的介面問題：

1. 會後校對頁按「修改原文」後，編輯框佔掉原文與譯文兩欄，譯文被擠進最右側 76px 的狀態欄，無法對照譯文改字。
2. 團隊管理的成員列，「移除照片」與「移除」並排、都是紅色警示樣式；「移除」其實是把成員移出團隊，確認文字只寫「確定移除？」。
3. 窄螢幕（760px 以下）頁首把會議紀錄、團隊管理藏起來，900px 以下藏成效指標；頭像選單只補了待辦看板與登出，這三個頁面沒有入口。
4. 404 頁寫「你沒有開啟它的權限」，但沒有給權限問題的下一步，也沒有「返回上一頁」。

## Root Cause

1. `webapp/static/review.css` 的 `.edit-form { grid-column: 2 / 4 }` 讓編輯框跨原文與譯文兩欄，後面的 `.seg-target` 被自動排到第 4 欄（狀態 chip 的 76px 欄）。
2. `webapp/static/admin.html` 的 `memberRow` 兩個按鈕都用 `confirmButton`（`text-button danger`），文字也沒區分。
3. `webapp/static/accounts.css` 的窄螢幕規則隱藏連結，`webapp/static/account.js` 的 `ownAvatar` 選單只有 `menu-phone` 的待辦看板與登出。
4. `webapp/static/not-found.html` 只有兩個連結。

## Proposed Solution

1. 編輯時編輯框只佔原文欄（`grid-column: 2 / 3`），譯文留在第 3 欄；無譯文版面與手機版維持原本整列。
2. 成員移出按鈕改為「移出團隊」，確認文字為「確定把〈名稱〉移出〈團隊〉？」並保留警示樣式；「移除照片」改為一般文字按鈕（仍需再按一次確認）。
3. 頁首因寬度藏起的連結改由頭像選單提供：待辦看板、成效指標、團隊管理（管理員）在頁首藏起時出現；會議紀錄在 `/` 與 `/meetings` 以外的頁面、窄螢幕時出現。開會頁在 760px（待辦看板、團隊管理）與 900px（成效指標）切換，其他頁面在 640px（成效指標、團隊管理）切換；詳見 site-navigation spec。
4. 404 頁加「返回上一頁」（有上一頁時才顯示，用 `history.back()`，不呼叫 API），並加一句「如果是團隊的會議，請團隊管理員確認你在該團隊中」。

## Capabilities

### New Capabilities

- `site-navigation`：頁首導覽在窄螢幕的入口。

### Modified Capabilities

- `transcript-review`：改字時譯文保持可見。
- `team-access`：移出成員的按鈕與確認文字。
- `not-found-page`：返回上一頁與權限提示。

## Non-Goals

- 浮動字幕視窗位置：Document PiP 視窗的位置由瀏覽器決定，網頁無法控制。
- 會議列表、搜尋、待辦看板的相似項目：來自自動測試建立的資料，不是介面問題。
- 紀要空狀態說明：紀要頁上方已有說明（AI 從整場逐字稿整理、每條附證據段落、確認後才算正式紀錄），實作時確認後撤回。
- 問答回答的負責人不一致：回答已指出資料不一致，矛盾來自測試資料。
- 英文小標籤（LIVE TRANSCRIPT 等）：刻意的設計風格。
- 窄版語言下拉截斷、窄版待辦看板單欄、頭像上傳前的尺寸說明、「服務就緒」與麥克風提示：影響小或需較大改版，本次不做。

## Success Criteria

- 校對頁進入改字時，譯文仍在原本的譯文欄完整顯示（1280px 寬視窗下譯文欄寬度與未編輯時相同）。
- 團隊管理成員列顯示「移除照片」（一般樣式）與「移出團隊」（警示樣式），按「移出團隊」後顯示含成員與團隊名稱的確認文字。
- 500px 寬時，頭像選單可以進入會議紀錄、成效指標，管理員還能進團隊管理。
- 404 頁有上一頁時顯示「返回上一頁」，並顯示權限提示；仍不呼叫任何 API。
- `test_server` 單元測試全部通過。

## Impact

- Affected code:
  - Modified: webapp/static/review.css, webapp/static/admin.html, webapp/static/account.js, webapp/static/accounts.css, webapp/static/not-found.html, webapp/static/admin.css, 引用上述 CSS／JS 的頁面（版本號）, webapp/test_server.py
  - New: none
  - Removed: none
