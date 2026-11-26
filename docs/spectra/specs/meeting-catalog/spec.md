# meeting-catalog Specification

## Purpose

Meetings are found by what they were about, not only by when they started. This capability covers the meeting topic and the filtering, search and grouping of the meeting list, within the team isolation already in place.

## Requirements

### Requirement: Meeting topic

A meeting SHALL have an optional topic of at most 100 characters, entered before the meeting starts and stored with the meeting. Surrounding spaces SHALL be removed. A meeting without a topic SHALL be shown as "MM/DD HH:mm 的會議" from its local start time, on the meeting list and on the review page.

#### Scenario: Topic entered

- **WHEN** a user enters "週會" and starts a meeting
- **THEN** the meeting is stored with topic "週會" and the list and review page show "週會"

#### Scenario: No topic

- **WHEN** a user starts a meeting at 2026-11-04 23:37 local time without a topic
- **THEN** the list and review page show "11/04 23:37 的會議"

##### Example: topic input

| Input | Stored topic | Result |
| ----- | ------------ | ------ |
| "  週會  " | "週會" | created |
| "" | "" | created, shown as "MM/DD HH:mm 的會議" |
| 101 characters | — | 422, no meeting created |


<!-- @trace
source: meeting-topics
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Changing a topic

Every member of the meeting's team SHALL be able to change the topic from the review page; clearing it SHALL bring back the default display. Non-members SHALL receive 404 and change nothing.

#### Scenario: Member renames

- **WHEN** a team member changes a meeting's topic to "Q4 規劃"
- **THEN** the list and review page show "Q4 規劃"

#### Scenario: Member of another team

- **WHEN** a user who is not in the meeting's team changes its topic
- **THEN** the system responds 404 and the topic is unchanged


<!-- @trace
source: meeting-topics
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Filtering and searching the meeting list

The meeting list SHALL accept, in any combination: one of the user's teams, a start-date range in local dates (inclusive), a creator, and a keyword matched case-insensitively against the topic. Filtering SHALL happen on the server, before the list's 500-meeting limit is applied, and SHALL never return meetings of teams the user does not belong to.

#### Scenario: Keyword

- **WHEN** a user searches "週會" and their teams have meetings with topics "研發週會", "業務週會" and "客戶訪談"
- **THEN** the list shows "研發週會" and "業務週會" only

##### Example: combined filters

| Team | From–To | Creator | Keyword | Meetings returned |
| ---- | ------- | ------- | ------- | ----------------- |
| 研發 | — | — | — | all 研發 meetings |
| — | 11/01–11/03 | — | — | meetings started 11/01 to 11/03, any of the user's teams |
| — | — | bob | 週會 | bob's meetings whose topic contains 週會 |
| a team the user is not in | — | — | — | 404 |

#### Scenario: Older meetings beyond the limit

- **WHEN** a team has more than 500 meetings and the user filters by a date range in the oldest month
- **THEN** that month's meetings are returned


<!-- @trace
source: meeting-topics
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Creator choices

The creator filter SHALL offer only the creators of meetings in the user's own teams.

#### Scenario: Creators of other teams stay hidden

- **WHEN** carol created meetings only in a team the user is not in
- **THEN** carol is not offered as a creator


<!-- @trace
source: meeting-topics
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Grouping by start date

The meeting list SHALL group meetings, newest first, under 今天 (started today, local time), 本週 (earlier this week, weeks starting on Monday) and 更早; empty groups SHALL not be shown.

#### Scenario: Three groups

- **WHEN** on Wednesday 2026-11-04 the list holds meetings from 11/04, 11/02 and 10/28
- **THEN** they appear under 今天, 本週 and 更早 respectively


<!-- @trace
source: meeting-topics
updated: 2026-11-05
code:
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - docs/roadmap.md
-->

---
### Requirement: Returning from the review page

The review page and the minutes page of a meeting SHALL offer a link 返回會議紀錄 back to the meeting list. When the user entered the meeting from the list, the link SHALL lead to that list with the filters it had, however many times the user switched between the two pages; when the entry right before the current one is that list and the browser supports it, the link SHALL return the way the browser's back button does. Otherwise it SHALL open the meeting list.

#### Scenario: Opened from the list

- **WHEN** a reviewer opens a meeting from the list and presses 返回會議紀錄
- **THEN** the meeting list is shown again

#### Scenario: Returning after switching tabs

