## ADDED Requirements

### Requirement: Encrypted LDAP connection

Every LDAP bind that carries a password SHALL travel over a TLS connection whose server certificate and host name are verified, unless the operator has explicitly allowed plaintext. The encryption SHALL be chosen as follows:

- `LDAP_URL` starting with `ldaps://`: TLS from the first byte, certificate verification required. The CA SHALL be the file named by `LDAP_CA_FILE` when it is set, otherwise the system's default trusted CAs. `LDAP_TLS` SHALL be ignored.
- `LDAP_URL` starting with `ldap://` and `LDAP_TLS` unset or `starttls`: the connection SHALL be upgraded with StartTLS, with the same certificate verification, before any bind is sent.
- `LDAP_URL` starting with `ldap://` and `LDAP_TLS=none`: binds SHALL be sent in plaintext, and the system SHALL log a warning that passwords travel unencrypted.
- `LDAP_TLS` set to any other value: the system SHALL log an error naming the value and SHALL behave as `starttls`.

When the TLS handshake, StartTLS or certificate verification fails, the system SHALL NOT send the bind, SHALL respond to the sign-in with 503 and the message 無法連線登入伺服器, and SHALL NOT count the attempt toward the failed-attempt lock. The command `python -m auth check-ldap <username>` SHALL print which encryption it used (LDAPS, StartTLS, or plaintext) before reporting the result.

#### Scenario: LDAPS without a CA file still verifies the certificate

- **WHEN** `LDAP_URL` is `ldaps://ldap.corp.example` and `LDAP_CA_FILE` is empty
- **THEN** the connection requires a valid server certificate for `ldap.corp.example` signed by a system-trusted CA, and a server presenting a self-signed or mismatched certificate gets no bind

#### Scenario: Plain ldap URL upgrades with StartTLS by default

- **WHEN** `LDAP_URL` is `ldap://ldap.corp.example:389` and `LDAP_TLS` is not set
- **THEN** the system performs StartTLS with certificate verification before the first bind

#### Scenario: StartTLS failure blocks the bind

- **WHEN** StartTLS or certificate verification fails while a user signs in
- **THEN** no bind is sent, the system responds 503 with the message 無法連線登入伺服器, and the user's failed-attempt count is unchanged

#### Scenario: Plaintext only when explicitly allowed

- **WHEN** `LDAP_URL` is `ldap://dev-ldap:389` and `LDAP_TLS` is `none`
- **THEN** the system binds in plaintext and logs a warning that passwords travel unencrypted

##### Example: encryption chosen from settings

| LDAP_URL | LDAP_TLS | LDAP_CA_FILE | Encryption | Certificate check |
| -------- | -------- | ------------ | ---------- | ----------------- |
| ldaps://h | (unset) | (unset) | LDAPS | required, system CAs |
| ldaps://h | none | /ca.pem | LDAPS | required, /ca.pem |
| ldap://h | (unset) | (unset) | StartTLS | required, system CAs |
| ldap://h | starttls | /ca.pem | StartTLS | required, /ca.pem |
| ldap://h | none | (unset) | plaintext, warning logged | none |
| ldap://h | yes | (unset) | StartTLS, error logged | required, system CAs |

#### Scenario: check-ldap reports the encryption

- **WHEN** an operator runs `python -m auth check-ldap alice` with `LDAP_URL=ldap://ldap.corp.example` and `LDAP_TLS` unset
- **THEN** the output names StartTLS as the encryption before the sign-in result
