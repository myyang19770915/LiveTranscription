## Why

roadmap P5 ②「寄送」：會議紀要整理好之後，目前只能下載 Markdown 自己轉寄，與會者常常沒收到、或收到的是沒確認過的版本。公司內部用 Email 溝通，紀要確認後應該由系統直接寄給團隊。`action-tracking` 當時把「通知（Email、即時推播）」列為 P5 的範圍限制，現在進入 P5。

## What Changes

- **成員 Email**：登入時從 LDAP 讀取 email 屬性（`LDAP_MAIL_ATTR`，預設 `mail`）存進 `users.email`；LDAP 有值時以 LDAP 為準、使用者不能改；LDAP 沒有時，使用者可在右上角帳號選單「我的 Email」自行填寫或清除。
- **SMTP 設定**：`.env` 新增 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`、`SMTP_TLS`（`starttls`／`ssl`／`none`）與 `PUBLIC_BASE_URL`（信中連結用）。沒設定 `SMTP_HOST` 時寄送功能停用並說明原因。
- **團隊寄送設定**（團隊任何成員可改）：收件對象「成員個人信箱」或「團隊群組信箱」（填一個地址）；「定稿後自動寄送」開或關。在紀要頁的寄送區塊設定。
- **定稿**：紀要頁新增「定稿」按鈕，記錄定稿人與時間；團隊開了自動寄送時，第一次定稿即寄出。
- **寄送紀要／再寄一次**：任何時候可手動寄送；信件為 HTML＋純文字，內容只含已確認條目（摘要、決議、待辦含負責人與到期日、問題、風險）與「開啟紀要」連結。顯示最近一次寄送的時間、寄件人、收件數，以及沒有 Email 而未寄到的成員。
- **寄送紀錄**：新資料表記錄每次寄送（成功或失敗原因），自動寄送同一場會議只會發生一次。
- **開發用測試信箱**：compose 新增 profile `dev-mail`（Mailpit），信件只進本機網頁信箱、不對外寄出；dev-ldap 的 alice 加上 email 以測試 LDAP 帶入。

## Non-Goals

- 待辦到期提醒信（下一個變更 `action-reminders`）。
- Teams／Slack／LINE 等其他通知管道、附件（錄音、逐字稿檔）、信件範本自訂。
- 只寄給「這場會議的與會者」：系統沒有記錄與會者名單，收件對象以團隊為單位。
- 外部議題追蹤平台同步（P5 ③）。

## Capabilities

### New Capabilities

- `minutes-mail`: 團隊寄送設定、紀要定稿、自動與手動寄送紀要、寄送紀錄。

### Modified Capabilities

- `user-auth`: 登入時從 LDAP 帶入 email，LDAP 沒有時成員可自行填寫。

## Impact

- 新增 webapp/mailer.py（SMTP 寄送、信件組成、寄送 API）與 webapp/migrations/014_minutes_mail.sql。
- 修改 webapp/auth.py（LDAP email、`/api/me` 與 `PUT /api/me/email`）、webapp/minutes.py（定稿欄位、紀要 API 帶出寄送狀態）、webapp/server.py（掛上 router）。
- 前端：webapp/static/minutes.html、webapp/static/minutes.js、webapp/static/minutes.css（定稿與寄送區塊、寄送設定）、webapp/static/account.js（我的 Email）。
- 設定：compose.yaml（SMTP_* 環境變數、dev-mail 服務）、.env.example、docker/dev-ldap/users.ldif、README.md。
- 測試：webapp/test_server.py、新增 bench/mail_e2e.mjs。
- 無新 Python 套件（使用標準函式庫 smtplib、email）。
