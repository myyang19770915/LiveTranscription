## Purpose

Yuqiao Live is shared by several teams, so every user signs in with their company LDAP account before using it. This capability covers sign-in, sessions, sign-out, and which routes require a signed-in user.

## ADDED Requirements

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

### Requirement: Repeated failed sign-ins are slowed down

The system SHALL reject further sign-in attempts for a username for 5 minutes after 5 consecutive failed attempts for that username, responding 429 without contacting LDAP. A successful sign-in SHALL reset the count.

#### Scenario: Sixth attempt after five failures

- **WHEN** a username has failed sign-in 5 times within 5 minutes and a sixth attempt arrives
- **THEN** the system responds 429 with the message 嘗試次數過多，請稍後再試 and does not contact LDAP

### Requirement: Server-side sessions

The system SHALL keep sessions on the server. The cookie SHALL hold only a random token of at least 32 bytes, SHALL be HttpOnly and SameSite=Lax, and SHALL be Secure when the request arrived over HTTPS. The server SHALL store only a hash of the token. A session SHALL expire 12 hours after sign-in.

#### Scenario: Expired session

- **WHEN** a request carries a session token whose session was created more than 12 hours ago
- **THEN** the system treats the request as signed out

#### Scenario: Sign-out

- **WHEN** a signed-in user signs out
- **THEN** the system deletes the session on the server and clears the cookie, and a later request with the old token is treated as signed out

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

### Requirement: Cross-site requests are refused

For state-changing requests (POST, PUT, PATCH, DELETE) and for the `/ws/transcribe` handshake, the system SHALL refuse the request with 403 when the `Origin` header is present and its host does not match the request's own `Host` header.

#### Scenario: WebSocket from another site

- **WHEN** a page on another origin opens `/ws/transcribe` with the user's cookie
- **THEN** the system refuses the handshake and opens no ASR connection
