# meeting-search Specification

## Purpose

Lets a team member find what was said or decided across their teams' meetings: substring search over transcripts (original and translation), minutes items and meeting topics, with filters, results grouped by meeting and linked to the exact segment or item.

## Requirements

### Requirement: Full-text search

The system SHALL provide a search page at `/search`, reachable from a search button in every page header and with the `/` key, and `GET /api/search` for signed-in users. A query SHALL be 1 to 100 characters after trimming (otherwise 422) and SHALL be split on whitespace into at most 5 terms; a record SHALL match only when every term occurs in the same field, case-insensitively, with `%` and `_` matched literally. The search SHALL cover transcript segments (original or translation), minutes items that are proposed or confirmed (including action items created on the board), and meeting topics, and SHALL only return data of the user's teams. Filters SHALL be team, series, date range (MEETING_TIMEZONE, by meeting start or, for a board item, its creation) and kind (all, segments, items, meetings); a team or series the user cannot see SHALL get 404, an unknown kind 422. Results SHALL be grouped by meeting, newest first, with board items in their own group, capped at 300 hits with a `truncated` flag. Each hit SHALL highlight the terms and link to its source: a segment to its place on the review page, an item to its place on the minutes page or the board, a topic to the meeting. The query and filters SHALL be kept in the page address.

#### Scenario: Finding what was said

- **WHEN** a member searches 報價單
- **THEN** segments, items and topics containing 報價單 in their teams' meetings are listed by meeting, newest first, with 報價單 highlighted, and a segment hit links to `/meetings/{id}#seg-N` with its time

##### Example: Matching

| Data | Query | Result |
| ---- | ----- | ------ |
| segment source "合約下週五前寄給客戶" | `合約 客戶` | match (both terms in the source) |
| segment source "合約已寄出", target "sent to the client" | `合約 client` | no match (terms in different fields) |
| segment target "MiniMax launch" | `minimax` | match (case-insensitive) |
| item content "折扣 100%" | `100%` | match; content "1000" does not match |
| item rejected, content "報價單" | `報價單` | not listed |
| query of spaces only | | 422 |

#### Scenario: Other teams stay invisible

- **WHEN** a user searches a word that only occurs in another team's meeting, or asks for that team
- **THEN** nothing is returned, or 404 for the team

#### Scenario: Filtering

- **WHEN** the user picks team 研發部, series 研發週會, dates 2026-11-01 to 2026-11-07 and kind 紀要
- **THEN** only minutes items of that series' meetings started in those dates (and board items of that series created in those dates) are listed, and the address carries the filters

#### Scenario: Too many hits

- **WHEN** more than 300 records match
- **THEN** 300 are returned with `truncated` true and the page says to narrow the search

<!-- @trace
source: meeting-search
updated: 2026-11-07
code:
  - bench/search_e2e.mjs
  - bench/README.md
  - webapp/static/actions.html
  - webapp/static/account.js
  - webapp/static/meetings.html
  - webapp/static/admin.html
  - webapp/static/index.html
  - webapp/static/metrics.html
  - webapp/static/search.css
  - webapp/static/search.js
  - webapp/static/review.html
  - README.md
  - docs/roadmap.md
  - 20261029_185428.mp4
  - webapp/migrations/010_search.sql
  - webapp/static/admin.css
  - webapp/static/search.html
  - webapp/search.py
  - webapp/static/accounts.css
  - webapp/static/minutes.html
  - webapp/server.py
  - meeting-2026-11-01T00-16-53.txt
tests:
  - webapp/test_server.py
-->