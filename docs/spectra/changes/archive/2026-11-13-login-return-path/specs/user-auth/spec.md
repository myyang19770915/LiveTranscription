## ADDED Requirements

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
