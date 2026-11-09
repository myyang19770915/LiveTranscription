## 1. 資料與成員 Email

- [x] 1.1 migration `webapp/migrations/014_minutes_mail.sql` 新增 `users.email`／`email_source`、`teams.mail_target`／`mail_address`／`mail_auto`、`minutes.finalized_at`／`finalized_by` 與 `minutes_mail` 表（設計：Email 存在 users，記錄來源；團隊寄送設定放在 teams 表；定稿記在 minutes，自動寄送以寄送紀錄去重；寄送紀錄表 minutes_mail）；驗證：單元測試啟動時 migration 套用成功，`DatabaseTests` 通過
- [x] 1.2 [after: 1.1] Requirement「Member e-mail address」：登入時從 LDAP 讀 `LDAP_MAIL_ATTR` 寫入 Email 與來源（LDAP 清空時清掉 ldap 來源、保留 self 來源）；`GET /api/me` 回傳 `email`／`emailSource`；`PUT /api/me/email` 依設計的格式規則與 409／422 回應；驗證：`test_server` 新增的 LDAP Email 測試（directory address、cannot change、self entry、example 表四列）通過

## 2. 寄送

- [x] 2.1 [after: 1.1] Requirement「Mail server configuration」與「Send minutes」的寄送核心，`webapp/mailer.py`（設計：寄送用標準函式庫 smtplib，在執行緒中同步寄出；收件人規則；信件內容）：SMTP 設定讀取、`send_message`（smtplib，ssl／starttls／none，15 秒逾時）、收件人計算（members／team、skipped）、信件組成（主旨、純文字沿用 `minutes.markdown`、HTML 跳脫、連結）；驗證：`MinutesMailTests` 的信件內容與跳脫測試通過
- [x] 2.2 [after: 2.1] Requirement「Team mail settings」「Finalize minutes」「Send minutes」「Send record」的 API：`PUT /api/teams/{team_id}/mail`、`POST …/minutes/finalize`（自動寄送只一次、失敗不影響定稿）、`POST …/minutes/send`（503／422／502 規則）、寫入 `minutes_mail`；`GET …/minutes` 帶出 `finalizedAt`／`finalizedBy`／`mail`；驗證：`MinutesMailTests` 涵蓋 spec 全部 Scenario 並通過，全部單元測試不退步

## 3. 介面

- [x] 3.1 [after: 1.2] 帳號選單「我的 Email」：顯示 Email 與來源，LDAP 來源唯讀，否則可儲存與清除並顯示錯誤；驗證：`bench/mail_e2e.mjs` 的帳號選單檢查通過
- [x] 3.2 [after: 2.2] 紀要頁寄送區塊：定稿按鈕與已定稿狀態、寄送紀要／再寄一次（寄送中停用）、最近寄送摘要與未寄到成員、寄送設定表單、SMTP 未設定時停用並說明；深淺主題與手機寬度不破版；驗證：`bench/mail_e2e.mjs` 截圖與檢查通過

## 4. 環境、文件與端到端

- [x] 4.1 compose `app` 增加 `SMTP_*`、`PUBLIC_BASE_URL`、`LDAP_MAIL_ATTR` 環境變數；新增 profile `dev-mail` 的 Mailpit 服務（設計：Mailpit 只在 dev-mail profile）（網頁信箱只綁 127.0.0.1:18025）；`.env.example` 與 README（設定表、寄送紀要使用方式、dev-mail）更新；dev-ldap 的 alice 加上 `mail`；驗證：`docker compose --profile dev-mail up -d dev-mail` 啟動、README 內容檢視
- [x] 4.2 [after: 3.1, 3.2, 4.1] 端到端 `bench/mail_e2e.mjs`：在 Mailpit 確認手動寄送與定稿自動寄送各收到一封、主旨與收件人正確、只含已確認條目、HTML 已跳脫；測試資料事後清除；驗證：腳本輸出 all ok
