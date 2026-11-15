## Problem

開放試用後，使用者用手機實測發現兩個問題：

1. 第一次開啟可以使用麥克風，再次開啟時「測試音源」與「開始翻譯」都失敗，畫面只顯示 `undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')`，使用者看不懂也不知道怎麼排除。
2. 手機的開會頁上方，「語音語言」與「翻譯成」兩個選單被擠成約 90px 寬，選到的語言只剩一個字，「精準模式」開關則佔掉右側另一列。

## Root Cause

1. 對外網址 `http://asr.my-yang.online` 不會轉到 https（實測 GET 回 200，沒有轉址）。瀏覽器只在安全連線（https 或 localhost）提供 `navigator.mediaDevices`；手機截圖的網址列顯示「不安全」圖示，表示第二次是以 http 開啟，`requestMicrophone()` 直接呼叫 `navigator.mediaDevices.getUserMedia` 而丟出 TypeError，錯誤原文被直接顯示。
2. 手機版（`mobile.css`）把設定區的格線限定為 `"source swap target"` 一列，其他設定由 `app.js` 的 `mobileSettingsNodes` 搬進設定對話框。這份清單有 `#cloudRefineRow` 但沒有 `#qualityRow`，所以伺服器提供精準模式時，`#refineGroup`（`grid-area: refine`）留在設定區；`refine` 不在手機的格線範本裡，瀏覽器為它加出隱含的欄與列，把兩個語言選單擠窄。此問題在 11/14 精準模式上線時就存在。

## Proposed Solution

1. 麥克風：取得麥克風或分享音訊前先檢查頁面是否為安全連線、瀏覽器是否支援。不是安全連線時，音源狀態顯示「需要 https 連線才能使用麥克風」，提示訊息附上同一頁的 https 網址；瀏覽器不支援時顯示「此瀏覽器不支援麥克風」。頁面載入時就在音源狀態顯示同樣的說明，不必等按下按鈕。
2. 版面：手機寬度時把 `#qualityRow` 一併搬進設定對話框，放在「雲端精修」之後；回到寬螢幕時搬回原位。`.hint-stack`（提示文字搬走後剩下的空容器）與 `#refineGroup` 在手機設定區不顯示，避免多出空的格線。手機設定區只剩語言列。
3. 部署：建議在 Cloudflare 開啟「Always Use HTTPS」，讓 http 網址自動轉到 https（設定在 Cloudflare 後台，由使用者操作，不在程式內）。

## Non-Goals

- 不在程式內做 http→https 自動轉址：區網直接用 `http://IP:18082` 的使用者沒有 https 可轉，伺服器端分辨來源需要依賴代理標頭，交給 Cloudflare 設定較單純。
- 不改寬螢幕的設定區排版與 進階 收合行為。

## Success Criteria

- 以非安全連線開啟開會頁時，音源狀態一載入就顯示「需要 https 連線才能使用麥克風」；按「測試音源」或「開始翻譯／開始會議」時不會出現 `undefined is not an object` 之類的原始錯誤，提示訊息包含 `https://` 加上目前的主機與路徑。
- 390px 寬、伺服器提供精準模式時，「語音語言」與「翻譯成」各自寬度至少 120px，設定區只有一列；設定對話框內看得到「精準模式」，勾選後開始會議送出的設定與在寬螢幕勾選相同。
- 寬螢幕（1280px）的設定區版面與修改前相同。

## Impact

- Affected code:
  - Modified: webapp/static/app.js
  - Modified: webapp/static/index.html
  - Modified: webapp/static/mobile.css
  - Modified: bench/ui_polish_e2e.mjs
  - Modified: bench/README.md
