## MODIFIED Requirements

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
