# action-tracking Specification

## Purpose

Confirmed action items from meeting minutes are tracked to completion: each has a status that team members update, every change is recorded, overdue items stand out, and a board shows all of a user's teams' action items in one place.

## Requirements

### Requirement: Action item status

Every confirmed action item SHALL have one of the statuses todo (未開始), doing (進行中), done (已完成) and cancelled (已取消); items that existed before this capability SHALL start as todo. Any member of the meeting's team SHALL be able to change the status with the item's current version. Changing to cancelled SHALL require a note stating the reason; other changes MAY carry a note. A change to the status the item already has SHALL be refused with 422. A change to an item that is not a confirmed action SHALL be refused with 409. A change based on an older version SHALL be refused with 409 and the current item. Each accepted change SHALL increment the item's version. Users outside the team SHALL receive 404.

#### Scenario: Starting work

- **WHEN** alice changes a confirmed action from todo to doing with version 3
- **THEN** the item has status doing and version 4

#### Scenario: Status changes

##### Example: status change rules

| Item | Current status | Requested | Note | Result |
| --- | --- | --- | --- | --- |
| confirmed action | todo | doing | (empty) | 200, status doing |
| confirmed action | doing | done | 已寄出 | 200, status done |
| confirmed action | todo | cancelled | (empty) | 422 取消待辦請填寫原因 |
| confirmed action | todo | cancelled | 客戶取消訂單 | 200, status cancelled |
| confirmed action | doing | doing | (empty) | 422 狀態沒有改變 |
| proposed action | todo | doing | (empty) | 409 只有已確認的待辦可以更新狀態 |
| confirmed decision | todo | done | (empty) | 409 只有已確認的待辦可以更新狀態 |

#### Scenario: Stale status change

- **WHEN** alice and bob both change the same action from version 3
- **THEN** the second change is refused with 409 and receives the item as changed by the first

#### Scenario: Another team

- **WHEN** a user who is not in the meeting's team changes the status of one of its actions
- **THEN** the system responds 404 and nothing changes


<!-- @trace
source: action-tracking
updated: 2026-11-06
code:
  - webapp/actions.py
  - webapp/static/minutes.css
  - webapp/static/admin.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - docs/roadmap.md
  - webapp/static/actions.css
  - webapp/static/index.html
  - webapp/static/admin.html
  - webapp/minutes.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/static/meetings.html
  - webapp/static/review.css
  - webapp/static/account.js
  - webapp/static/action-status.js
  - webapp/migrations/005_actions.sql
  - webapp/static/actions.js
  - webapp/static/review.html
  - meeting-2026-11-01T00-16-53.txt
  - bench/actions_e2e.mjs
tests:
  - webapp/test_server.py
-->

---
### Requirement: Status history

Every accepted status change SHALL be recorded with the previous status, the new status, the note, who made it and when. A team member SHALL be able to read an item's history, newest first, on the board and on the minutes page.

#### Scenario: Two changes

- **WHEN** alice changes an action from todo to doing and later bob changes it to done with note 已寄出
- **THEN** the history lists bob's change doing → done with 已寄出 first, then alice's change todo → doing


<!-- @trace
source: action-tracking
updated: 2026-11-06
code:
  - webapp/actions.py
  - webapp/static/minutes.css
  - webapp/static/admin.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - docs/roadmap.md
  - webapp/static/actions.css
  - webapp/static/index.html
  - webapp/static/admin.html
  - webapp/minutes.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/static/meetings.html
  - webapp/static/review.css
  - webapp/static/account.js
  - webapp/static/action-status.js
  - webapp/migrations/005_actions.sql
  - webapp/static/actions.js
  - webapp/static/review.html
  - meeting-2026-11-01T00-16-53.txt
  - bench/actions_e2e.mjs
tests:
  - webapp/test_server.py
-->

---
### Requirement: Overdue action items

