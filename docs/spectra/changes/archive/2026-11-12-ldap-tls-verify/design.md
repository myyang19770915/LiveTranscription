## Context

登入流程（`webapp/auth.py` 的 `ldap_authenticate`）會建立一到兩條 LDAP 連線：搜尋後綁定模式先以服務帳號綁定搜尋，再以使用者密碼綁定；DN 範本模式直接以使用者密碼綁定。連線都由 `ldap_connection()` 經 `ldap_server()` 建立，測試以 ldap3 `MOCK_SYNC` 的 `FakeLdap` 取代 `ldap_connection`。

現況：`ldap_server()` 只在 `LDAP_CA_FILE` 有值時傳入 `Tls(validate=CERT_REQUIRED)`，否則 `tls=None`，ldap3 對 `ldaps://` 便以 `CERT_NONE` 連線；`ldap://` 沒有任何 TLS 升級。目前本機 `.env` 用 `ldap://dev-ldap:389`（osixia/openldap 測試目錄，只在 Compose 網路內）。

已查證 ldap3 2.9.1（`webapp/requirements.txt`）的 `Tls.wrap_socket`：沒有指定 CA 時以 `create_default_context` 載入系統 CA；`validate` 為 `CERT_REQUIRED` 且進行交握時會呼叫 `check_hostname` 比對伺服器主機名稱。

登入端點在 `ldap_authenticate` 拋出 `LdapUnavailable` 時呼叫 `release_attempt`，該次嘗試不計入鎖定，並回應 503「無法連線登入伺服器」。本變更沿用這條路徑。

## Goals / Non-Goals

**Goals:**

- 任何帶密碼的 LDAP 綁定都在已驗證憑證與主機名稱的 TLS 連線上進行，除非明確設定允許明文。
- 驗證失敗時登入失敗得清楚（503），且不洩漏密碼、不計入鎖定。
- 切換公司 LDAP 時，`check-ldap` 能直接看出實際的加密方式。

**Non-Goals:**

- 用戶端憑證（mutual TLS）、自訂 TLS 版本或加密套件。
- 登入 API、鎖定規則、session、Email 帶入邏輯。
- 公司 LDAP 的實際切換與驗證（roadmap 後續事項）。
- 讓 dev-ldap 改用 TLS（它只在 Compose 內部網路，維持明文並明確標示）。

## Decisions

### LDAPS 一律以 CERT_REQUIRED 驗證憑證

`ldap_server()` 對 `ldaps://` 永遠建立 `Tls(validate=ssl.CERT_REQUIRED, ca_certs_file=LDAP_CA_FILE or None)`。沒有 CA 檔時 ldap3 使用系統 CA。

替代方案：沒有 CA 檔時拒絕啟動 → 公司 LDAP 若使用公開 CA 簽發的憑證，就會被迫多一個多餘設定，不採用。

### 新增 LDAP_TLS 設定，ldap:// 預設 StartTLS

`LDAP_TLS` 可為 `starttls`（預設）或 `none`；未知值記錄錯誤並採 `starttls`。比照既有決定 `review-followups` / 「SMTP_TLS 未知值改用 starttls」：「伺服器不支援時寄送失敗並顯示原因，不會靜默以明文送出帳密」。本變更把同一原則套用到 LDAP。

替代方案：
- 以 URL 決定、`ldap://` 一律明文 → 正是要修的問題。
- `ldap://` 一律拒絕 → dev-ldap 無法使用，且公司 AD 常只開 389＋StartTLS。

### StartTLS 與憑證失敗一律轉成 LdapUnavailable

在綁定前執行 StartTLS 的位置集中於一個函式（例如 `secure_bind(connection)`：需要時先 `open()`＋`start_tls()`，成功才 `bind()`），`ldap_authenticate` 中三處 `bind()` 都改呼叫它。`start_tls()` 回傳失敗、或拋出 `ssl.SSLError`／`LDAPException` 時，一律拋出 `LdapUnavailable`，原因寫進 log，不回給瀏覽器。這樣登入端點既有的 503＋`release_attempt` 路徑不必修改。

替代方案：用 ldap3 `auto_bind=AUTO_BIND_TLS_BEFORE_BIND` → 綁定會在建構 `Connection` 時發生，與測試替換 `ldap_connection` 的方式和既有的「綁定失敗回傳 None」流程衝突，不採用。

