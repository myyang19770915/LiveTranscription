## 1. 照片儲存與 API

- [x] 1.1 新增 webapp/migrations/007_avatars.sql 建立 `user_avatars` 資料表；在 webapp/team_access.py 實作 `PUT`／`DELETE /api/admin/users/{username}/avatar`（僅系統管理員；PNG／JPEG／WebP 魔術位元組檢查、1 byte–256 KB、SVG 拒絕）與 `GET /api/users/{username}/avatar`（已登入、nosniff、長期快取），以及 `avatar_url(username, updated_at)` 產生帶版本的網址。驗證：webapp/test_server.py `AvatarTests` 涵蓋上傳取回、403、415、413、422、移除後 404。（Member profile photos；設計：照片存資料庫的獨立資料表，以帳號為鍵；讀取網址帶版本，長時間快取）
- [x] 1.2 `GET /api/admin/teams` 的成員與 `GET /api/actions` 的 `people[]` 帶出 `avatarUrl`（沒有照片為 `null`）[after: 1.1]。驗證：`AvatarTests` 斷言上傳後為 `/api/users/<帳號>/avatar?v=` 開頭、移除後為 `null`。

## 2. 團隊管理設定照片

- [x] 2.1 webapp/static/admin.html 成員列：有照片顯示圓形照片否則首字；「設定照片／更換照片」選檔後以 canvas 取中央正方形縮成 160×160（WebP，不支援時 JPEG）上傳；有照片時顯示「移除照片」；錯誤顯示在頁面錯誤框。webapp/static/admin.css 加照片樣式 [after: 1.2]。驗證：bench/avatar_e2e.mjs 上傳後成員列出現 `img.avatar`，移除後回到首字。（Member profile photos；設計：瀏覽器先縮圖，伺服器只驗證）

## 3. 待辦看板顯示照片

- [x] 3.1 webapp/static/actions.js `avatarFor` 依 `people` 的 `avatarUrl` 顯示 `<img class="avatar-mini photo">`，載入失敗換回首字；卡片、頭像篩選、負責人泳道、詳細面板都經過它；webapp/static/actions.css 照片樣式、webapp/static/actions.html 版本號 [after: 1.2]。驗證：bench/avatar_e2e.mjs 在看板的頭像篩選鈕與該人的卡片看到照片，移除後回到首字；bench/actions_e2e.mjs 照常全部通過。（Member profile photos；設計：看板用 people 對照負責人的照片）

## 4. 文件

- [x] 4.1 README 團隊管理段落與 bench/README 補上頭像照片與 bench/avatar_e2e.mjs 的說明 [after: 2.1, 3.1]。驗證：內容檢查。
