## MODIFIED Requirements

### Requirement: Full-text search

The system SHALL provide a search page at `/search`, reachable from a search button in every page header and with the `/` key, and `GET /api/search` for signed-in users. A query SHALL be 1 to 100 characters after trimming (otherwise 422) and SHALL be split on whitespace into 1 to 5 terms; a query of more than 5 terms SHALL get 422 「搜尋詞最多 5 個（目前 N 個），請刪減後再搜尋」 and SHALL NOT be cut to its first 5 terms; a record SHALL match only when every term occurs in the same field, case-insensitively, with `%` and `_` matched literally. The search SHALL cover transcript segments (original or translation), minutes items that are proposed or confirmed (including action items created on the board), and meeting topics, and SHALL only return data of the user's teams. Filters SHALL be team, series, date range (MEETING_TIMEZONE, by meeting start or, for a board item, its creation) and kind (all, segments, items, meetings); a team or series the user cannot see SHALL get 404, an unknown kind 422. Results SHALL be grouped by meeting, newest first, with board items in their own group, capped at 300 hits with a `truncated` flag. Each hit SHALL highlight the terms and link to its source: a segment to its place on the review page, an item to its place on the minutes page or the board, a topic to the meeting. The query and filters SHALL be kept in the page address.

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
| any | `a b c d e` | searched (5 terms) |
| any | `a b c d e f` | 422 搜尋詞最多 5 個（目前 6 個），請刪減後再搜尋 |
| any | `a　b` (full-width space) | 2 terms |

#### Scenario: Other teams stay invisible

- **WHEN** a user searches a word that only occurs in another team's meeting, or asks for that team
- **THEN** nothing is returned, or 404 for the team

#### Scenario: Filtering

- **WHEN** the user picks team 研發部, series 研發週會, dates 2026-11-01 to 2026-11-07 and kind 紀要
- **THEN** only minutes items of that series' meetings started in those dates (and board items of that series created in those dates) are listed, and the address carries the filters

#### Scenario: Too many hits

- **WHEN** more than 300 records match
- **THEN** 300 are returned with `truncated` true and the page says to narrow the search

## ADDED Requirements

### Requirement: Search page feedback

While a search is under way the search page SHALL mark the results region `aria-busy="true"`, show the previous results dimmed and not clickable, and, when the search takes longer than 200 ms, say 正在搜尋「<query>」… in the polite live summary; the busy state SHALL end when the newest search finishes, fails or is replaced, and a response to an older search SHALL never replace the results of a newer one. Before sending, the page SHALL check the query the same way the API does: a query over 100 characters or over 5 terms SHALL NOT be sent; the page SHALL remove the previous results, show the same message as the API in its alert, and mark the search box `aria-invalid="true"` until the query is valid again. The query and filters SHALL still be kept in the page address. The page's idle hint SHALL state the 5-term limit.

#### Scenario: A slow search

- **WHEN** a user searches 合約 and the answer takes 1 second
- **THEN** the results region is busy, the old results are dimmed, the summary says 正在搜尋「合約」…, and when the answer arrives the region is no longer busy and the summary counts the hits

#### Scenario: A newer search wins

- **WHEN** a slow search for 合約 is followed by a quick search for 報價
- **THEN** the results and summary are those of 報價, also after the 合約 answer arrives

#### Scenario: Too many terms

- **WHEN** a user submits `合約 客戶 報價 週五 寄出 確認`
- **THEN** no request is sent, the previous results are removed, the alert says 搜尋詞最多 5 個（目前 6 個），請刪減後再搜尋 and the box is marked invalid; after deleting one term and searching again, results are shown and the box is valid
