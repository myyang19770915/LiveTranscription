## ADDED Requirements

### Requirement: Mail settings changes are recorded

Every save of a team's mail settings that changes the target, the address or automatic sending SHALL be recorded with its time, the user who saved it, whether that user was a member of the team at that moment, and the settings before and after; a save that changes nothing SHALL NOT be recorded. The minutes page's sending block SHALL show the latest change as 寄送設定由 <name> 於 <M/D HH:MM> 修改. When the user who made the latest change was not a member of the team (an administrator), the line SHALL be shown as a warning, SHALL name them as <name>（系統管理員，非團隊成員）, and SHALL state the new settings, so the team notices where its minutes now go.

#### Scenario: A member changes the settings

- **WHEN** alice, a member, switches her team to the team address rd@corp.example
- **THEN** the change is recorded and the minutes page of that team's meetings shows 寄送設定由 王愛麗 於 <time> 修改

#### Scenario: An administrator who is not a member changes the address

- **WHEN** admin, who is not a member of the team, changes the team address to someone@outside.example
- **THEN** the minutes page shows, as a warning, 寄送設定由 管理員（系統管理員，非團隊成員）於 <time> 修改：改寄團隊信箱 someone@outside.example

##### Example: what is recorded

| Saved by | Member | Before | After | Recorded | Shown as |
| -------- | ------ | ------ | ----- | -------- | -------- |
| alice | yes | members, auto off | team rd@corp.example, auto off | yes | normal line |
| alice | yes | team rd@corp.example | team rd@corp.example (same) | no | previous line kept |
| admin | no | team rd@corp.example | team someone@outside.example, auto on | yes | warning with the new settings |
