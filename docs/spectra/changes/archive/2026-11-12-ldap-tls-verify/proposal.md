## Problem

登入時使用者的公司密碼會送到 LDAP 綁定，但目前連線的加密並不可靠：

- `LDAP_URL` 是 `ldaps://` 而沒有設定 `LDAP_CA_FILE` 時，連線雖然加密，卻**不驗證伺服器憑證**（ldap3 預設 `CERT_NONE`），中間人可以冒充 LDAP 伺服器收下帳密。
- `LDAP_URL` 是 `ldap://` 時，帳密以**明文**送出，沒有 StartTLS 可選。

即將把登入從測試用 dev-ldap 切換到公司 LDAP（roadmap「公司 LDAP 切換驗證」），切換前必須先修。

## Root Cause

`webapp/auth.py` 的 `ldap_server()` 只在 `LDAP_CA_FILE` 有值時才建立 `Tls(validate=CERT_REQUIRED)`，其餘情況傳入 `tls=None`，ldap3 便退回不驗證憑證；`ldap://` 路徑完全沒有 TLS 升級步驟。

## Proposed Solution

- `ldaps://`：一律以 `CERT_REQUIRED` 驗證伺服器憑證與主機名稱；有 `LDAP_CA_FILE` 時用它，沒有時用系統內建的 CA。
- `ldap://`：新增設定 `LDAP_TLS`，預設 `starttls`，在任何綁定前先以 StartTLS 升級為加密並驗證憑證；只有明確設為 `none` 才允許明文，並在啟動與每次 `check-ldap` 時警告。未知值記錄錯誤並採用 `starttls`（比照既有決定「SMTP_TLS 未知值改用 starttls」）。
- TLS 或憑證驗證失敗時，登入回應既有的 503「無法連線登入伺服器」，該次嘗試不計入密碼錯誤次數。
- `python -m auth check-ldap` 印出實際使用的加密方式（LDAPS／StartTLS／明文），方便切換公司 LDAP 時確認。
- 更新 `.env.example`、`compose.yaml`（傳入 `LDAP_TLS`）與 README 的 dev-ldap 設定說明。

**BREAKING**：現有以 `ldap://` 連線的環境（包含目前接 dev-ldap 的本機 `.env`）升級後預設改走 StartTLS；dev-ldap 要繼續用明文，需在 `.env` 加上 `LDAP_TLS=none`。依專案慣例 `.env` 由使用者修改。

## Non-Goals

- 不實作用戶端憑證（mutual TLS）。
- 不改登入 API、鎖定規則、session 與 Email 帶入邏輯。
- 不在本變更內完成公司 LDAP 的實際切換驗證（仍是 roadmap 的後續事項）。

## Success Criteria

- `ldaps://` 未設 `LDAP_CA_FILE` 時，建立的連線要求驗證伺服器憑證（單元測試斷言 `validate == CERT_REQUIRED`）。
- `ldap://` 預設在綁定前執行 StartTLS；StartTLS 失敗時不送出任何綁定，登入回應 503（單元測試）。
- `LDAP_TLS=none` 時允許明文綁定並記錄警告（單元測試）。
- 以 dev-ldap 實測：`LDAP_TLS=starttls` 且未提供 dev-ldap 的自簽 CA 時，`check-ldap` 回報無法連線；`LDAP_TLS=none` 時可登入。
- 既有 `test_server` 測試全部通過。

## Impact

- Affected specs: `user-auth`（新增需求「Encrypted LDAP connection」；既有「LDAP sign-in」不變）
- Affected code:
  - Modified: webapp/auth.py, webapp/test_server.py, compose.yaml, .env.example, README.md
  - New: 無
  - Removed: 無
