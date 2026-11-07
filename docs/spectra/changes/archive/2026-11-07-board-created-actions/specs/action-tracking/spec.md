## ADDED Requirements

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
