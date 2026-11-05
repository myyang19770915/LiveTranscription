# team-access Specification

## Purpose

Meeting records belong to exactly one team, and only that team's members can see or change them. This capability covers teams, membership, system administrators, and the team check applied to meeting data.

## Requirements

### Requirement: System administrators

The system SHALL treat the usernames listed in the `ADMIN_USERS` environment variable (comma-separated, case-insensitive) as system administrators. Only system administrators SHALL create teams, rename teams, and add or remove team members.

#### Scenario: Non-administrator manages a team

- **WHEN** a signed-in user who is not in `ADMIN_USERS` calls a team-management API
- **THEN** the system responds 403 and changes nothing


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Teams and membership

A team SHALL have a unique name. A user SHALL be able to belong to several teams. An administrator SHALL be able to add a member by LDAP username before that user has ever signed in; the membership SHALL apply when that user signs in.

#### Scenario: Duplicate team name

- **WHEN** an administrator creates a team whose name, ignoring case and surrounding spaces, equals an existing team's name
- **THEN** the system responds 409 and creates nothing

#### Scenario: Member added before first sign-in

- **WHEN** an administrator adds username "bob" to team "研發" and bob signs in for the first time later
- **THEN** bob's team list contains "研發"


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Administrators do not see team records implicitly

Being a system administrator SHALL NOT grant access to any team's meetings. An administrator SHALL see a team's meetings only as a member of that team.

#### Scenario: Administrator outside the team

- **WHEN** an administrator who is not a member of team "業務" requests a meeting of team "業務"
- **THEN** the system responds 404


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: A meeting belongs to one team

Starting a meeting SHALL require choosing one of the user's own teams. The system SHALL create a meeting record with that team, the starting user and the start time before audio is forwarded, and SHALL refuse to start when the user belongs to no team.

#### Scenario: User with one team

- **WHEN** a user who belongs only to team "研發" opens the main page
- **THEN** the team "研發" is preselected, and a meeting started from it stores team "研發"

#### Scenario: User with no team

- **WHEN** a user who belongs to no team presses start
- **THEN** the meeting does not start and the page shows 尚未加入任何團隊，請聯絡管理員

#### Scenario: Choosing a team the user is not in

- **WHEN** a request starts a meeting with the id of a team the user does not belong to
- **THEN** the system responds 404 and creates no meeting record


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Team isolation of meeting data

Every read or write of a meeting or its files SHALL check that the signed-in user is a member of the meeting's team at the time of the request. A non-member SHALL receive 404, the same response as for a meeting that does not exist, so that meeting existence is not revealed. Removing a member SHALL take effect on that member's next request.

#### Scenario: Member of another team

- **WHEN** a member of team "研發" requests the meeting list or a meeting file of team "業務"
- **THEN** the list contains no "業務" meetings and the file request responds 404

#### Scenario: Removed member

- **WHEN** an administrator removes alice from team "研發" while alice's session is still valid
- **THEN** alice's next request for a "研發" meeting responds 404


<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->

---
### Requirement: Meeting files are stored per meeting

Recordings and transcripts saved through the app SHALL be stored under `output/teams/<team id>/<meeting id>/`, and the save request SHALL name the meeting it belongs to. Files directly under `output/` from before this change SHALL be left untouched and SHALL NOT be served through the app.

#### Scenario: Saving a recording

- **WHEN** a team member saves the recording of a meeting of their team
- **THEN** the file is written under that team's and that meeting's folder

#### Scenario: Saving to another team's meeting

- **WHEN** a user saves a file naming a meeting of a team they do not belong to
- **THEN** the system responds 404 and writes nothing

<!-- @trace
source: team-accounts
updated: 2026-11-05
code:
  - docs/roadmap.md
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
-->