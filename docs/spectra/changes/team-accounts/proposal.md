## Why

語橋 Live 目前沒有登入，任何能連到 :18082 的人都能使用，會議檔案存在 `output/` 也沒有歸屬。接下來要給多個團隊共用，且不同團隊的會議紀錄必須互相看不到；後續的會後校對（`meeting-review` 變更）與決議追蹤都要先有「使用者屬於哪個團隊」這個基礎。

## What Changes

- 新增 Postgres 服務（compose `db`），作為會議資料與帳號的正式儲存；資料保留在 named volume。
- 新增 LDAP 登入：使用者以公司 LDAP 帳號密碼登入，伺服器以 LDAP bind 驗證，不保存密碼；登入成功建立伺服器端 session（HttpOnly cookie）。
- 新增團隊與成員管理：系統管理員（由環境變數指定的 LDAP 帳號）可建立團隊、加入或移除成員；一位使用者可屬於多個團隊。
- 所有頁面、`/api/*` 與 `/ws/transcribe` 改為需要登入；未登入者導向登入頁。**BREAKING**：既有的未登入使用方式與 `bench/`、`webapp/replay_*.py` 重播腳本需改用登入或測試用 session。
- 開始會議時須選擇所屬團隊（只列出自己所屬的團隊），會議與其檔案記錄所屬團隊；之後所有會議資料的讀寫都以團隊成員身分檢查。
- 頁首顯示登入者與登出按鈕。

## Capabilities

### New Capabilities

- `user-auth`: LDAP 登入、session、登出，以及哪些路徑需要登入
- `team-access`: 團隊、成員、系統管理員，以及會議資料依團隊隔離的存取規則

### Modified Capabilities

(none)

## Impact

- 受影響程式：webapp/server.py（登入相依、路由保護、團隊 API）、webapp/static/app.js 與 webapp/static/index.html（登入狀態、團隊選擇）、新增 webapp/auth.py 與 webapp/db.py、新增 webapp/static/login.html 與管理頁
- 相依套件：webapp/requirements.txt 新增 psycopg（Postgres）與 ldap3（LDAP）
- 部署：compose.yaml 新增 `db` 服務與 volume，`app` 新增 DATABASE_URL、LDAP_*、ADMIN_USERS 等環境變數；.env.example 補上對應說明
- 工具：bench/run.py、webapp/replay_browser.py、webapp/replay_asr.py 需帶登入 session
- 文件：README.md 的部署與設定參考
