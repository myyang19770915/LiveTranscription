## 1. 加密連線

- [x] 1.1 依「LDAPS 一律以 CERT_REQUIRED 驗證憑證」與「新增 LDAP_TLS 設定，ldap:// 預設 StartTLS」，在 `webapp/auth.py` 讀取 `LDAP_TLS`，讓 `ldap_server()` 對 `ldaps://` 與 StartTLS 都建立 `Tls(validate=ssl.CERT_REQUIRED)`（有 `LDAP_CA_FILE` 時用它），並新增回傳加密方式（LDAPS／StartTLS／明文）的函式；未知值記錄 error 並視為 `starttls`，`none` 且為 `ldap://` 時於模組載入記錄 warning（依「明文模式的警告只在啟動與 check-ldap 時記錄」）。驗證：`test_server` 新增測試，逐列斷言 Encrypted LDAP connection 規格的「encryption chosen from settings」範例表（含 `validate == CERT_REQUIRED` 與 CA 檔路徑）。
- [x] 1.2 [after: 1.1] 依「StartTLS 與憑證失敗一律轉成 LdapUnavailable」，新增 `secure_bind(connection)`，`ldap_authenticate` 的三處綁定都改用它：StartTLS 模式先 `open()`＋`start_tls()`，成功才 `bind()`；`start_tls()` 失敗或拋出 `ssl.SSLError`／`LDAPException` 時拋出 `LdapUnavailable`，且不送出任何綁定。驗證：新增測試以假連線讓 StartTLS 失敗，斷言 bind 次數為 0、`POST /api/login` 回 503「無法連線登入伺服器」、`login_failures` 計數不變；另一測試斷言 `LDAP_TLS=none` 時照常綁定成功；既有 `FakeLdap` 登入測試全部通過。
- [x] 1.3 [after: 1.1] `python -m auth check-ldap <username>` 在結果前印出「加密方式：<LDAPS|StartTLS|明文>」。驗證：新增測試 patch `getpass` 與 `ldap_authenticate`，擷取輸出，斷言 `LDAP_URL=ldap://…` 且未設 `LDAP_TLS` 時含「加密方式：StartTLS」。

## 2. 設定與文件

- [x] 2.1 `compose.yaml` 的 app 服務傳入 `LDAP_TLS: ${LDAP_TLS:-starttls}`；`.env.example` 加入 `LDAP_TLS` 說明（`starttls`／`none`，`none` 只用於 dev-ldap）；README 設定參考表新增 `LDAP_TLS` 一列，dev-ldap 段落的 `.env` 範例加上 `LDAP_TLS=none`，並說明內部 CA 要設定 `LDAP_CA_FILE`。驗證：`docker compose config` 輸出的 app 環境含 `LDAP_TLS`；人工檢查 README 與 `.env.example` 的內容。

## 3. 實測

- [x] 3.1 [after: 1.2, 1.3, 2.1] 請使用者在本機 `.env` 加入 `LDAP_TLS=none`（依專案慣例 `.env` 由使用者修改），`docker compose up -d app` 後：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過；在 app 容器以 `LDAP_TLS=none` 執行 `python -m auth check-ldap` 對 dev-ldap 測試帳號，顯示「加密方式：明文」且登入成功；以 `LDAP_TLS=starttls`（不提供 dev-ldap 的自簽 CA）執行時，顯示「加密方式：StartTLS」並回報無法連線登入伺服器。
