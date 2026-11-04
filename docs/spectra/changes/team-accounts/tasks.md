## 1. 資料庫基礎

- [x] 1.1 以 Postgres 作為資料庫：compose.yaml 新增 `db` 服務（`postgres:17`、named volume `meeting-db`、健康檢查、不映射主機 port），`app` 加 `DATABASE_URL` 並 `depends_on` db 健康；webapp/requirements.txt 加 `psycopg[binary]` 與 `ldap3`；.env.example 補 `POSTGRES_PASSWORD`、`LDAP_*`、`ADMIN_USERS` 範例（不含真實值）。驗證：`docker compose up -d db app` 後 `docker compose ps` 顯示 db healthy、app 正常啟動
- [x] 1.2 資料表結構以版本化 SQL migration 管理：新增 webapp/db.py 與 webapp/migrations/001_accounts.sql，app 啟動時依序套用未執行的版本並記錄於 `schema_migrations`，建立 design 所列 7 張表；重複啟動不重跑。驗證：test_server 新增 `test_migrations_apply_once`（對 `yuqiao_test` 連續套用兩次，表存在且版本只記一筆）[after: 1.1]

## 2. 登入與 session

- [x] 2.1 LDAP sign-in，LDAP 驗證採「搜尋後綁定」：新增 webapp/auth.py，空帳號或空密碼不連 LDAP 直接 401、使用者名稱轉小寫並跳脫過濾字元、LDAP 連不上回 503，另支援 `LDAP_USER_DN_TEMPLATE` 直接綁定模式；`POST /api/login` 回傳 `{username, displayName, admin, teams}`。驗證：以 ldap3 MOCK_SYNC 假伺服器的測試涵蓋 spec「LDAP sign-in」的 4 個 scenario 與輸入檢查表 [after: 1.2]
- [x] 2.2 Server-side sessions，伺服器端 session 存在 Postgres：登入成功發 32 bytes token、cookie `yq_session` 為 HttpOnly／SameSite=Lax（HTTPS 時 Secure）、資料庫只存 SHA-256、12 小時到期；`POST /api/logout` 刪 session 並清 cookie；`GET /api/me`。驗證：測試「過期 session 視為未登入」「登出後舊 token 失效」「資料庫中查不到明文 token」[after: 2.1]
- [x] 2.3 Repeated failed sign-ins are slowed down：同一帳號 5 分鐘內連續失敗 5 次後，第 6 次起回 429 且不連 LDAP，成功登入後歸零。驗證：測試以 MOCK 計數 bind 次數，確認第 6 次沒有呼叫 LDAP [after: 2.1]

## 3. 路由保護

- [x] 3.1 Routes require a signed-in user，以 FastAPI 相依項統一做登入檢查：`auth.current_user`／`auth.websocket_user` 套用到所有頁面、`/api/*` 與 `/ws/transcribe`，白名單為 `/login`、`/api/login`、`/api/logout`、`/api/health` 與登入頁靜態檔；頁面 303 到 `/login`，API 401，WebSocket 關閉碼 4401 且不連 ASR／MAI。驗證：測試涵蓋 spec 的 4 個 scenario（翻譯 API 不呼叫模型、WebSocket 不呼叫 `websockets.connect`）[after: 2.2]
- [x] 3.2 Cross-site requests are refused，檢查 Origin 防止跨站請求：POST／PUT／PATCH／DELETE 與 WebSocket 握手的 `Origin` host 與 `Host` 不符時回 403。驗證：測試「其他網站開 `/ws/transcribe` 被拒且不連 ASR」「同源 POST 正常」[after: 3.1]
- [x] 3.3 既有 29 個測試改用已登入的 client（共用 fixture：MOCK LDAP 登入並建立一個團隊）後全數通過。驗證：PowerShell `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部 OK [after: 3.1]

## 4. 團隊與會議歸屬

- [x] 4.1 System administrators 與 Teams and membership：`ADMIN_USERS` 判定管理員（啟動時把帳號名寫入日誌）；管理 API 建立、改名團隊，加入、移除成員（可加入尚未登入過的帳號），重名 409、非管理員 403。驗證：測試涵蓋兩個 requirement 的 scenario [after: 2.2]
- [x] 4.2 管理頁 `/admin`：管理員可在頁面上列出、建立、改名團隊並管理成員；非管理員開啟得到 403 頁面。驗證：以 gstack /browse 實際操作建立團隊、加入成員，並截圖確認桌面與手機寬度版面 [after: 4.1]
- [x] 4.3 A meeting belongs to one team，會議開始流程改為先建會議：`POST /api/meetings` 建立會議（非成員 404）、`GET /api/meetings` 只列所屬團隊；WebSocket 首包須帶 `meeting_id`，缺少或非成員關閉碼 4404；主頁新增團隊選單（單一團隊預選，無團隊時顯示 `尚未加入任何團隊，請聯絡管理員`）。驗證：測試涵蓋 3 個 scenario，並以 /browse 確認選單與無團隊提示 [after: 4.1, 3.1]
- [x] 4.4 Team isolation of meeting data 與 Administrators do not see team records implicitly：所有會議讀寫以 `team_access.require_member` 即時檢查成員資格，非成員與不存在一律 404，管理員沒有隱含權限，移除成員下一次請求即生效。驗證：測試「其他團隊成員」「被移除的成員」「團隊外的管理員」三個 scenario [after: 4.3]
- [x] 4.5 Meeting files are stored per meeting：以 `PUT /api/meetings/{id}/files/{kind}` 取代舊的 `PUT /api/meetings/{name}`，寫入 `output/teams/<team_id>/<meeting_id>/` 並記錄於 `meeting_files`，舊 `output/meeting-*` 不動也不提供；前端錄音與逐字稿改用新端點。驗證：改寫 `test_meeting_files_are_saved_to_output_and_names_are_restricted` 為新路徑並新增「存到他團隊會議回 404 且不寫檔」[after: 4.4]

## 5. 腳本、文件與正式連線

- [x] 5.1 自動化腳本以「容器內發 session」取代密碼：新增 `python -m auth issue-session <username> [--hours N]` 與 `python -m auth check-ldap <username>`（密碼以不回顯方式輸入）；webapp/replay_asr.py、webapp/replay_browser.py、webapp/ab_history.py、smoke_test.py、bench/probe.py 讀 `YUQIAO_SESSION`（與 `YUQIAO_TEAM`）帶入 cookie 並先建會議。驗證：用發出的 token 跑 `smoke_test.py` 與一段 `replay_asr.py` 成功取得逐字稿 [after: 4.5]
- [x] 5.2 文件：README.md 新增登入、團隊管理、部署設定與 `issue-session` 說明，bench/README.md 說明 `YUQIAO_SESSION`／`YUQIAO_TEAM`，docs/roadmap.md 標註本變更完成。驗證：內容檢查，文件中不出現任何真實密碼或金鑰 [after: 5.1]
- [ ] 5.3 正式 LDAP 連線驗證：使用者提供公司 LDAP 參數寫入 `.env` 後，以 `python -m auth check-ldap` 驗證，再由使用者在瀏覽器實際登入一次。驗證：使用者確認登入成功、頁首顯示正確顯示名稱 [after: 5.1]
