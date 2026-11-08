## Why

使用者覺得新的登入頁左側「都是靜靜的沒效果」，希望有動態感、比較炫。示意圖本身就在講「功能匯流到語橋 Live」，適合用動畫把這件事演出來。

## What Changes

- `webapp/static/login.html`：每條虛線改成獨立的路徑（從外往中央畫）；新增光點：六張功能卡每 2 秒輪一張（順時針：即時轉錄、即時翻譯、待辦追蹤、成效指標、搜尋問答、會議紀要，12 秒一輪），光點用該卡的顏色，在 1.8 秒內沿虛線流到中央；Cloud、Local 也各有光點每 6 秒送往中央。中央圖示加兩圈漣漪；左側背景加兩團會飄移的柔光。系統設定為減少動態時，頁面腳本暫停 SVG 動畫。
- `webapp/static/login.css`：新增動態樣式：輪到的功能卡外框與光暈亮起、圖示放大；卡片 6 秒緩慢上下浮動（各自錯開）；虛線持續往中央流動；外圈軌道緩慢轉動；中央圖示呼吸光與漣漪；Cloud／Local 圖示上下輕晃；標題「會議」漸層流光；品牌、標題、副標、示意圖依序淡入上升。`prefers-reduced-motion: reduce` 時全部關閉，並隱藏光點與漣漪。
- `bench/login_e2e.mjs`：新增兩項檢查：一般情況下有 20 個以上動畫在跑、至少一顆光點在路上；減少動態時沒有任何動畫、SVG 已暫停、光點不顯示。

## Non-Goals (optional)

- 右側登入面板不加動畫，避免干擾輸入。
- 不加音效、不用影片或 canvas，也不引入動畫函式庫。
- 窄螢幕的兩欄卡片只保留浮動與輪流亮起，不加光點（軌道圖在那個寬度本來就不顯示）。

## Impact

- Affected specs: none
- Affected code:
  - New: (none)
  - Modified: webapp/static/login.html, webapp/static/login.css, bench/login_e2e.mjs
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
