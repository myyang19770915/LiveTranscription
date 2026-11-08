## 1. 設定區外觀與引擎名稱

- [x] 1.1 桌機寬度（≥ 761 px）的開會設定區：欄位標籤 12 px、選項值 15 px、區段標題 13 px、說明文字 12–13 px；欄位卡、交換按鈕、測試音源一律 1 px `--border` 框線與相同底色，滑過與聚焦有不同框色；下拉箭頭為 CSS 畫的斜角；手機版（≤ 760 px）不變。驗證：以 Playwright 截取 1920 與 1280 寬的明亮、深色畫面與 400 寬畫面人工比對；bench/translate_e2e.mjs 新增檢查「標籤 12px、選項 15px」通過。
- [x] 1.2 選「中日雙向自動」時，交換方向按鈕直向顯示「中／箭頭／日」且不折行，翻譯卡圓點仍為「中⇄日」。驗證：bench/translate_e2e.mjs 檢查 `#swap .lang-tag` 依序為「中」「日」；截圖確認不折行。
- [x] 1.3 辨識引擎的本機選項與成效指標頁的引擎名稱只顯示「本機」，網頁介面任何地方都不出現本機模型名稱。驗證：bench/translate_e2e.mjs 檢查 `#asrEngine` 第一個選項為「本機」且沒有選項含 Confucius；`grep -rni confucius webapp/static` 只剩程式註解以外為零筆；index.html、metrics.html 的資產版本號已更新。
- [x] 1.4 回歸：app 單元測試、bench/translate_e2e.mjs、bench/catalog 相關 e2e 全數通過。
