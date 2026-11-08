## Why

整體檢視時發現兩個小問題：校對頁在沒有譯文的會議仍顯示空的「譯文」欄，佔掉一半寬度；紀要頁每一條待確認的待辦都把負責人、到期日、證據、按鈕各排一列，一頁很長。

## What Changes

- 校對頁：整場沒有任何譯文時，隱藏「譯文」欄與欄名，原文欄佔滿；有譯文時不變（review.js 加 `no-target` class，review.css 對應）。
- 紀要頁：每條條目的負責人／到期日欄位與「確認／駁回／修改」按鈕排在同一列（左欄位、右按鈕，窄螢幕換行），證據標籤移到條目標題列右側，卡片內距略縮；欄位仍可直接改、直接確認，互動不變（minutes.js 的 `item-foot`、minutes.css）。原本討論的「待確認預設收合」沒有採用：收合後確認前要多點一次「修改」才看得到負責人，反而增加步驟；改排版就少掉約四成高度。

## Non-Goals

- 不改條目的確認、駁回、修改流程與 API。
- 不改證據側欄。

## Impact

- Affected specs: none（顯示排版，行為不變）
- Affected code:
  - New: (none)
  - Modified: webapp/static/review.js, webapp/static/review.css, webapp/static/review.html, webapp/static/minutes.js, webapp/static/minutes.css, webapp/static/minutes.html
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
