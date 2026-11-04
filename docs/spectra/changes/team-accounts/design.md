## Context

語橋 Live 目前完全沒有身分概念：`webapp/server.py` 的所有路由（頁面、`/api/translate*`、`/api/terms`、`PUT /api/meetings/{name}`、`/ws/transcribe`）任何人都能呼叫；會議錄音與逐字稿以 `meeting-<時間>.<副檔名>` 存在 `output/` 根目錄，沒有歸屬。接下來要給多個團隊共用，團隊之間的紀錄必須隔離，公司帳號在 LDAP。

這個變更是 `meeting-review`（錄音對齊與會後校對）的前置條件：會後校對的每一筆資料都要知道屬於哪個團隊、由誰修改。

現有呼叫端除了瀏覽器，還有 `webapp/replay_asr.py`、`webapp/replay_browser.py`、`webapp/ab_history.py`、`smoke_test.py`、`bench/probe.py`（經 `bench/run.py` 間接使用 replay 腳本），它們都直接連 :18082。

## Goals / Non-Goals

**Goals:**

- LDAP 帳密登入、伺服器端 session、登出
- 除健康檢查與登入相關外，所有頁面、API、WebSocket 都要登入
- 系統管理員管理團隊與成員；一人可屬多團隊
- 會議建立時歸屬團隊；會議與其檔案的讀寫都檢查團隊成員資格
- 自動化腳本（bench、replay、smoke test）能在不寫入密碼的情況下繼續運作

**Non-Goals:**

- SSO／OIDC（之後如需要，再加一種登入方式，session 機制可沿用）
- 由 LDAP 群組自動對應團隊（先由管理員在系統內維護；理由：組織的 LDAP 群組結構未知，對應規則之後再定）
- 團隊內的角色區分：團隊成員權限一致，都能看、聽、改（使用者 2026-11-04 決定）
- 刪除團隊、搬移會議到其他團隊
- 舊的 `output/meeting-*` 檔案匯入資料庫（留在原地，不經 app 提供）
- 會議資料的結構化保存與校對（屬於 `meeting-review`）

## Decisions

### 以 Postgres 作為資料庫

compose 新增 `db` 服務（`postgres:17`，named volume `meeting-db`，僅 compose 內網，不對外映射 port）。app 以 `psycopg`（v3）連線，連線字串由 `DATABASE_URL` 提供。

替代方案：SQLite。多團隊、多人同時寫入、之後要做 pgvector 語意查詢，Postgres 較合適；使用者已同意。

### 資料表結構以版本化 SQL migration 管理

`webapp/migrations/NNN_*.sql` 依序執行，`schema_migrations` 記錄已套用版本；app 啟動時自動套用尚未執行的版本。不引入 ORM 或 Alembic，維持專案目前簡單直寫的風格。

本變更建立：

| 表 | 欄位 |
| --- | --- |
| `users` | `username`（PK，小寫）、`display_name`、`first_seen`、`last_seen` |
| `teams` | `id`（PK）、`name`、`name_key`（小寫去空白，UNIQUE）、`created_at` |
| `team_members` | `team_id`、`username`（不需先存在於 `users`）、`added_by`、`added_at`；PK (`team_id`, `username`) |
| `sessions` | `token_hash`（PK，SHA-256）、`username`、`created_at`、`expires_at` |
| `login_failures` | `username`（PK）、`count`、`first_failed_at`、`last_failed_at`（鎖定 5 分鐘從最後一次失敗起算） |
| `meetings` | `id`（UUID PK）、`team_id`、`created_by`、`started_at`、`language`、`engine` |
| `meeting_files` | `meeting_id`、`kind`（`recording`／`transcript`）、`path`、`bytes`、`saved_at` |

### LDAP 驗證採「搜尋後綁定」