- **WHEN** a user opens a meeting from the list filtered to team 研發部, switches to 會議紀要, back to 逐字稿校對, and presses 返回會議紀錄
- **THEN** the meeting list filtered to team 研發部 is shown

#### Scenario: Opened from a direct link

- **WHEN** a user opens a meeting's minutes page from a pasted address and presses 返回會議紀錄
- **THEN** the meeting list is opened


<!-- @trace
source: meeting-views-playback
updated: 2026-11-06
code:
  - webapp/static/timeline.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/minutes.js
  - 20261029_185428.mp4
  - bench/timelinecheck.js
  - webapp/static/minutes.html
  - bench/README.md
  - bench/minutes_e2e.mjs
  - webapp/static/review.html
-->

---
### Requirement: One header and tabs for a meeting's two views

The review page (逐字稿校對) and the minutes page (會議紀要) of a meeting SHALL show the same header: the meeting's display title and a meta line with its team, start time, recording length or 沒有錄音, languages and creator, followed by a tab strip with 逐字稿校對 and 會議紀要 in that order, the current one marked. A plain click on the other tab SHALL open that view in place of the current history entry, so the number of history entries stays the same; a click with a modifier key or the middle button SHALL keep the browser's default behaviour. The meeting list SHALL label its two links 會議紀要 and 逐字稿校對, at the same height.

#### Scenario: Switching views

- **WHEN** a user on the review page of a meeting clicks the 會議紀要 tab
- **THEN** the minutes page of that meeting opens with the same title and meta line, the 會議紀要 tab is marked, and the browser history has as many entries as before

#### Scenario: Same header on both views

- **WHEN** a user opens both views of the meeting 產品週會（測試資料） of team 研發部
- **THEN** both show the title 產品週會（測試資料） and a meta line of five parts beginning with 研發部

#### Scenario: Opening a view in a new browser tab

- **WHEN** a user Ctrl-clicks the 逐字稿校對 tab
- **THEN** the review page opens in a new browser tab and the current page stays as it is

<!-- @trace
source: meeting-views-playback
updated: 2026-11-06
code:
  - webapp/static/timeline.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/minutes.js
  - 20261029_185428.mp4
  - bench/timelinecheck.js
  - webapp/static/minutes.html
  - bench/README.md
  - bench/minutes_e2e.mjs
  - webapp/static/review.html
-->

---
### Requirement: A meeting row opens the meeting

In the list on `/meetings`, a click anywhere on the row of a meeting that has segments, outside its 會議紀要 link, SHALL open that meeting's review page. The row SHALL offer 會議紀要 and 逐字稿校對 as text links without a filled background or a border, of equal height, leading to the minutes page and the review page; each address SHALL appear on one link only, so the row holds exactly two links. A meeting without segments SHALL keep the note 沒有校對資料, SHALL hold no link and its row SHALL NOT be clickable.

#### Scenario: Clicking the row

- **WHEN** a user clicks the topic of a meeting that has segments
- **THEN** the review page of that meeting opens

#### Scenario: The links of a row

- **WHEN** `/meetings` is opened at 1440 px wide
- **THEN** each row with segments holds exactly two links, 會議紀要 to `/meetings/<id>/minutes` and 逐字稿校對 to `/meetings/<id>`, both with a transparent background, no border and the same height

#### Scenario: The minutes link inside a clickable row

- **WHEN** a user clicks 會議紀要 in a row
- **THEN** the minutes page of that meeting opens, not the review page

#### Scenario: A meeting without segments

- **WHEN** the list shows a meeting with no segments
- **THEN** its row reads 沒有校對資料, holds no link, and clicking it does not leave the list

<!-- @trace
source: ui-review-round-two
updated: 2026-11-26
code:
  - bench/README.md
  - bench/ui_round_two_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/ask.html
  - webapp/static/index.html
  - webapp/static/interpret.css
  - webapp/static/interpret.html
  - webapp/static/interpret.js
  - webapp/static/login.html
  - webapp/static/meetings.html
  - webapp/static/metrics.css
  - webapp/static/metrics.html
  - webapp/static/minutes.css
  - webapp/static/minutes.html
  - webapp/static/review.css
  - webapp/static/review.html
  - webapp/static/search.css
  - webapp/static/search.html
  - webapp/static/settings.html
  - webapp/static/speakers.css
  - webapp/static/topbar.css
  - webapp/static/usage.html
tests:
  - webapp/test_server.py
-->