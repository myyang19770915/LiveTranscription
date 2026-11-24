# meeting-series Specification

## Purpose

Recurring meetings of a team form a series, chosen before the meeting starts, so that each meeting of the series begins with the action items its earlier meetings left unfinished.

## Requirements

### Requirement: Team series

A member of a team SHALL be able to list the team's series and create one by name. A name SHALL have 1 to 60 characters after removing surrounding spaces and SHALL be unique within the team regardless of letter case; creating a name that already exists SHALL return the existing series instead of a new one. Users outside the team SHALL receive 404.

#### Scenario: Creating series

##### Example: series names in team 研發部

| Existing | Requested | Result |
| --- | --- | --- |
| (none) | 研發週會 | 201, new series 研發週會 |
| 研發週會 | 研發週會 | 200, the existing series |
| Sprint Review | sprint review | 200, the existing series Sprint Review |
| (none) | (61 characters) | 422 |
| (none) | (spaces only) | 422 |

#### Scenario: Another team's series

- **WHEN** a user lists or creates series of a team they are not in
- **THEN** the system responds 404


<!-- @trace
source: meeting-series
updated: 2026-11-06
code:
  - bench/series_e2e.mjs
  - docs/roadmap.md
  - webapp/static/meetings.html
  - webapp/static/review.js
  - webapp/server.py
  - webapp/migrations/006_series.sql
  - webapp/static/meeting-nav.js
  - webapp/static/review.css
  - webapp/static/series.css
  - bench/README.md
  - webapp/static/minutes.html
  - webapp/team_access.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/review.html
  - webapp/static/series.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/index.html
  - webapp/static/app.js
  - README.md
  - webapp/actions.py
  - webapp/static/actions.html
  - webapp/static/minutes.css
  - webapp/series.py
  - webapp/minutes.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Choosing a series for a meeting

Before starting a meeting, the user SHALL be able to choose one of the selected team's series, create a new one in place, or choose no series; the meeting SHALL be stored with that series. A member of the meeting's team SHALL be able to change or clear a meeting's series later from the review page. A series of another team SHALL be refused with 422. The meeting list and the header of a meeting's views SHALL show the series name next to the team.

#### Scenario: Starting a meeting in a series

- **WHEN** alice selects team 研發部 and series 研發週會 and starts a meeting
- **THEN** the meeting belongs to series 研發週會 and the meeting list shows 研發部 with 研發週會

#### Scenario: Series of another team

- **WHEN** a meeting of team 研發部 is created or changed with a series of team 業務部
- **THEN** the system responds 422 系列不屬於這個團隊 and the meeting is unchanged

#### Scenario: Clearing the series

- **WHEN** a member changes a meeting's series to 不屬於系列 on the review page
- **THEN** the meeting has no series and its topic is unchanged


<!-- @trace
source: meeting-series
updated: 2026-11-06
code:
  - bench/series_e2e.mjs
  - docs/roadmap.md
  - webapp/static/meetings.html
  - webapp/static/review.js
  - webapp/server.py
  - webapp/migrations/006_series.sql
  - webapp/static/meeting-nav.js
  - webapp/static/review.css
  - webapp/static/series.css
  - bench/README.md
  - webapp/static/minutes.html
  - webapp/team_access.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/review.html
  - webapp/static/series.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/index.html
  - webapp/static/app.js
  - README.md
  - webapp/actions.py
  - webapp/static/actions.html
  - webapp/static/minutes.css
  - webapp/series.py
  - webapp/minutes.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Unfinished actions before the meeting

When a series is selected on the meeting page, the page SHALL list the confirmed action items of the other meetings in that series whose status is todo or doing, with content, owner, due date and overdue days, the most overdue first, and SHALL keep the list visible during the meeting. Done, cancelled, proposed and rejected items and items of other kinds SHALL NOT be listed. When there are none, the page SHALL say so.

#### Scenario: Weekly meeting

##### Example: series 研發週會 before the 11/13 meeting (today 2026-11-13)

| Item | From meeting | Kind / state | Status | Due | Listed |
| --- | --- | --- | --- | --- | --- |
| 寄合約 | 11/06 研發週會 | action / confirmed | todo | 2026-11-10 | yes, 逾期 3 天, first |
| 部署腳本 | 11/06 研發週會 | action / confirmed | doing | 2026-11-30 | yes |
| 報價單 | 10/30 研發週會 | action / confirmed | done | 2026-11-01 | no |
| 晶片延遲 | 11/06 研發週會 | risk / confirmed | todo | (none) | no |
| 確認預算 | 11/06 研發週會 | action / proposed | todo | (none) | no |
| 客戶拜訪 | 11/05 業務週會 | action / confirmed | todo | (none) | no |

<!-- @trace
source: meeting-series
updated: 2026-11-06
code:
  - bench/series_e2e.mjs
  - docs/roadmap.md
  - webapp/static/meetings.html
  - webapp/static/review.js
  - webapp/server.py
  - webapp/migrations/006_series.sql
  - webapp/static/meeting-nav.js
  - webapp/static/review.css
  - webapp/static/series.css
  - bench/README.md
  - webapp/static/minutes.html
  - webapp/team_access.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/review.html
  - webapp/static/series.js
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/index.html
  - webapp/static/app.js
  - README.md
  - webapp/actions.py
  - webapp/static/actions.html
  - webapp/static/minutes.css
  - webapp/series.py
  - webapp/minutes.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Naming a new series works with input methods

In the new-series field (`#seriesName`) on `/`, a key press of Enter or Escape that belongs to an input method composition (`event.isComposing` is true or `event.keyCode` is 229) SHALL be left to the input method: Enter SHALL NOT create a series and Escape SHALL NOT close the new-series row. An Enter outside a composition SHALL create the series as before, and an Escape outside a composition SHALL close the row as before.

#### Scenario: Confirming a candidate with Enter

- **WHEN** the user types 研發週會 with a Zhuyin input method in `#seriesName` and presses Enter to confirm the candidate
- **THEN** no request is sent to `POST /api/teams/{team}/series` and the field keeps the text

#### Scenario: Enter after the composition

- **WHEN** the composition has ended and the user presses Enter again
- **THEN** one request is sent to `POST /api/teams/{team}/series` with the name in the field

##### Example: Key events in the field

| keydown event | Series request sent | Row closes |
| --- | --- | --- |
| `{key:'Enter', isComposing:true}` | no | no |
| `{key:'Enter', isComposing:false, keyCode:229}` | no | no |
| `{key:'Enter', isComposing:false, keyCode:13}` | yes, once | n/a |
| `{key:'Escape', isComposing:true}` | no | no |
| `{key:'Escape', isComposing:false, keyCode:27}` | no | yes |

<!-- @trace
source: web-platform-polish
updated: 2026-11-24
code:
  - webapp/static/series.js
  - webapp/static/index.html
tests:
  - bench/web_platform_polish_e2e.mjs
-->