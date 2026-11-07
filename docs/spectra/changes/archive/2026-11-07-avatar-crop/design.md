## Context

`AvatarPhoto.square(file)`（webapp/static/account.js）直接取中央正方形縮成 160×160，`AvatarPhoto.upload(url, file)` 接著上傳。呼叫的地方有兩個：團隊管理的成員頭像（admin.html）與頁首選單（account.js 的 `ownAvatar`）。account.js 被所有頁面載入，其中即時會議頁 index.html 用的是另一套樣式（themes.css／accounts.css），其他頁面用 tokens.css／admin.css。

## Goals / Non-Goals

**Goals:**

- 選圖後先看到照片與正方形裁切框，可移動、縮放框選，確定才上傳，取消不上傳。
- 滑鼠、觸控、鍵盤都能操作；兩個入口共用同一套。

**Non-Goals:**

- 旋轉、翻轉、濾鏡、非圓形頭像、伺服器端影像處理。

## Decisions

### 移動裁切框，而不是移動照片

照片固定縮放到對話框裡完整顯示，使用者移動、縮放的是上面的正方形框。這正是使用者描述的「移動、調整框選」，也最直觀：一眼看到整張照片與要保留的範圍。替代做法是固定圓框、拖曳與縮放照片（社群軟體常見），但看不到整張照片，而且縮放照片在觸控上需要雙指手勢，不採用。

### 對話框用原生 dialog，樣式由 account.js 注入

用 `<dialog>` 的 `showModal()`：自帶焦點限制、Esc 觸發 `cancel`、背景遮罩。對話框掛在 `document.body`，不放在頁首 `.account` 裡，避免吃到 `.account button` 的樣式。因為兩套樣式表（admin.css、accounts.css）都需要它，樣式由 account.js 第一次開啟時注入一個 `<style id="crop-style">`，顏色用兩套共有的變數加退回值（例如 `var(--panel, var(--surface))`），只維護一份。

### 座標以「顯示像素」記錄，確定時換回原圖

框的狀態是顯示座標的 `{x, y, size}`，所有拖曳、按鍵、滑桿都只改這三個值並夾在照片範圍內（`clamp`）。確定時乘上 `原圖寬 / 顯示寬` 換回原圖座標，用 `drawImage` 取該區域畫到 160×160 的 canvas。預覽用同一個換算畫到 64×64，所以預覽與上傳結果一致。

### upload 取消時回傳 null

`AvatarPhoto.upload(url, file)` 先開裁切對話框；使用者取消時不送請求、回傳 `null`。呼叫端把 `null` 當成「什麼都沒發生」，不顯示錯誤、不更新頭像。

## Implementation Contract

**行為**

- `AvatarPhoto.crop(file)` → `Promise<Blob | null>`：類型不允許或讀不到圖片時丟出錯誤（訊息同現在）；否則開對話框，確定回傳 160×160 WebP（不支援時 JPEG），取消回傳 `null`。
- `AvatarPhoto.upload(url, file)` → `Promise<{username, avatarUrl} | null>`：先 `crop`，`null` 就不上傳直接回傳 `null`。
- 對話框（`dialog.crop-dialog`，`aria-label`「裁切照片」）：
  - 舞台 `.crop-stage` 內是照片 canvas 與裁切框 `.crop-frame`（`tabIndex=0`，`role="slider"` 不適用，改用 `aria-label`「裁切範圍，方向鍵移動」），框右下角 `.crop-handle`。
  - 照片在舞台中完整顯示，最長邊為 `min(360px, 視窗寬 − 80px)`，但不小於 120px。
  - 初始框為最大的置中正方形（邊長 = 顯示寬高較小者）。框的最小邊長 = 顯示寬高較小者的 20%，不少於 24px。
  - 拖曳框內移動；拖右下角把手縮放（左上角固定、維持正方形）；滑桿 `input[type=range].crop-size`（`aria-label`「框選大小」）以框中心縮放；方向鍵移動 4px、Shift＋方向鍵 20px；`+`／`-` 以框中心縮放（先夾住大小，已在上下限時不會偏移）。對話框內的按鍵不往外傳，頁面自己的快捷鍵（空白鍵播放、Esc 關側欄）不受影響。預覽每次重畫前先清空，透明圖片不留殘影。每次變動都夾在照片範圍內並更新預覽 `canvas.crop-preview`。
  - 按鈕「取消」「確定」（`.crop-ok`）；Esc 等同取消。關閉後對話框從 DOM 移除。
- 團隊管理與頁首：取消時不顯示錯誤、頭像不變、不送 PUT。

**驗收（bench/avatar_e2e.mjs）**

- 團隊管理點頭像選 400×240 圖片 → 出現對話框，預設框置中；按確定 → 上傳的照片中央為藍色（照片 160×160）。
- 再換一次，把框拖到最左邊 → 上傳照片左緣為紅色。
- 開對話框按取消 → 沒有 PUT 請求、對話框消失、頭像不變；Esc 同樣。
- 400px 寬：對話框不超出視窗、頁面不橫向捲動。
- 頁首選單換自己的照片流程照常（經過對話框）。

**範圍**：只改前端裁切流程；API、資料表、伺服器檢查不變。

## Risks / Trade-offs

- 注入樣式偏離「樣式放 css 檔」的慣例 → 換來兩套樣式表只維護一份，並在 account.js 檔頭說明。
- 很小的圖片（例如 100×100）裁切後放大到 160×160 會模糊 → 可接受，與現在行為相同。