An action item SHALL be overdue when its status is todo or doing, it has a due date, and the due date is before today in the meeting time zone; its number of overdue days SHALL be today minus the due date. Items that are done or cancelled, or have no due date, SHALL NOT be overdue. Overdue items SHALL be shown in red with 逾期 N 天 on the board and on the minutes page.

#### Scenario: Overdue days

##### Example: overdue on 2026-11-06

| Status | Due date | Overdue days |
| --- | --- | --- |
| todo | 2026-11-04 | 2 |
| doing | 2026-11-05 | 1 |
| todo | 2026-11-06 | 0 |
| done | 2026-11-01 | 0 |
| cancelled | 2026-11-01 | 0 |
| todo | (none) | 0 |


<!-- @trace
source: action-tracking
updated: 2026-11-06
code:
  - webapp/actions.py
  - webapp/static/minutes.css
  - webapp/static/admin.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - docs/roadmap.md
  - webapp/static/actions.css
  - webapp/static/index.html
  - webapp/static/admin.html
  - webapp/minutes.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/static/meetings.html
  - webapp/static/review.css
  - webapp/static/account.js
  - webapp/static/action-status.js
  - webapp/migrations/005_actions.sql
  - webapp/static/actions.js
  - webapp/static/review.html
  - meeting-2026-11-01T00-16-53.txt
  - bench/actions_e2e.mjs
tests:
  - webapp/test_server.py
-->

---
### Requirement: Action board

The system SHALL provide a board page listing the confirmed action items of every team the signed-in user belongs to, and of no other team, in columns 未開始, 進行中 and 已完成, with 已取消 shown only when the user asks for it. Each card SHALL show the content, the owner or 未指派, the due date, the overdue days, and the meeting it came from with a link to that meeting's minutes, and SHALL let a team member change the status and read the history. The board SHALL filter by team, owner (a member, the user themself, or unassigned), due (overdue, due within the next 7 days and not finished, no due date) and a keyword in the content, all kept in the page address. Items SHALL be ordered by overdue days, most first, then by due date with items without a due date last. Proposed and rejected items and items of other kinds SHALL NOT appear. A team filter for a team the user is not in SHALL receive 404.

#### Scenario: Two teams

- **WHEN** a user in teams 研發部 and 業務部 opens the board
- **THEN** confirmed action items of both teams appear and none of any other team

#### Scenario: My overdue items

- **WHEN** alice opens the board filtered to owner 我的 and due 逾期
- **THEN** only confirmed actions owned by alice whose status is todo or doing and whose due date is before today appear, the most overdue first

#### Scenario: Board filters

##### Example: filtering on 2026-11-06

| Item | Owner | Status | Due | owner=me (alice) | due=overdue | due=week | due=none |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | alice | todo | 2026-11-04 | shown | shown | hidden | hidden |
| B | alice | doing | 2026-11-10 | shown | hidden | shown | hidden |
| C | bob | todo | 2026-11-13 | hidden | hidden | shown | hidden |
| D | (none) | todo | (none) | hidden | hidden | hidden | shown |
| E | alice | done | 2026-11-01 | shown | hidden | hidden | hidden |

#### Scenario: Another team's filter

- **WHEN** a user filters the board by a team they are not in
- **THEN** the system responds 404

<!-- @trace
source: action-tracking
updated: 2026-11-06
code:
  - webapp/actions.py
  - webapp/static/minutes.css
  - webapp/static/admin.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - docs/roadmap.md
  - webapp/static/actions.css
  - webapp/static/index.html
  - webapp/static/admin.html
  - webapp/minutes.py
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/static/meetings.html
  - webapp/static/review.css
  - webapp/static/account.js
  - webapp/static/action-status.js
  - webapp/migrations/005_actions.sql
  - webapp/static/actions.js
  - webapp/static/review.html
  - meeting-2026-11-01T00-16-53.txt
  - bench/actions_e2e.mjs
tests:
  - webapp/test_server.py
-->