# site-navigation Specification

## Purpose

The page header links every signed-in page to the others. On narrow screens the header hides some links to fit, and this capability makes sure every hidden link is still reachable from the avatar menu.

## Requirements

### Requirement: Hidden header links stay reachable on narrow screens

Whenever the page header hides one of the page links 待辦看板 (`/actions`), 成效指標 (`/metrics`) or 團隊管理 (`/admin`) because the window is narrow, the signed-in user's avatar menu SHALL offer it instead. On a narrow window the menu SHALL also offer 會議紀錄 (`/meetings`) on every page except `/` (whose header keeps that link) and `/meetings`. The header hides links at these widths: on the meeting page (`/`) 待辦看板 and 團隊管理 at 760px or less and 成效指標 at 900px or less; on every other signed-in page 成效指標 and 團隊管理 at 640px or less. A destination SHALL NOT be offered on its own page, 團隊管理 SHALL NOT be offered to a user who is not an administrator, and the menu SHALL NOT offer a link the header is showing.

#### Scenario: Narrow window menu

- **WHEN** a signed-in user opens the avatar menu in a window of the given width on the given page
- **THEN** the menu offers exactly the page links in the example table

##### Example: menu page links

| Width | Page | User | Menu page links |
| ----- | ---- | ---- | --------------- |
| 500px | `/meetings/<id>` (review) | administrator | 會議紀錄, 成效指標, 團隊管理 |
| 500px | `/actions` | member | 會議紀錄, 成效指標 |
| 500px | `/metrics` | administrator | 會議紀錄, 團隊管理 |
| 500px | `/` | administrator | 待辦看板, 團隊管理, 成效指標 |
| 850px | `/` | administrator | 成效指標 |
| 700px | `/actions` | administrator | none |
| 1280px | `/actions` | administrator | none |

<!-- @trace
source: ui-review-fixes
updated: 2026-11-15
code:
  - webapp/static/review.html
  - docs/ui-review-shots/qa-answer.jpeg
  - webapp/static/meetings.html
  - docs/ui-review-shots/minutes-empty.jpeg
  - docs/ui-review-shots/search-results.jpeg
  - webapp/static/accounts.css
  - webapp/static/not-found.html
  - docs/ui-review-shots/metrics.jpeg
  - webapp/static/search.html
  - docs/ui-review-shots/team-management.jpeg
  - docs/ui-review-codex.md
  - webapp/static/minutes.html
  - chang01.png
  - bench/ui_review_e2e.mjs
  - webapp/static/admin.css
  - docs/ui-review-shots/meetings-list.jpeg
  - docs/ui-review-shots/mobile-transcript-review.jpeg
  - webapp/static/account.js
  - docs/ui-review-shots/meeting-live.jpeg
  - webapp/static/ask.html
  - bench/README.md
  - webapp/static/actions.html
  - webapp/static/admin.html
  - docs/ui-review-shots/login-dark.jpeg
  - webapp/static/index.html
  - webapp/static/metrics.html
  - docs/ui-review-shots/404-page.jpeg
  - webapp/static/review.css
  - docs/ui-review-shots/actions-board.jpeg
tests:
  - webapp/test_server.py
-->