### 明文模式的警告只在啟動與 check-ldap 時記錄

`LDAP_TLS=none` 且 URL 為 `ldap://` 時，模組載入時記錄一次 warning，`check-ldap` 的輸出也標示「明文」。不在每次登入時記錄，避免洗版。

## Implementation Contract

**行為**

| LDAP_URL | LDAP_TLS | 綁定前的連線 |
| --- | --- | --- |
| `ldaps://…` | 任意（忽略） | LDAPS，`CERT_REQUIRED`，CA＝`LDAP_CA_FILE` 或系統 CA |
| `ldap://…` | 未設定／`starttls` | StartTLS，同上驗證 |
| `ldap://…` | `none` | 明文；啟動時 warning |
| `ldap://…` | 其他值 | 啟動時 error 記錄該值；StartTLS |

**介面**

- 新環境變數 `LDAP_TLS`：`compose.yaml` 的 app 服務以 `${LDAP_TLS:-starttls}` 傳入；`.env.example` 加上說明；README 設定參考表新增一列，dev-ldap 段落的 `.env` 範例加上 `LDAP_TLS=none`。
- `auth` 模組新增一個回傳目前加密方式的函式（值為 `LDAPS`、`StartTLS`、`明文`），供 `check-ldap` 與測試使用。
- `python -m auth check-ldap <username>` 在結果前先印一行「加密方式：<值>」。

**失敗模式**

- TLS 交握、StartTLS、憑證或主機名稱驗證失敗 → `LdapUnavailable`（log 記錄原因）→ 登入回應 503「無法連線登入伺服器」、不設 cookie、不計入鎖定；`check-ldap` 印出「無法連線登入伺服器：<原因>」並以代碼 2 結束（既有行為）。
- StartTLS 失敗時不得送出任何綁定（服務帳號與使用者都不行）。

**驗收**

- `webapp/test_server.py` 新增測試：
  - `ldap_server()` 對 `ldaps://` 在沒有 CA 檔時 `tls.validate == CERT_REQUIRED`。
  - 有 CA 檔時使用該檔。
  - 依上表決定加密方式（含未知值記錄錯誤）。
  - StartTLS 失敗時 bind 次數為 0、登入回 503 且鎖定計數不變。
  - `none` 時照常綁定。
- 既有 `test_server` 全部通過（`FakeLdap` 測試以 `LDAP_TLS=none` 或替換 StartTLS 步驟執行）。
- 手動：以 dev-ldap 實測 `LDAP_TLS=starttls`（未提供其自簽 CA）時 `check-ldap` 回報無法連線；`LDAP_TLS=none` 時可登入。

**範圍**

- 範圍內：`webapp/auth.py` 的連線建立與綁定、`check-ldap` 輸出、測試、`compose.yaml`、`.env.example`、README。
- 範圍外：本機 `.env`（依專案慣例由使用者加入 `LDAP_TLS=none`）、登入頁、鎖定規則、SMTP。

## Risks / Trade-offs

- [升級後目前接 dev-ldap 的環境無法登入] → 在 tasks 與完成回報中明確提醒使用者於 `.env` 加入 `LDAP_TLS=none`。README 的 dev-ldap 範例同步更新。
- [公司 LDAP 使用內部 CA，系統 CA 不認得] → 登入回 503；以 `LDAP_CA_FILE` 指定內部 CA。README 說明這個情況，`check-ldap` 會顯示錯誤原因。
- [ldap3 只在交握時檢查主機名稱，若某條路徑未交握就不會檢查] → 用 dev-ldap 的手動驗證確認 StartTLS 路徑在 CA 不符時確實失敗；LDAPS 路徑以單元測試確認 `Tls` 設定。主機名稱不符的實測，留到公司 LDAP 切換驗證時一併確認。

## Migration Plan

1. 部署新版 app。
2. 使用 dev-ldap 的環境先在 `.env` 加入 `LDAP_TLS=none`，再 `docker compose up -d app`。
3. 公司 LDAP：用 `ldaps://`，或 `ldap://` 搭配預設 StartTLS；內部 CA 時設定 `LDAP_CA_FILE`；以 `check-ldap` 確認加密方式與登入。

回滾：還原 `webapp/auth.py` 與 `compose.yaml`，`LDAP_TLS` 會被舊版忽略。
