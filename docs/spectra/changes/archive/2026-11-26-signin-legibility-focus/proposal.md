## Why

2026-11-26 用 design-taste-frontend 檢視全站 14 個頁面後，有三件事讓介面看起來不像專業產品：登入頁是一張功能卡圍著圖示的示意圖（六種顏色、其中一種是紫色、英文的 Cloud／Local、不停移動的光點），標語沒說產品做什麼，字級還比頁面主標大；開會首頁有 8 到 11px 的文字，圖表座標是 11px；有幾個控制項用鍵盤聚焦時看不到外框。

## What Changes

- 登入頁左側重做：一句說明產品做什麼的主標，下面是開會畫面的示意（原文與翻譯兩欄，用真的 HTML 排出來）。拿掉功能卡示意圖、Cloud／Local、六種功能色、背景光暈和所有持續播放的動畫。右側表單標題改成「登入」，是主標之下的次標題；登入按鈕的字不再拉開字距。
- 全站文字下限：畫面上看得到的字不小於 12px；句子、按鈕與連結的字、欄位標籤不小於 13px。實際要調的是開會首頁（桌面與手機）、成效指標與用量管理的圖表座標與說明、搜尋結果的來源資訊。
- 鍵盤焦點：用 Tab 走到的每個控制項，自己或包住它的欄位框要有至少 2px 的外框。補上待辦搜尋欄、問答輸入框、搜尋欄、管理頁輸入框、登入欄位、句中選單選項、成效指標圖表；樣式表不再有「聚焦時拿掉外框卻沒有替代」的規則。

## Non-Goals (optional)

- 不改登入流程、驗證、錯誤訊息與登入後的導向。
- 不處理檢視報告的第 4 到 8 項（手機觸控目標、頂端列目前頁的對比、我的紀錄的動作列、會議紀錄列表的按鈕、團隊管理的零散問題），之後另開 change。
- 文字下限只檢查各頁打開時的畫面（沒有開會中、沒有打開對話框）；開會進行中的逐字稿字級本來就由使用者設定，不在這次範圍。
- 不採用 design-taste-frontend 給對外網站的規則（首屏只放主視覺、每屏一個區塊、照片、進場以外的動態）：語橋 Live 是內部工具。
- 登入頁的示意畫面不用截圖：截圖在兩個主題與不同寬度下會糊，也不能跟著設計 token 換色。

## Capabilities

### New Capabilities

- `sign-in-page`: 登入頁說明產品做什麼、顯示開會畫面的示意、標題的層級，以及它不使用的裝飾。

### Modified Capabilities

- `visual-tokens`: 新增文字大小下限與鍵盤焦點一定看得到兩項要求。

## Impact

- 程式：webapp/static/login.html、webapp/static/login.css、webapp/static/tokens.css、webapp/static/styles.css、webapp/static/refine.css、webapp/static/mobile.css、webapp/static/themes.css、webapp/static/metrics.css、webapp/static/metrics.js、webapp/static/usage.css、webapp/static/usage.js、webapp/static/search.css、webapp/static/ask.css、webapp/static/actions.css、webapp/static/admin.css、webapp/static/evidence-panel.css，以及引用這些樣式表版本參數的各個 HTML。
- 測試：bench/login_e2e.mjs 改寫版面與動態的檢查；新增 bench/legibility_focus_e2e.mjs；webapp/test_server.py 補登入頁內容的檢查。
- 文件：README.md 與 bench/README.md 提到登入頁與瀏覽器測試的段落。
- 不動 API、資料庫與相依套件。
