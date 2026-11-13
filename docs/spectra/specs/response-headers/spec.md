# response-headers Specification

## Purpose

The gateway is reachable from the public internet through a tunnel, so every HTTP response carries browser security headers, and versioned static assets carry a cache lifetime. This capability covers which headers are set and when.

## Requirements

### Requirement: Security headers on every HTTP response

Every HTTP response from the gateway SHALL carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`, whatever the route and status code, including redirects to the sign-in page, 401 and 404 responses and static assets. A header of the same name already set by the route SHALL be kept as the route set it. WebSocket connections SHALL NOT be affected.

#### Scenario: Sign-in page

- **WHEN** a signed-out browser requests `/login`
- **THEN** the response has `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`

#### Scenario: Refused API request

- **WHEN** a signed-out client requests `/api/metrics`
- **THEN** the 401 response has the same three headers

#### Scenario: Unknown path

- **WHEN** a signed-in user requests a path that no route serves
- **THEN** the 404 response has the same three headers


<!-- @trace
source: security-headers
updated: 2026-11-13
code:
  - bench/returnpathcheck.js
  - README.md
  - webapp/static/metrics.html
  - webapp/auth.py
  - webapp/response_headers.py
  - webapp/static/ask.html
  - webapp/static/review.html
  - webapp/server.py
  - webapp/static/account.js
  - webapp/static/index.html
  - webapp/static/admin.html
  - webapp/static/return-path.js
  - webapp/static/search.html
  - webapp/static/login.html
  - webapp/static/app.js
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/static/meetings.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Strict transport security on HTTPS requests

A response to a request whose scheme is `https` SHALL carry `Strict-Transport-Security: max-age=31536000`. The scheme is the one the server resolved for the request, which includes `X-Forwarded-Proto` from a trusted proxy. A response to an `http` request SHALL NOT carry the header.

#### Scenario: Request over HTTPS

- **WHEN** a browser requests `/login` over `https`
- **THEN** the response has `Strict-Transport-Security: max-age=31536000`

#### Scenario: Request over HTTP on the local network

- **WHEN** a browser requests `/login` over `http`
- **THEN** the response has no `Strict-Transport-Security` header


<!-- @trace
source: security-headers
updated: 2026-11-13
code:
  - bench/returnpathcheck.js
  - README.md
  - webapp/static/metrics.html
  - webapp/auth.py
  - webapp/response_headers.py
  - webapp/static/ask.html
  - webapp/static/review.html
  - webapp/server.py
  - webapp/static/account.js
  - webapp/static/index.html
  - webapp/static/admin.html
  - webapp/static/return-path.js
  - webapp/static/search.html
  - webapp/static/login.html
  - webapp/static/app.js
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/static/meetings.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: Versioned static assets are cacheable

A response with status 200 for a path under `/assets/` whose query string has a non-empty `v` parameter SHALL carry `Cache-Control: public, max-age=2592000`. Other responses under `/assets/` SHALL be left as they are, and page routes SHALL keep their own `Cache-Control`.

#### Scenario: Asset caching by request

- **WHEN** a signed-in browser requests a static asset
- **THEN** the `Cache-Control` header depends on the query string and status as in the example table

##### Example: cache header

| Request | Status | Cache-Control |
| ------- | ------ | ------------- |
| `/assets/app.js?v=20261113a` | 200 | `public, max-age=2592000` |
| `/assets/app.js` | 200 | (not set by this capability) |
| `/assets/app.js?v=` | 200 | (not set by this capability) |
| `/assets/missing.js?v=1` | 404 | (not set by this capability) |
| `/login` | 200 | `no-cache` |

<!-- @trace
source: security-headers
updated: 2026-11-13
code:
  - bench/returnpathcheck.js
  - README.md
  - webapp/static/metrics.html
  - webapp/auth.py
  - webapp/response_headers.py
  - webapp/static/ask.html
  - webapp/static/review.html
  - webapp/server.py
  - webapp/static/account.js
  - webapp/static/index.html
  - webapp/static/admin.html
  - webapp/static/return-path.js
  - webapp/static/search.html
  - webapp/static/login.html
  - webapp/static/app.js
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/static/meetings.html
tests:
  - webapp/test_server.py
-->