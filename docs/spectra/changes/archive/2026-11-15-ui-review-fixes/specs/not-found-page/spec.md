## MODIFIED Requirements

### Requirement: Page requests that end in 404 get an HTML page

When a GET request whose `Accept` header contains `text/html` and whose path is not under `/api/` or `/assets/` results in status 404, the gateway SHALL respond with status 404 and an HTML page that shows 找不到這個頁面 and links to `/` and `/meetings`. The page SHALL also say that for a team's meeting the person can ask a team administrator to check their team membership, and SHALL offer 返回上一頁, going back in the tab's history, when the person arrived from another page of this site other than the sign-in page. The page SHALL NOT call any API and SHALL be shown the same way to signed-in and signed-out visitors. Every other 404 response SHALL keep its JSON body.

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

#### Scenario: Next steps on the page

- **WHEN** a person follows a link from the meeting list to a meeting they cannot open
- **THEN** the page shows 返回上一頁, 回開會頁 and 會議紀錄, and the hint to ask a team administrator

#### Scenario: Opened directly

- **WHEN** a person opens a missing page directly in a new tab, from another site, or right after signing in through a shared link
- **THEN** 返回上一頁 is not shown and 回開會頁 and 會議紀錄 are
