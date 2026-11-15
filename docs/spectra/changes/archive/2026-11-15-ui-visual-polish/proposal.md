## Summary

依 Codex 的視覺建議（docs/ui-design-suggestions-codex.md）做三件事：全站共用圓角／陰影／間距／字級的設計 token、開會頁「進階」設定預設收合、搜尋／問答／登入改用同一套載入中樣式。

## Motivation

- 各頁 CSS 的圓角散落 6、7、8、9、10、11、12、14、18px 等數值（2026-11-15 以 grep 統計 webapp/static/*.css），`tokens.css` 只有顏色 token，沒有圓角、陰影、間距、字級，於是每頁各自決定，看起來不像同一套產品，後續美化也會繼續分歧。
- 開會頁的設定區在 1195px 寬截圖（docs/ui-review-shots/meeting-live.jpeg）設定面板約 700px 高（截圖 y≈155–855，量測自截圖），字幕區從 y≈873 才開始，其中「進階」組（辨識引擎、雲端精修、精準模式）多數人開會時不會動，卻一直攤開，把字幕區推到第一個畫面之外。
- 等待資料時的回饋三頁各做各的：登入是按鈕內轉圈、搜尋是把舊結果變淡、問答是另一套 `is-loading`；沒有共用的「正在做什麼」提示與佔位。

## Proposed Solution

1. 在 `webapp/static/tokens.css` 加上語意 token：`--radius-control`、`--radius-card`、`--radius-pill` 等圓角，`--shadow-card`（亮色柔和陰影、暗色無陰影改靠描邊），4/8/12/16/24/32px 間距，頁標題／區塊標題／內文／輔助字字級。各頁 CSS 的圓角數值改用最接近的 token（差距 ≤2px），外觀以截圖比對不能明顯走樣。
2. 開會頁「進階」標題改成可展開／收合的按鈕，預設收合；收合時標題旁顯示目前已開啟的進階選項摘要（例如「精準模式」「雲端 MAI」），全部是預設值時顯示「預設」。展開狀態存在 localStorage，下次開頁沿用。「會議情境」不屬於進階組，維持顯示。
3. 新增共用 `.loading-state` 樣式：保留原內容高度，顯示低對比佔位行與小 spinner 加動詞文字（「搜尋中…」「整理答案中…」）；搜尋、問答套用；登入按鈕的 spinner 改用共用 spinner 樣式。`prefers-reduced-motion` 時不轉、不閃。沿用既有「立即標記、延遲宣告」做法（search-feedback-term-limit / 載入狀態：立即標記、延遲宣告）：200ms 內完成的查詢不出現佔位行。

## Non-Goals

- 不改版會議列表、待辦看板、成效指標、紀要、搜尋結果版型（Codex 建議第 3–9 項，評估後暫不做或屬測試資料造成）。
- 不改色彩 token 與品牌色。
- 不把英文小標改成中文（先前 ui-review-fixes 已決定保留為設計風格）。

## Alternatives Considered

- 只改開會頁、不做 token：最快，但其他頁之後仍各自發展，Codex 的第一優先項就是這個問題。
- 「進階」直接移到對話框：多一次點擊，且窄螢幕已有設定對話框，桌面再加一層會重複。

## Impact

- Affected specs: 新增 `visual-tokens`、`meeting-setup-layout`、`loading-feedback`
- Affected code:
  - Modified: webapp/static/tokens.css, webapp/static/styles.css, webapp/static/refine.css, webapp/static/themes.css, webapp/static/mobile.css, webapp/static/accounts.css, webapp/static/admin.css, webapp/static/actions.css, webapp/static/ask.css, webapp/static/search.css, webapp/static/login.css, webapp/static/metrics.css, webapp/static/minutes.css, webapp/static/review.css, webapp/static/series.css, webapp/static/speakers.css, webapp/static/subtitles.css, webapp/static/overlay.css, webapp/static/evidence-panel.css, webapp/static/index.html, webapp/static/app.js, webapp/static/search.js, webapp/static/ask.js, webapp/static/search.html, webapp/static/ask.html, webapp/static/login.html, webapp/static/subtitles.js (asset version only), and the other pages' asset version strings
  - New: bench/ui_polish_e2e.mjs, webapp/static/loading-state.js
  - Removed: none
