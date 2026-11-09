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