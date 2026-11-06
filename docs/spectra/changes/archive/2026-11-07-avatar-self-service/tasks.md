## 1. 自己的照片 API

- [x] 1.1 webapp/team_access.py 新增 `PUT`／`DELETE /api/me/avatar`，與管理員 API 共用 `store_avatar`／`delete_avatar`；`avatar_url` 移到 webapp/auth.py，`GET /api/me` 帶 `avatarUrl`。驗證：webapp/test_server.py `AvatarTests` 新測試涵蓋本人上傳後 `/api/me` 與讀取照片、移除後 `null`、SVG 415、一般使用者仍不能用管理員 API。（Member profile photos；設計：自己的照片走 /api/me/avatar）

## 2. 前端

- [x] 2.1 webapp/static/account.js 提供 `window.AvatarPhoto`（縮圖與上傳），頁首名字前顯示自己的頭像按鈕與選單（更換照片、移除照片，Esc／點外面關閉），成功後送出 `yq:avatar` 事件；admin.css 與 accounts.css 加樣式 [after: 1.1]。驗證：bench/avatar_e2e.mjs 從頁首選單換自己的照片，頁首與看板顯示，移除後回到首字。（設計：縮圖程式放進 account.js；頁首用小選單，不直接開檔案選擇器；換照片後以事件通知頁面）
- [x] 2.2 webapp/static/admin.html 成員頭像改為按鈕，點擊開檔案選擇器，拿掉「設定照片／更換照片」，只在有照片時留「移除照片」，改用 `AvatarPhoto`，收到 `yq:avatar` 重新載入 [after: 2.1]。驗證：bench/avatar_e2e.mjs 點頭像上傳、找不到「設定照片」按鈕。
- [x] 2.3 webapp/static/actions.css 頭像篩選鈕改為正圓置中、按下時 box-shadow 圓環；webapp/static/actions.js 收到 `yq:avatar` 重新載入；更新各 html 的資源版本號 [after: 2.1]。驗證：bench/avatar_e2e.mjs 按下有照片的篩選鈕後量測按鈕寬高相等。（設計：頭像篩選鈕排版）

## 3. 文件

- [x] 3.1 README 與 bench/README 更新為點頭像換照片、每個人可在頁首換自己的照片 [after: 2.2, 2.3]。驗證：內容檢查。
