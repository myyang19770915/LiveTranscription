## Context

member-avatars 只讓系統管理員在團隊管理用文字按鈕設定照片；縮圖程式寫在 admin.html 裡。看板的 `.avatar-button` 是 `padding:0` 的 button，裡面的 `<img>` 以行內方式排版，按鈕高度被行高撐大，按下時的 `border-color` 外框因此變成橢圓、照片偏移。頁首帳號列由 account.js 產生，所有頁面（含舊版即時會議頁 index.html）都載入它。

## Goals / Non-Goals

**Goals:**

- 看板頭像篩選鈕不變形；團隊管理點頭像換照片；每個人能在頁首換自己的照片。

**Non-Goals:**

- 手動裁切、一般使用者改別人的照片、重新設計 index.html 頁首。

## Decisions

### 自己的照片走 /api/me/avatar

新增 `PUT /api/me/avatar` 與 `DELETE /api/me/avatar`，對象固定是目前登入的帳號，不接受網址中的帳號，所以不會誤改別人。與管理員 API 共用同一個 `store_avatar(username, request, by)`／`delete_avatar(username)`，檢查規則（類型、檔頭、大小、SVG 拒絕）完全一致。替代方案是放寬 `/api/admin/users/{username}/avatar` 讓本人也能用，但會把權限判斷混進管理員 API，不採用。

### 縮圖程式放進 account.js

account.js 已被所有頁面載入，把 `squarePhoto(file)` 與 `upload(url, file)` 以 `window.AvatarPhoto` 提供，團隊管理與頁首共用，不另外加一支 script 到每一頁。

### 頁首用小選單，不直接開檔案選擇器

頁首頭像點下去打開選單（更換照片、移除照片），而不是直接開檔案選擇器，因為頁首空間小、誤點機率高，而且需要一個地方放「移除照片」。團隊管理則依使用者要求直接點頭像就開檔案選擇器，移除另有按鈕。

### 換照片後以事件通知頁面

自己換或移除照片成功後，account.js 更新頁首頭像並在 `window` 送出 `yq:avatar` 事件；看板與團隊管理收到後重新載入資料，不重新整理整頁（即時會議頁錄音中不能被打斷）。

### 頭像篩選鈕排版

`.avatar-button` 改為 `display:inline-grid; line-height:0`，平常以 2px 頁面底色的 `box-shadow` 圓環和相鄰頭像分開，按下時再加一圈 4px 強調色外環，照片與首字都是固定尺寸的圓，不受行高影響。

## Implementation Contract

**API**

- `PUT /api/me/avatar`（已登入；body 為圖片原始位元組）→ 200 `{"username", "avatarUrl"}`；錯誤與管理員 API 相同（415、413、422）。
- `DELETE /api/me/avatar` → 204；沒有照片 404「這位成員沒有照片」。
- `GET /api/me` 多 `avatarUrl`（字串或 `null`）。
- 管理員 API 行為不變。

**前端**

- 團隊管理成員列：頭像為 `<button class="avatar-edit">`（`aria-label` 與 `title` 依是否有照片為「設定／更換 <名字> 的照片」），點擊開檔案選擇器；有照片時列上有「移除照片」；沒有「設定照片」「更換照片」文字按鈕。
- 頁首：`#account` 內在名字前有 `<button class="account-avatar">`（`aria-haspopup="menu"`），點擊開 `.account-menu`，選項「更換照片」、有照片時「移除照片」；點選單外或按 Esc 關閉。錯誤以選單內文字顯示，選單保持開啟且仍可用 Esc 或點外面關閉。系統管理員在團隊管理改自己那一列的照片時，頁首頭像也跟著更新（`yq:avatar-own` 事件）。
- 看板頭像篩選鈕：照片與首字都是正圓且置中，按下時是正圓外環。

**驗收**

- 單元測試 `AvatarTests`：一般使用者 `PUT /api/me/avatar` 後 `/api/me` 與 `GET /api/users/<自己>/avatar` 取回照片；`DELETE /api/me/avatar` 後 `avatarUrl` 為 `null`；SVG 415；一般使用者仍不能用管理員 API（403）。
- bench/avatar_e2e.mjs：團隊管理點頭像上傳、沒有「設定照片」按鈕；看板按下有照片的頭像篩選鈕時按鈕寬高相等；頁首選單換自己的照片後頁首與看板都顯示，移除後回到首字。

**範圍**：只改頭像相關；不動登入與其他頁面行為。

## Risks / Trade-offs

- 任何人都能把自己的照片換成任意圖片 → 與一般通訊軟體相同；系統管理員仍可在團隊管理移除。
