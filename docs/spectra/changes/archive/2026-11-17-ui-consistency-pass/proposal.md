## Summary

讓每一頁的頂端列、版面寬度、深淺主題切換都一致；即時口譯模式的設定區更精簡；並修正逐頁檢查找到的手機版橫向捲動、按鈕樣式不一、提示文字不符等問題。

## Motivation

使用者回報（2026-11-17，附截圖）：
- 頂端列在每一頁都不一樣：當前頁的按鈕會消失、各頁多一個不同的按鈕（即時會議／回首頁／會議紀錄），換頁時按鈕位置跳來跳去。量測：首頁品牌在 x=80、其他頁在 x=180；主題按鈕首頁在 1360、其他頁在 1260（1440 寬螢幕）。
- 首頁切換深淺主題時寬度改變：深色內容寬 1360（左邊 40），淺色變成帶框卡片寬 1408（左邊 16），原因是 `webapp/static/themes.css` 在淺色主題替 `main` 另設寬度、外距、內距與外框。其他頁量過，兩種主題寬度相同。
- 即時口譯模式下方的設定區可以再精簡，「會議情境」用不到。
- 其他地方請再檢查與美化。逐頁檢查（9 頁 × 1440／390 寬 × 深淺主題）另找到 14 項問題，最嚴重的是團隊管理頁在手機上橫向捲動（頁面 760px 寬）、首頁手機版主題按鈕被切掉 16px。

## Proposed Solution

- **共用頂端列：** 每一頁都顯示同一組連結、同一個順序：即時會議、會議紀錄、我的紀錄、待辦看板、成效指標、團隊管理（管理員）、搜尋；目前所在的頁面以醒目樣式標示（`aria-current="page"`），不移除。各頁額外的「即時會議／回首頁／會議紀錄」按鈕拿掉。首頁頂端列改用跟其他頁相同的容器寬度與位置；「服務就緒」狀態移出頂端列右側，放在品牌旁邊。手機版品牌名稱不換行、主題按鈕不被切掉。登入頁的主題按鈕改成跟其他頁一樣的圓形圖示按鈕。頂端列按鈕滑過時不再位移。
- **一致的頁寬：** 新增一個頁面寬度 token（最大 1280px，兩側留白 24px／手機 16px），頂端列與所有頁面的內容都用它，左右邊緣在每一頁對齊。
- **主題切換只換顏色：** 淺色主題不再改變 `main` 的寬度、外距、內距與外框。
- **即時口譯設定區：** 口譯模式隱藏「會議情境」且不送出；「同步播放譯音」移到開始按鈕旁，設定區少一列；開始按鈕的說明文字縮短，不再換三行。
- **逐頁修正：** 團隊管理頁手機版不再橫向捲動、保存期限欄位排好；首頁各模式的空白提示寫對按鈕名稱；待辦看板主要按鈕改用一致的藍色、看板對齊頁寬；各頁原生下拉選單與日期欄位改用一致的樣式；問答頁按鈕與輸入框對齊、按鈕文字改「提問」；我的紀錄表格「語言」欄不再擠成三行、譯文欄空白時有提示；待辦看板手機版篩選列排整齊；成效指標卡片避免最後一行只剩一個字。

## Non-Goals (optional)

- 不改功能、API、資料。
- 不重新設計配色或字體（沿用 tokens.css）。
- 我的紀錄裡英文譯文「hasthe」少空白是口譯服務送來的文字接法問題，不在這次範圍（另外處理）。
- 手機版首頁的模式按鈕仍放在「設定」對話框裡（phone-mic-and-layout 的既有決定），只修頂端列溢出。

## Alternatives Considered (optional)

- 頂端列只把「目前頁面」改成停用而不是醒目：仍會讓人以為按不了，捨棄。
- 各頁維持不同寬度、只對齊頂端列：內容左邊緣仍在 82～260 之間跳動（量測值），捨棄。

## Impact

- Affected specs: site-navigation（modified：頂端列在各頁一致）、visual-tokens（added：頁面寬度與主題不改版面）、realtime-interpret（modified：口譯模式設定區）
- Affected code:
  - Modified: webapp/static/account.js, webapp/static/tokens.css, webapp/static/themes.css, webapp/static/admin.css, webapp/static/mobile.css, webapp/static/refine.css, webapp/static/index.html, webapp/static/app.js, webapp/static/login.html, webapp/static/admin.html, webapp/static/meetings.html, webapp/static/interpret.html, webapp/static/interpret.js, webapp/static/interpret.css, webapp/static/actions.html, webapp/static/actions.css, webapp/static/metrics.html, webapp/static/metrics.css, webapp/static/search.html, webapp/static/search.css, webapp/static/ask.html, webapp/static/ask.css, webapp/static/review.html, webapp/static/minutes.html, bench/interpret_e2e.mjs, bench/ui_review_e2e.mjs, webapp/static/accounts.css
  - New: bench/ui_consistency_e2e.mjs
