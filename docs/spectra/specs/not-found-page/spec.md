# not-found-page Specification

## Purpose

A person who follows a broken link or a link to a meeting they cannot open sees a page that says so and offers a way on, instead of a raw API error. This capability covers when that page is shown.

## Requirements

### Requirement: Page requests that end in 404 get an HTML page

When a GET request whose `Accept` header contains `text/html` and whose path is not under `/api/` or `/assets/` results in status 404, the gateway SHALL respond with status 404 and an HTML page that shows 找不到這個頁面 and links to `/` and `/meetings`. The page SHALL NOT call any API and SHALL be shown the same way to signed-in and signed-out visitors. Every other 404 response SHALL keep its JSON body.

#### Scenario: 404 body by request

- **WHEN** a request results in status 404
- **THEN** the body is the HTML page or the JSON error as in the example table

##### Example: which body

| Method | Path | Accept | Body |
| ------ | ---- | ------ | ---- |
| GET | `/no-such-page` | `text/html,application/xhtml+xml` | HTML page with 找不到這個頁面 |
| GET | `/meetings/00000000-0000-0000-0000-000000000000` (signed in, no such meeting) | `text/html` | HTML page with 找不到這個頁面 |
| GET | `/no-such-page` | `application/json` | JSON `{"detail":"Not Found"}` |
| GET | `/api/no-such-route` | `text/html` | JSON `{"detail":"Not Found"}` |
| GET | `/assets/missing.js` | `text/html` | not the HTML page |
| POST | `/no-such-page` | `text/html` | JSON `{"detail":"Not Found"}` |

<!-- @trace
source: not-found-page
updated: 2026-11-13
code:
  - webapp/server.py
  - webapp/static/refine.css
  - webapp/response_headers.py
  - webapp/static/metrics.html
  - webapp/static/review.html
  - webapp/quality_pass.py
  - bench/privacycheck.js
  - webapp/static/actions.html
  - webapp/static/not-found.html
  - webapp/static/admin.html
  - webapp/static/login.html
  - bench/wakelockcheck.js
  - webapp/static/account.js
  - webapp/static/app.js
  - webapp/static/index.html
  - webapp/auth.py
  - webapp/static/minutes.html
  - webapp/static/privacy-note.js
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - README.md
  - webapp/static/return-path.js
  - webapp/static/wake-lock.js
  - webapp/static/ask.html
  - webapp/static/meetings.html
  - webapp/static/search.html
  - bench/returnpathcheck.js
tests:
  - webapp/test_server.py
-->