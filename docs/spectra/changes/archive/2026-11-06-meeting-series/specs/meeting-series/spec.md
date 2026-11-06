## Purpose

Recurring meetings of a team form a series, chosen before the meeting starts, so that each meeting of the series begins with the action items its earlier meetings left unfinished.

## ADDED Requirements

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
