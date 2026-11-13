# user-auth Specification

## Purpose

Yuqiao Live is shared by several teams, so every user signs in with their company LDAP account before using it. This capability covers sign-in, sessions, sign-out, and which routes require a signed-in user.

## Requirements

### Requirement: LDAP sign-in

The system SHALL authenticate a user by binding to the configured LDAP server with the submitted username and password, and SHALL NOT store the password. Usernames SHALL be compared case-insensitively and stored in lower case. A request with an empty username or empty password SHALL be rejected without contacting LDAP, because many LDAP servers treat an empty-password simple bind as an anonymous bind that succeeds.

#### Scenario: Correct credentials

- **WHEN** a user submits a username and password that the LDAP server accepts
- **THEN** the system creates a session, sets the session cookie, and responds with the username and display name

#### Scenario: Wrong credentials

- **WHEN** a user submits a password that the LDAP server rejects
- **THEN** the system responds 401 with the message 帳號或密碼錯誤 and sets no cookie

#### Scenario: Empty password is never sent to LDAP

- **WHEN** a user submits a known username with an empty password
- **THEN** the system responds 401 without any LDAP bind attempt

##### Example: input checks

| Username | Password | Result |
| -------- | -------- | ------ |
| "Alice" | correct | signed in as "alice" |
| "alice" | "" | 401, no LDAP call |
| "" | "x" | 401, no LDAP call |
| "a*)(uid=*" | "x" | 401; the filter characters are escaped before the LDAP search |

#### Scenario: LDAP server unreachable

- **WHEN** the LDAP server cannot be reached during sign-in
- **THEN** the system responds 503 with the message 無法連線登入伺服器 and sets no cookie


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Repeated failed sign-ins are slowed down

The system SHALL reject further sign-in attempts for a username for 5 minutes after 5 consecutive failed attempts for that username, responding 429 without contacting LDAP. A successful sign-in SHALL reset the count.

#### Scenario: Sixth attempt after five failures

- **WHEN** a username has failed sign-in 5 times within 5 minutes and a sixth attempt arrives
- **THEN** the system responds 429 with the message 嘗試次數過多，請稍後再試 and does not contact LDAP


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Server-side sessions

The system SHALL keep sessions on the server. The cookie SHALL hold only a random token of at least 32 bytes, SHALL be HttpOnly and SameSite=Lax, and SHALL be Secure when the request arrived over HTTPS. The server SHALL store only a hash of the token. A session SHALL expire 12 hours after sign-in.

#### Scenario: Expired session

- **WHEN** a request carries a session token whose session was created more than 12 hours ago
- **THEN** the system treats the request as signed out

#### Scenario: Sign-out

- **WHEN** a signed-in user signs out
- **THEN** the system deletes the session on the server and clears the cookie, and a later request with the old token is treated as signed out


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Routes require a signed-in user

Every page, every `/api/*` route and the `/ws/transcribe` WebSocket SHALL require a valid session, except the sign-in page, the sign-in and sign-out API, the static assets under `/assets/` (page code, styles and images; they contain no meeting data), and `/api/health`. An API request without a valid session SHALL be refused with 401; a WebSocket without one SHALL be accepted and then closed with code 4401 before any audio is forwarded, so the browser receives the code; a page request SHALL be redirected to the sign-in page.

#### Scenario: Translation API without a session

- **WHEN** a request without a valid session calls `/api/translate/stream`
- **THEN** the system responds 401 and sends nothing to the translation model

#### Scenario: Transcription WebSocket without a session

- **WHEN** a WebSocket connects to `/ws/transcribe` without a valid session
- **THEN** the system closes it with code 4401 and opens no connection to ASR or MAI

#### Scenario: Main page without a session

- **WHEN** a browser without a valid session opens `/`
- **THEN** the system redirects it to the sign-in page

#### Scenario: Health check stays public

- **WHEN** a request without a session calls `/api/health`
- **THEN** the system responds 200


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Cross-site requests are refused

For state-changing requests (POST, PUT, PATCH, DELETE) and for the `/ws/transcribe` handshake, the system SHALL refuse the request with 403 when the `Origin` header is present and its host does not match the request's own `Host` header.

#### Scenario: WebSocket from another site