以服務帳號（`LDAP_BIND_DN`／`LDAP_BIND_PASSWORD`）在 `LDAP_BASE_DN` 下用 `LDAP_USER_FILTER`（預設 `(sAMAccountName={username})`，相容 AD；OpenLDAP 可設 `(uid={username})`）找出使用者 DN，再以該 DN 與使用者密碼綁定。使用者名稱先經 `ldap3.utils.conv.escape_filter_chars` 跳脫。顯示名稱取 `LDAP_DISPLAY_ATTR`（預設 `displayName`）。`LDAP_URL` 支援 `ldaps://`；`LDAP_CA_FILE` 可指定 CA。使用 `ldap3`（純 Python，不需系統函式庫）。

替代方案：直接用 DN 樣板綁定（`uid={username},ou=people,...`）。AD 環境 DN 不固定，搜尋後綁定較通用；若沒有服務帳號，可設 `LDAP_USER_DN_TEMPLATE` 直接綁定，作為第二種模式。

### 伺服器端 session 存在 Postgres

登入成功產生 32 bytes 隨機 token（`secrets.token_urlsafe(32)`），cookie `yq_session`（HttpOnly、SameSite=Lax、HTTPS 時 Secure），資料庫只存 SHA-256。有效 12 小時（自登入起算，不延長）。登出刪除該筆 session。

替代方案：簽章 cookie（無狀態）。無法即時撤銷；伺服器端 session 可在登出或停權時立即失效。

### 以 FastAPI 相依項統一做登入檢查

全 app 掛一個相依項 `auth.require_signed_in`（HTTP 與 WebSocket 共用），另有 `auth.current_user` 供個別路由取得使用者；`team_access.require_member(conn, user, meeting_id)` 在同一個資料庫連線中檢查會議所屬團隊的成員資格，非成員一律 404。頁面路由未登入時 303 導向 `/login`；未登入的 WebSocket 先接受再以 4401 關閉（握手前關閉，瀏覽器只會看到 1006）。公開路徑：`/login`、`/api/login`、`/api/logout`、`/api/health`，以及 `/assets/` 下的靜態檔（程式、樣式、圖片，不含會議資料）。

### 檢查 Origin 防止跨站請求

POST／PUT／PATCH／DELETE 與 WebSocket 握手，若有 `Origin` 且其 host 與 `Host` 不同就回 403。搭配 SameSite=Lax，避免其他網站借用已登入的 cookie 開 WebSocket 錄音。

### 會議開始流程改為先建會議

前端開始會議時先 `POST /api/meetings {team_id, language, engine}` 取得 `meeting_id`，WebSocket 首包（JSON header）帶 `meeting_id`；server 驗證成員資格後才連 ASR/MAI。檔案儲存改為 `PUT /api/meetings/{meeting_id}/files/{kind}`，存到 `output/teams/<team_id>/<meeting_id>/`。舊的 `PUT /api/meetings/{name}` 移除。

### 自動化腳本以「容器內發 session」取代密碼

新增指令 `python -m auth issue-session <username> [--hours N]`，只能在 app 容器內執行（能進容器即代表有主機權限），輸出一個 session token。腳本讀環境變數 `YUQIAO_SESSION`，HTTP 以 cookie、WebSocket 以 `Cookie` header、Playwright 以 `context.add_cookies` 帶入；需要開會議的腳本另讀 `YUQIAO_TEAM`（團隊名稱）。

替代方案：腳本存放 LDAP 帳密，或提供「關閉登入」的開發模式。前者會讓密碼散落在腳本與 shell 歷史；後者容易被誤開在正式環境。

### 開發用測試 LDAP

連不到公司 LDAP 時，compose profile `dev-ldap` 啟動 `osixia/openldap`，以 `docker/dev-ldap/users.ldif` 載入測試帳號（不對外開 port，正式環境不啟動）。程式不需要區分：只要把 `LDAP_*` 指向 `ldap://dev-ldap:389` 並用 `(uid={username})` 過濾。單元測試另以 ldap3 MOCK 伺服器執行，並固定所有 `LDAP_*` 設定，不受 `.env` 影響。

## Implementation Contract

**可觀察的行為：**

