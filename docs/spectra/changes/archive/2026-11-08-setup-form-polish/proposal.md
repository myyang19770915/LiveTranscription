## Why

使用者反映開會頁的設定區「字體大小與框線看起來不太好看」：欄位標籤只有 9 px、提示文字 10 px、測試音源的副標 8 px，和 13 px 的選項值落差很大；每張欄位卡的框線顏色與底色在明亮主題下不一致；下拉箭頭是文字「⌄」，看起來像字母 v；選「中日雙向自動」時，交換方向按鈕的「中⇄日」在 58 px 寬的欄裡被折成直排。另外辨識引擎的選項寫著「本機 Confucius」，使用者不希望讓人知道本機用的是哪個模型（README 本來就寫「產品 UI 不顯示底層模型名稱」，這兩處漏掉了）。

## What Changes

- `webapp/static/refine.css` 末尾新增一段只在桌機寬度（≥ 761 px）生效的樣式，只作用於 `.controls` 內：
  - 字級：欄位標籤 12 px（600 粗、不轉大寫、字距 .02em）、選項與輸入值 15 px、區段標題（這場會議／語音與翻譯／進階）13 px、欄位說明與麥克風狀態 12 px、音源提示 13 px、雲端精修 15/12 px、測試音源 14/12 px、開始會議 16/12 px。
  - 框線：欄位卡、交換按鈕、測試音源一律 1 px `--border`、圓角 12 px，底色為 `--page` 40% 混入 `--panel`；滑過時框線變 `--field-border`，聚焦時變 `--accent` 加 3 px `--accent-soft` 外光暈；設定區陰影減輕為 `0 12px 40px rgb(0 0 0 / .06)`。
  - 下拉箭頭改為 CSS 畫的 7 px 斜角（兩條 1.6 px 邊框旋轉 45°），垂直置中。
  - 交換方向按鈕改為直向排列「語言／箭頭／語言」，語言標籤 13 px 不換行。
- `webapp/static/app.js`：選「中日雙向自動」時，交換按鈕兩端顯示「中」與「日」（不再兩端都是「中⇄日」）；翻譯卡左上的語言圓點維持「中⇄日」。
- 辨識引擎名稱：`webapp/static/index.html` 的選項「本機 Confucius」改為「本機」；成效指標頁 `webapp/static/metrics.js` 的引擎名稱同樣改為「本機」。
- 資產版本號：index.html 的 refine.css、app.js，metrics.html 的 metrics.js。

## Non-Goals (optional)

- 手機版設定面板（`mobile.css`、寬度 ≤ 760 px）不改；它有自己的字級，這次使用者回報的是桌機畫面。
- 不改欄位排列、欄位數量與文字內容（除了引擎名稱）。
- 「雲端 MAI」名稱保留：使用者只要求隱藏本機模型；雲端選項需要讓人知道音訊會送到 Azure。
- README 的模型與部署說明保留（給維護者看，README 第 7 行已說明 UI 不顯示模型名稱）。
- 右上角狀態膠囊（系統待機／即時轉錄中／錯誤）不改，只回答使用者的問題。

## Impact

- Affected specs: none
- Affected code:
  - New: (none)
  - Modified: webapp/static/refine.css, webapp/static/app.js, webapp/static/index.html, webapp/static/metrics.js, webapp/static/metrics.html
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