- **WHEN** a page on another origin opens `/ws/transcribe` with the user's cookie
- **THEN** the system refuses the handshake and opens no ASR connection

<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Member e-mail address

At sign-in the system SHALL read the user's e-mail address from the LDAP attribute named by `LDAP_MAIL_ATTR` (default `mail`) and store it as the user's address with source `ldap`. When LDAP has no address and the stored address came from LDAP, the stored address SHALL be cleared; an address the user entered (source `self`) SHALL be kept. A signed-in user whose address does not come from LDAP SHALL be able to set or clear their own address; an address from LDAP SHALL NOT be changeable by the user. `GET /api/me` SHALL report the address and its source. An address SHALL be accepted only as a plain ASCII address: a local part of letters, digits and the characters ``.!#$%&'*+/=?^_`{|}~-`` (no quotes, commas, semicolons, angle brackets or spaces), `@`, and a domain of letters, digits and hyphens with at least one dot, at most 254 characters; an LDAP value that is not such an address SHALL be ignored.

#### Scenario: Address from the directory

- **WHEN** alice signs in and LDAP has `mail: alice@corp.example`
- **THEN** `GET /api/me` reports email `alice@corp.example` with source `ldap`

#### Scenario: Directory address cannot be changed

- **WHEN** alice, whose address comes from LDAP, saves a different address
- **THEN** the system responds 409 with the message Email 由公司目錄提供，無法修改

#### Scenario: Entering one's own address

- **WHEN** bob, who has no address in LDAP, saves `bob@corp.example`
- **THEN** the address is stored with source `self` and kept on his next sign-in

##### Example: address checks

| Input | Result |
| ----- | ------ |
| " bob@corp.example " | stored as "bob@corp.example" |
| "" | address cleared |
| "bob.chen+mt@corp-tw.example" | stored |
| "bob@corp" | 422 Email 格式不正確 |
| "a b@corp.example" | 422 Email 格式不正確 |
| "\"x@corp.example" | 422 Email 格式不正確 |
| "a@b.example,root" | 422 Email 格式不正確 |
| "測試@corp.example" | 422 Email 格式不正確 |

<!-- @trace
source: review-followups
updated: 2026-11-09
code:
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/reminders.py
  - webapp/static/index.html
  - webapp/static/overlay.css
  - webapp/static/app.js
  - webapp/mailer.py
  - bench/translate_e2e.mjs
  - bench/reminders_e2e.mjs
  - README.md
  - webapp/static/actions.html
  - webapp/auth.py
  - webapp/static/actions.css
  - webapp/static/actions.js
  - webapp/static/minutes.html
tests:
  - webapp/test_server.py
-->

---
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

<!-- @trace
source: ldap-tls-verify
updated: 2026-11-12
code:
  - asr_session.py
  - README.md
  - compose.yaml
  - ws_server.py
  - webapp/server.py
  - test_asr_session.py
  - webapp/auth.py
  - .env.example
tests:
  - webapp/test_server.py
-->

---
### Requirement: Failed sign-ins from one address are limited

Besides the per-username lock, the system SHALL count failed sign-ins (wrong username or password) per client IP address, as seen after the trusted proxy headers. After `LOGIN_IP_MAX_FAILURES` (default 30) failures from one address within 5 minutes, every sign-in from that address SHALL be answered with 429 and the message 嘗試次數過多，請稍後再試 without contacting LDAP, until fewer than that many failures from it remain within the last 5 minutes. Attempts refused because LDAP was unreachable SHALL NOT count, and a successful sign-in SHALL NOT clear the address's count (many people can share one address). The count SHALL be kept in the app's memory.

#### Scenario: Guessing many usernames from one address

- **WHEN** one address fails to sign in 30 times within 5 minutes with 30 different usernames and then tries a correct password
- **THEN** that attempt is answered 429 without contacting LDAP, while sign-ins from another address still work

##### Example: one address

| Failures from the address in the last 5 minutes | Next attempt |
| ----------------------------------------------- | ------------ |
| 29 | checked with LDAP |
| 30 | 429, LDAP not contacted |
| 30, the oldest 6 minutes ago | checked with LDAP |

