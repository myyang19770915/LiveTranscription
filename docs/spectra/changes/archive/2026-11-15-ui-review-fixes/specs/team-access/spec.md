## ADDED Requirements

### Requirement: Removing a member from a team is labelled as such

On the team management page each member row SHALL label the action that takes the member out of the team 移出團隊, styled as a destructive action, and SHALL ask 確定把〈name〉移出〈team〉？ before doing it, where name is the member's shown name and team is the team's name. The action that clears a member's photo SHALL be labelled 移除照片, styled as an ordinary action, and SHALL still ask once more before clearing the photo.

#### Scenario: Taking a member out

- **WHEN** an administrator presses 移出團隊 on 王愛麗's row in team 研發部
- **THEN** the button asks 確定把王愛麗移出研發部？ and the membership is removed only when it is pressed again

#### Scenario: Clearing a photo

- **WHEN** an administrator presses 移除照片 on a member's row
- **THEN** the button asks 確定移除照片？ and the member stays in the team after it is confirmed