- 未登入開 `/` → 303 到 `/login`；登入頁送出帳密 → 成功回到 `/`，頁首顯示顯示名稱與「登出」。
- `POST /api/login {username, password}` → 200 `{username, displayName, admin, teams:[{id,name}]}` 並設 cookie；401 `帳號或密碼錯誤`；429 `嘗試次數過多，請稍後再試`；503 `無法連線登入伺服器`。
- `POST /api/logout` → 204，清 cookie。
- `GET /api/me` → 同登入回應內容；未登入 401。
- 管理 API（非管理員 403）：`GET/POST /api/admin/teams`、`PATCH /api/admin/teams/{id}`（改名）、`POST /api/admin/teams/{id}/members {username}`、`DELETE /api/admin/teams/{id}/members/{username}`；重名 409。
- 管理頁 `/admin`：列出團隊、建立、改名、加入／移除成員；非管理員開啟回 403 頁面。
- `POST /api/meetings {team_id, language, engine}` → 201 `{id}`；非成員或團隊不存在 404。
- `GET /api/meetings` → 只列出使用者所屬團隊的會議（id、團隊、開始時間、建立者、語言）。
- `PUT /api/meetings/{id}/files/{kind}`（`kind` ∈ `recording`、`transcript`）→ 寫入 `output/teams/<team_id>/<meeting_id>/`，大小上限沿用 1 GiB；非成員 404。
- `/ws/transcribe`：未登入關閉碼 4401；header 缺 `meeting_id` 或非成員關閉碼 4404；兩者都不會連線 ASR／MAI。
- 主頁在「開始」旁新增團隊選單；只有一個團隊時預選；沒有團隊時按開始顯示 `尚未加入任何團隊，請聯絡管理員`。

**錯誤與失敗模式：** LDAP 連不上 → 503，不建 session；資料庫連不上 → app 啟動失敗並在日誌寫明 `DATABASE_URL` 無法連線（compose 以 `depends_on` 等 db 健康）；migration 失敗 → app 不啟動。

**驗收：**

- `webapp/test_server.py` 新增測試涵蓋兩份 spec 的每個 scenario，LDAP 以 `ldap3` 的 MOCK_SYNC 假伺服器模擬，資料庫使用 compose `db` 中的測試資料庫 `yuqiao_test`（每個測試前清空）。
- 既有 29 個測試改為以已登入的 client 執行後全數通過。
- `python -m auth issue-session` 產生的 token 讓 `webapp/replay_asr.py` 與 `smoke_test.py` 正常跑完一段音檔。

**範圍內：** 上述 API、頁面、資料表、compose、腳本、README 與 .env.example。
**範圍外：** 見 Non-Goals。

## Risks / Trade-offs

- [LDAP 設定錯誤導致所有人無法登入] → 啟動時不連 LDAP，但 `/api/health` 之外新增 `python -m auth check-ldap <username>` 互動檢查（提示輸入密碼，不顯示），部署時先驗證。
- [管理員帳號打錯，沒人能管理團隊] → `ADMIN_USERS` 在 app 啟動時寫入日誌（只寫帳號名）；修改 .env 後重啟即可。
- [現有 bench／replay 流程中斷] → 同一變更內更新所有腳本並在 bench/README.md 說明 `YUQIAO_SESSION`。
- [失敗次數限制被用來鎖別人的帳號] → 只鎖 5 分鐘、只鎖本系統的登入，不影響 LDAP 帳號本身；接受此取捨。
- [session token 外洩] → cookie HttpOnly；資料庫只存雜湊；12 小時到期。

## Migration Plan

1. 部署前在 `.env` 設定 `POSTGRES_PASSWORD`、`LDAP_*`、`ADMIN_USERS`（`.env.example` 提供範例，不含真實值）。
2. `docker compose up -d db app`；app 啟動時自動套用 migration。
3. 管理員登入 `/admin` 建立團隊、加入成員。
4. 舊 `output/meeting-*` 檔案維持原地不動。
5. 回滾：切回前一版 app image／程式碼即可；`db` 服務與資料保留，不影響舊版運作（舊版不使用資料庫）。

## Open Questions

- 公司 LDAP 的實際參數（URL、Base DN、使用者過濾條件、是否有服務帳號、是否需 ldaps 與 CA）需由使用者提供；在提供前以 MOCK 測試開發，正式連線驗證列為最後一項任務。