<!-- @trace
source: stream-limits
updated: 2026-11-12
code:
  - bench/guardcheck.js
  - bench/checks.js
  - docker/asr/entrypoint.sh
  - webapp/.dockerignore
  - webapp/static/app.js
  - bench/contextcheck.js
  - webapp/auth.py
  - README.md
  - webapp/Dockerfile
  - bench/reviewcheck.js
  - test_asr_session.py
  - webapp/static/index.html
  - webapp/static/styles.css
  - webapp/mailer.py
  - docker/asr/constraints.txt
  - webapp/static/review.html
  - webapp/qa.py
  - compose.yaml
  - ws_server.py
  - webapp/migrations/016_reminder_claims.sql
  - bench/savecheck.js
  - webapp/static/minutes.html
  - bench/closecheck.js
  - webapp/static/minutes.js
  - webapp/static/review.js
  - bench/mailchangecheck.js
  - webapp/migrations/017_mail_setting_changes.sql
  - webapp/stream_limits.py
  - asr_session.py
  - bench/catalogcheck.js
  - webapp/reminders.py
  - webapp/server.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Sign-in returns to the requested page

When a page request without a valid session is redirected to the sign-in page, the redirect SHALL be to `/login?next=<value>`, where the value is the percent-encoded path and query string of the request; a request for `/` SHALL be redirected to `/login` with no `next`, and so SHALL a request whose path and query string together exceed 2000 characters. When page code sends the browser to the sign-in page because the session is no longer valid, it SHALL pass the current path and query string the same way. After a successful sign-in the sign-in page SHALL open the `next` path, followed by the fragment of the sign-in page address when there is one. A `next` value SHALL be used only when it starts with a single `/`, its second character is neither `/` nor `\`, and it contains no backslash and no control character; any other value, or no value, SHALL lead to `/`.

#### Scenario: Deep link while signed out

- **WHEN** a browser without a valid session opens `/meetings/abc/minutes?item=50`
- **THEN** it is redirected to `/login?next=%2Fmeetings%2Fabc%2Fminutes%3Fitem%3D50`, and after a successful sign-in the browser opens `/meetings/abc/minutes?item=50`

#### Scenario: Main page while signed out

- **WHEN** a browser without a valid session opens `/`
- **THEN** it is redirected to `/login` with no `next` parameter

#### Scenario: Very long address while signed out

- **WHEN** a browser without a valid session opens a page address whose path and query string are 2001 characters long
- **THEN** it is redirected to `/login` with no `next` parameter

#### Scenario: Fragment is kept

- **WHEN** a user signs in on `/login?next=%2Fmeetings%2Fabc#seg-12`
- **THEN** the browser opens `/meetings/abc#seg-12`

#### Scenario: Next value is checked before use

- **WHEN** a user signs in on the sign-in page with a `next` value
- **THEN** the browser opens the destination given in the example table

##### Example: destination after sign-in

| next | Destination |
| ---- | ----------- |
| `/meetings` | `/meetings` |
| `/actions?item=50` | `/actions?item=50` |
| (absent) | `/` |
| (empty) | `/` |
| `https://evil.example/` | `/` |
| `//evil.example/` | `/` |
| `/\evil.example/` | `/` |
| `/a\b` | `/` |
| `meetings` | `/` |
| `javascript:alert(1)` | `/` |

#### Scenario: Session expires on an open page

- **WHEN** a page at `/actions?item=50` learns from a 401 response that the session is no longer valid
- **THEN** the browser goes to `/login?next=%2Factions%3Fitem%3D50`

<!-- @trace
source: login-return-path
updated: 2026-11-13
code:
  - bench/returnpathcheck.js
  - webapp/static/account.js
  - webapp/static/admin.html
  - webapp/response_headers.py
  - webapp/static/app.js
  - webapp/static/ask.html
  - webapp/static/meetings.html
  - webapp/static/metrics.html
  - webapp/static/minutes.html
  - webapp/static/search.html
  - webapp/static/index.html
  - bench/wakelockcheck.js
  - webapp/quality_pass.py
  - webapp/static/login.html
  - webapp/static/review.html
  - webapp/static/not-found.html
  - webapp/static/wake-lock.js
  - webapp/static/privacy-note.js
  - webapp/static/actions.html
  - README.md
  - webapp/auth.py
  - webapp/static/return-path.js
  - webapp/server.py
  - bench/privacycheck.js
tests:
  - webapp/test_server.py
-->