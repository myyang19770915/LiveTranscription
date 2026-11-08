## 1. 配色變數與共用頁面

- [x] 1.1 tokens.css 定義「湖水藍＋暖橘」兩個主題的全部變數（含新增的 `--accent-2`、`--accent-2-ink`、`--accent-2-soft`），值如 design.md「色彩表」；登入、會議紀錄、校對、紀要、看板、指標、團隊、搜尋、問答頁因此全部換色；metrics.css 圖表序列色改為設計表的值；login.css、series.css、account.js 等零星寫死的綠改為變數（看板頭像的六個識別色維持）。驗證：`node …/dataviz/scripts/validate_palette.js` 對兩個主題的圖表三色通過（CVD 警告以直接標籤為補償，已有）；明暗兩主題每頁截圖目視確認沒有殘留綠色與對比不足；`grep -c "#[0-9a-f]\{6\}" webapp/static/{actions,admin,login,metrics,search,ask,minutes,review,evidence-panel}.css` 只剩陰影與頭像色。

## 2. 開會頁改用同一套變數

- [x] 2.1 index.html 載入 tokens.css；styles.css 與 refine.css 的顏色改為 `var(--…)`（舊變數名改為 tokens 的別名）；themes.css 只剩結構性的明亮主題規則；mobile.css 移除明亮顏色覆寫；app.js 的 `theme-color` 改讀 `--page` [after: 1.1]。驗證：`grep -c "#[0-9a-fA-F]\{3,8\}" webapp/static/themes.css` 為 0、styles.css 與 refine.css 合計 ≤ 6（只剩陰影）；明暗、桌機與 400px 的開會頁截圖目視確認（含手機設定視窗、live 狀態列、暫譯區塊）；`bench/series_e2e.mjs` 以假麥克風開一場短會議仍通過。

## 3. 品牌圖示

- [x] 3.1 brand-icon.png 的兩個綠改為藍（圖案不變），重新產生 favicon.ico、favicon-32.png、favicon-192.png、apple-touch-icon.png，所有頁面圖示的版本參數更新；README 的服務架構說明若提到顏色一併更新 [after: 1.1]。驗證：圖示與頁首並排截圖目視確認；`/favicon.ico` 測試仍通過。
