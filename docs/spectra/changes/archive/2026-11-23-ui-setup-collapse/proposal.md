## Summary

即時會議頁的設定區在寬版開會前預設收起：只留標題句子，以及一列「模式按鈕、更多設定、開始按鈕」，逐字稿卡片回到第一個畫面。雲端精修和精準模式改成並排的小開關。另外修好標題斷在詞中間、資料去向太小、語言交換鈕直排、測試音源狀態被截斷、手機語言標記換行等細節，並拿掉會議紀錄與我的紀錄頁標題下的說明文字。

## Motivation

2026-11-23 使用者在 https://asr.my-yang.online/ 看過 ui-night-celadon 改版後，認為還不夠簡潔。在 1440×900 截圖上確認的問題：

- **資訊重複、首屏被設定佔滿**：標題句子已經說出全部設定，下面又有完整的設定區，逐字稿卡片只露出上緣（截圖中卡片上緣約在 655px，視窗高 900px）。
- **標題斷在詞中間**：「……記進智慧應用部的會／議紀錄」。
- **雲端精修、精準模式兩個勾選框**：展開進階後各佔半列，使用者說「佔了太多版面，而且不好看」。
- **細節**：
  - 資料去向膠囊字約 10–11px，沒有跟標題對齊。
  - 語言交換鈕「中 ⇆ 日」是直排。
  - 測試音源的狀態被截成「請先按「測試音源…」。
  - 手機翻譯卡片的語言標記「中⇄日」擠成兩行。
- **子頁說明文字**：會議紀錄頁、我的紀錄頁標題下各有一段兩到三行的說明，和使用者要的「少說明」不一致。

## Proposed Solution

- **設定預設收起（寬度大於 760px、還沒開會）**：
  - 收起時設定區只顯示一列：模式按鈕、「更多設定」按鈕、開始按鈕。
  - 按「更多設定」展開完整設定，再按一次收起；選擇記在瀏覽器（`setupMoreOpen`），第一次來是收起。
  - 按標題句子裡的設定詞，設定區自動展開，焦點移到那個選單並打開它。
  - 進階（雲端精修、精準模式）的收合照舊，在展開後的設定區裡。
- **標題只在「，」後換行**：每個分句是一個不換行的單位；分句比整行還長時才在分句內換行。
- **雲端精修、精準模式改成小開關**：兩個開關並排在進階那一列，每個是一顆圓角膠囊，左邊是開關，右邊是名稱；說明仍在滑鼠停留提示。
- **細節**：
  - 資料去向字級 13px，與標題第一行垂直置中對齊。
  - 語言交換鈕改成一行「中 ⇆ 日」。
  - 測試音源的狀態可以換成兩行，不截斷。
  - 手機翻譯卡片的語言標記不換行。
- **子頁說明**：拿掉 `/meetings` 與 `/interpret` 標題下的說明段落（`/interpret` 保留「紀錄保存 N 天，到期自動刪除」這一行，realtime-interpret 規格要求）；`/admin` 的說明保留（寫的是管理員需要知道的團隊規則）。
- **手機版（760px 以下）**：版面和節點位置不變，只修語言標記換行。

## Non-Goals (optional)

- 不改開會中的畫面（浮動錄音列、設定收起）。
- 不拿掉進階的收合，也不改進階的記憶方式。
- 不改設定項目本身、送出的設定值或資料去向的文字內容。
- 不做原文與譯文逐句對齊（仍留給 `live-aligned-rows`）。

## Alternatives Considered (optional)

- **把設定全部改成句中的自訂下拉選單，完全拿掉設定區**：主題、系列、會議情境、測試音源都不在句子裡，還是需要一個地方放；而且 ui-night-celadon 已經決定保留原生選單（「句子由純函式組成，原生選單照舊」）。
- **只把標題字縮小**：句子和設定區仍然重複，首屏問題沒有解決。

## Impact

- Affected specs: meeting-setup-layout（修改）、visual-tokens（修改）
- Affected code:
  - Modified:
    - webapp/static/index.html
    - webapp/static/app.js
    - webapp/static/refine.css
    - webapp/static/mobile.css
    - webapp/static/meetings.html
    - webapp/static/interpret.html
    - webapp/static/admin.css
    - webapp/static/actions.html
    - webapp/static/admin.html
    - webapp/static/ask.html
    - webapp/static/metrics.html
    - webapp/static/minutes.html
    - webapp/static/review.html
    - webapp/static/search.html
    - bench/interpret_e2e.mjs
    - bench/ui_night_celadon_e2e.mjs
    - bench/ui_polish_e2e.mjs
    - bench/ui_consistency_e2e.mjs
    - bench/audio_test_e2e.mjs
  - New:
    - bench/ui_setup_collapse_e2e.mjs
  - Removed: 無
