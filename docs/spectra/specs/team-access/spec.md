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

---
### Requirement: Member profile photos

A system administrator SHALL be able to set, replace and remove a profile photo for any team member account from the team administration page, including an account that has not signed in yet; on that page the member's avatar itself SHALL be the control that opens the image picker, and a remove control SHALL be shown only when the member has a photo. Every signed-in user SHALL be able to set, replace and remove their own photo from the avatar menu in the page header, and SHALL NOT be able to change anyone else's. A photo SHALL belong to the account (lower-cased username), so the same photo is shown in every team the account belongs to. The browser SHALL crop the chosen image to its centre square and scale it to 160×160 before uploading. The server SHALL accept only PNG, JPEG or WebP images whose leading bytes match the declared type, of 1 byte to 256 KB, and SHALL reject anything else, including SVG. Any signed-in user SHALL be able to read a photo. API responses that list people, and the signed-in user's own `/api/me`, SHALL carry an `avatarUrl` that changes whenever the photo changes, or `null` when there is none. Wherever an avatar is shown on the team administration page, the page header and the action board (cards, the avatar filter, owner swimlanes, the detail panel), a person with a photo SHALL be shown with the photo, and a person without one, or whose photo fails to load, SHALL keep the existing initial avatar. Avatars SHALL stay circular and centred, including a pressed avatar filter button.

#### Scenario: Administrator sets a photo

- **WHEN** a system administrator clicks member alice's avatar on the team administration page and chooses an image
- **THEN** the image is cropped and scaled to 160×160, uploaded, and alice's row shows the photo instead of her initial

#### Scenario: A user changes their own photo

- **WHEN** a signed-in user opens the avatar menu in the page header, chooses 更換照片 and picks an image
- **THEN** the photo is stored for their own account, the header avatar shows it, and the action board shows it on their cards without a full page reload

#### Scenario: A user removes their own photo

- **WHEN** a signed-in user with a photo chooses 移除照片 in the header avatar menu
- **THEN** their `avatarUrl` becomes `null` and their avatar shows their initial again

#### Scenario: Photo appears on the action board

- **WHEN** alice has a photo and a signed-in user opens the action board
- **THEN** alice's avatar in the avatar filter, on her cards and in the detail panel shows the photo

#### Scenario: Pressed avatar filter stays round

- **WHEN** a user presses the avatar filter button of a person with a photo
- **THEN** the button is as wide as it is tall and the photo sits centred inside a round highlight

#### Scenario: No photo keeps the initial

- **WHEN** bob has no photo, or his photo fails to load
- **THEN** bob's avatar shows his initial on his stable colour, as before

#### Scenario: Removing a photo

- **WHEN** a system administrator removes alice's photo
- **THEN** reading the photo returns 404, `avatarUrl` is `null`, and her avatar shows her initial again

#### Scenario: Only administrators change other people's photos

- **WHEN** a signed-in user who is not a system administrator uploads or removes a photo through the administrator API
- **THEN** the request is refused with 403 and the photo is unchanged

#### Scenario: Unsafe or oversized images are refused

- **WHEN** an upload, by an administrator or by a user for themselves, is SVG, is labelled PNG but does not start with the PNG signature, or is larger than 256 KB
- **THEN** the request is refused (415 for the type, 413 for the size) and no photo is stored

##### Example: Upload checks

| Content type | Body | Result |
| ------------ | ---- | ------ |
| image/png | PNG signature, 2 KB | 200, stored |
| image/webp | RIFF....WEBP, 20 KB | 200, stored |
| image/svg+xml | `<svg ...>` | 415 |
| image/png | JPEG bytes | 415 |
| image/jpeg | JPEG bytes, 300 KB | 413 |
| image/png | empty | 422 |

<!-- @trace
source: avatar-self-service
updated: 2026-11-07
code:
  - webapp/static/actions.html
  - webapp/static/index.html
  - webapp/static/review.html
  - webapp/static/actions.css
  - webapp/static/account.js
  - webapp/static/minutes.html
  - bench/avatar_e2e.mjs
  - webapp/static/admin.html
  - meeting-2026-11-01T00-16-53.txt
  - 20261029_185428.mp4
  - webapp/static/actions.js
  - webapp/static/accounts.css
  - webapp/static/meetings.html
  - bench/README.md
  - webapp/team_access.py
  - webapp/auth.py
  - webapp/static/admin.css
  - README.md
tests:
  - webapp/test_server.py
-->