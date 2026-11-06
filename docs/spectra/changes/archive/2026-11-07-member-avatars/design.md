## Context

頭像目前完全在前端產生：團隊管理用 `initial(member)`（首字、淡綠底），待辦看板用 `ActionBoard.avatar(username, displayName)`（首字加 6 色之一，依帳號雜湊）。`users` 只在登入後才有資料列，而成員可以在第一次登入前就被加入團隊，所以照片不能放在 `users`。

## Goals / Non-Goals

**Goals:**

- 系統管理員在團隊管理為任一成員（含尚未登入過的）設定、更換、移除照片。
- 照片在團隊管理成員列表與待辦看板所有頭像位置顯示；沒有照片時維持現在的首字頭像。

**Non-Goals:**

- 使用者自行上傳、LDAP 帶入、手動裁切介面、紀要頁與逐字稿頁顯示頭像。

## Decisions

### 照片存資料庫的獨立資料表，以帳號為鍵

新增 `user_avatars(username text PRIMARY KEY, image bytea, content_type text, updated_at timestamptz, updated_by text)`。帳號一律小寫（與 `add_member` 一致）。不放 `users` 是因為尚未登入的成員沒有 `users` 資料列；不放檔案系統是因為照片很小（縮圖後通常 < 30 KB），存資料庫可隨 db 備份，也不需處理檔名與清理。

### 瀏覽器先縮圖，伺服器只驗證

前端用 `<canvas>` 取圖片中央正方形、縮成 160×160，輸出 WebP（瀏覽器不支援時退回 JPEG），再以原始位元組 `PUT` 上傳。伺服器不做影像處理（不新增 Pillow 依賴），只檢查：`content-type` 為 `image/png`、`image/jpeg` 或 `image/webp`，檔頭魔術位元組與宣告類型相符，大小 1 byte 到 256 KB。SVG 一律拒絕（可夾帶腳本）。

### 讀取網址帶版本，長時間快取

`GET /api/users/{username}/avatar` 回傳圖片，任何已登入者可讀（頭像是同事間的顯示資訊，與看板 `people` 的可見範圍一致即可，且不含會議內容）。回應帶原本的 `content-type`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=31536000, immutable`。各 API 回傳的 `avatarUrl` 為 `/api/users/{username}/avatar?v=<updated_at 毫秒>`，換照片時網址改變，所以可以長期快取；沒有照片時 `avatarUrl` 為 `null`。

### 看板用 people 對照負責人的照片

`/api/actions` 的 `people[]` 加 `avatarUrl`。卡片、泳道、面板的負責人從 `people` 依帳號找照片；負責人已不在團隊（不在 `people`）時退回首字頭像。`<img>` 載入失敗時也退回首字頭像。

## Implementation Contract

**API**

- `PUT /api/admin/users/{username}/avatar`（系統管理員；body 為圖片原始位元組，`content-type` 標頭為圖片類型）→ 200 `{"username", "avatarUrl"}`。錯誤：非管理員 403；類型不在允許清單或魔術位元組不符 415「只接受 PNG、JPEG 或 WebP 圖片」；空檔或超過 256 KB 413／422「照片太大，請選 256 KB 以內的圖片」（空檔 422「沒有收到圖片」）。帳號先 `strip().lower()`。
- `DELETE /api/admin/users/{username}/avatar`（系統管理員）→ 204；沒有照片 404「這位成員沒有照片」。
- `GET /api/users/{username}/avatar`（已登入）→ 200 圖片；沒有照片 404。未登入依現有規則 401。
- `GET /api/admin/teams` 每位成員加 `avatarUrl`（字串或 `null`）。
- `GET /api/actions` 的 `people[]` 加 `avatarUrl`。

**前端行為**

- 團隊管理成員列：頭像位置有照片顯示圓形照片，否則維持首字；每列多一個「設定照片」（已有照片時為「更換照片」）與「移除照片」（只在有照片時出現）文字按鈕。選檔後立即縮圖上傳，成功後重新載入列表；錯誤顯示在頁面頂端錯誤框。
- 待辦看板：`avatarFor` 有照片時輸出 `<img class="avatar-mini photo">`（`alt` 與 `title` 為名字，頭像篩選鈕靠它讀出是誰），尺寸與首字頭像相同；圖片載入失敗換回首字頭像。

**驗收**

- 單元測試（webapp/test_server.py `AvatarTests`）：管理員上傳 PNG 後 `GET` 取回相同位元組與類型；非管理員上傳 403；SVG／類型不符 415；超過 256 KB 413；移除後 `GET` 404；`/api/admin/teams` 與 `/api/actions` 帶出 `avatarUrl`，移除後為 `null`。
- e2e（bench/avatar_e2e.mjs）：在團隊管理為一位成員上傳產生的圖片 → 成員列顯示照片；待辦看板該人的頭像篩選鈕與卡片顯示照片；移除後兩處都回到首字頭像。

**範圍**：只動團隊管理與待辦看板；不改登入、LDAP、紀要頁。

## Risks / Trade-offs

- 任何已登入者都能以帳號讀到照片 → 照片只是頭像，且帳號本來就在看板 `people` 中可見；可接受。
- bytea 放資料庫會讓資料庫略為變大 → 每張上限 256 KB、實際約 10–30 KB（估計，以 160×160 WebP 的典型大小推算；以實際上傳後 `octet_length(image)` 確認）。
