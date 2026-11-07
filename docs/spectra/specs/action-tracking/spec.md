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

The system SHALL provide a board page listing the confirmed action items of every team the signed-in user belongs to, and of no other team, in columns 未開始, 進行中 and 已完成, with 已取消 shown only when the user asks for it; each column SHALL show its count. Each card SHALL show the content, the item number, the due date (overdue in red with 逾期 N 天), the owner as an avatar or an empty avatar for 未指派, and the meeting it came from. On a desktop browser a team member SHALL be able to change the status by dragging a card to another column; dropping it on 已取消 SHALL ask for the reason first. Opening a card SHALL show a detail panel where a team member can change the status, the owner (a member of the item's team) and the due date, follow the link to the meeting's minutes, and read the history; the open card SHALL be kept in the page address. The board SHALL filter by team, owner (a member, the user themself, or unassigned), due (overdue, due within the next 7 days and not finished, no due date) and a keyword in the content, offered as quick filter buttons and a row of member avatars, and SHALL group the columns into swimlanes by owner or by meeting on request; all of these SHALL be kept in the page address. The 已完成 column SHALL show the items finished in the last 14 days and offer to show the earlier ones. Items SHALL be ordered by overdue days, most first, then by due date with items without a due date last. Proposed and rejected items and items of other kinds SHALL NOT appear. A team filter for a team the user is not in SHALL receive 404.

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

#### Scenario: Dragging a card

- **WHEN** alice drags the card of a todo action to 進行中
- **THEN** the action is doing and its card is in the 進行中 column

#### Scenario: Dropping on 已取消

- **WHEN** alice drags a card to 已取消
- **THEN** the detail panel of that card opens asking for the reason, and the status is unchanged until she gives one

#### Scenario: Shared card address

- **WHEN** alice opens a card and sends the page address to bob, who is in the same team
- **THEN** bob's board opens with the same card's detail panel

#### Scenario: Recent done items

##### Example: done column on 2026-11-20

| Item | Status | Last status change | Shown by default |
| --- | --- | --- | --- |
| F | done | 2026-11-18 | yes |
| G | done | 2026-11-06 | yes |
| H | done | 2026-11-05 | no, counted in 另有 1 件較早完成 |
| I | done | (never changed) | no, counted as earlier |

<!-- @trace
source: jira-style-board
updated: 2026-11-07
code:
  - webapp/static/actions.html
  - webapp/static/board.js
  - webapp/static/minutes.html
  - bench/series_e2e.mjs
  - 20261029_185428.mp4
  - webapp/static/actions.js
  - webapp/actions.py
  - bench/actions_e2e.mjs
  - meeting-2026-11-01T00-16-53.txt
  - README.md
  - bench/boardcheck.js
  - webapp/static/action-status.js
  - bench/README.md
  - webapp/static/actions.css
tests:
  - webapp/test_server.py
-->

---
### Requirement: Board-created action items

A team member SHALL be able to create an action item directly on the action board, with its content, team, optional owner (a member of that team), optional due date and optional series (of that team). Such an item SHALL belong to no meeting, SHALL be confirmed and 未開始 when created, and SHALL be tracked like a meeting action item: status changes, history, overdue marking and the board's filters. Its source SHALL be shown as 看板新增. When it has a series, it SHALL appear among that series' unfinished items before its next meeting and SHALL be included in in-meeting progress detection for that series. Access SHALL be decided by the item's team: a user who is not a member SHALL get 404. The board's detail panel SHALL allow editing the content of any action item. An item created on the board SHALL be deletable by any member of its team after a second confirming click; an item that came from a meeting SHALL NOT be deletable and SHALL be cancelled instead.

#### Scenario: Creating an action item on the board

- **WHEN** a member presses ＋ 新增待辦 (or `c`), enters content, picks a team member as owner and a due date, and presses 建立
- **THEN** the item appears in 未開始 with source 看板新增, the panel opens on it, and its `meetingId` is `null`

##### Example: Validation

| Input | Result |
| ----- | ------ |
| team the user belongs to, content "寄報價單給客戶" | 201, status todo, state confirmed, origin manual |
| team the user does not belong to | 404 |
| owner who is not in the team | 422 |
| series of another team | 422 |
| content of only spaces | 422 |

#### Scenario: A board item with a series is carried to the next meeting

- **WHEN** a board item has series 研發週會 and is not done, and a meeting of 研發週會 starts
- **THEN** the item is listed among the series' unfinished items, and a progress suggestion for it can be accepted, which changes its status and records the meeting in its history

#### Scenario: Editing the content

- **WHEN** a member edits an action item's content in the board's detail panel and saves
- **THEN** the card and the panel show the new content and the item's version increases

#### Scenario: Deleting a board item

- **WHEN** a member presses 刪除待辦 twice on an item created on the board
- **THEN** the item and its history are removed and the panel closes

#### Scenario: Meeting items cannot be deleted from the board

- **WHEN** a delete request is made for an action item that came from a meeting
- **THEN** the request is refused with 409 and the item is unchanged

#### Scenario: Grouping by source meeting

- **WHEN** the board is grouped by source meeting
- **THEN** board-created items form a lane named 看板新增, placed after the meeting lanes

<!-- @trace
source: board-created-actions
updated: 2026-11-07
code:
  - README.md
  - bench/README.md
  - webapp/actions.py
  - webapp/series.py
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/action-status.js
  - webapp/static/minutes.html
  - bench/actions_e2e.mjs
  - webapp/minutes.py
  - webapp/static/actions.css
  - webapp/static/actions.html
  - webapp/static/actions.js
  - webapp/static/board.js
  - bench/boardcheck.js
  - 20261029_185428.mp4
  - webapp/static/minutes.js
  - webapp/migrations/008_board_items.sql
tests:
  - webapp/test_server.py
-->