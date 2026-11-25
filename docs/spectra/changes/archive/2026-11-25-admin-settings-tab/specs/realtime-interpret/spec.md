## MODIFIED Requirements

### Requirement: Interpreting is open to granted users

A user SHALL be allowed to interpret when the user is a system administrator or the username is in the table `interpret_access (username, granted_by, granted_at)`. `GET /api/admin/interpret-access`, `POST /api/admin/interpret-access` with `{"username": <name>}` and `DELETE /api/admin/interpret-access/<username>` SHALL require a system administrator (403 otherwise) and SHALL list, grant and withdraw access; a username SHALL be lower-cased and SHALL match `^[a-z0-9_][a-z0-9._-]{0,63}$`, otherwise the answer is 422. The system settings page (`/admin/settings`, system-settings) SHALL show a section 即時口譯權限 listing the granted accounts with 移除, a field to add a 公司帳號, and a note that interpreting is used from the live page. `GET /api/interpret/config` SHALL answer every signed-in user with `configured`, `allowed`, `usdPerHour` and `targets`. `/ws/interpret` SHALL close with code 4401 without a session and with code 4403 and the reason 即時口譯需要申請權限，請聯絡系統管理員 when the user is not allowed, in both cases before any connection to the translation service; while a session runs, the periodic session re-check SHALL also re-check the access, and a withdrawn access SHALL stop the session with code 4403 and save what there is.

#### Scenario: Granting a member

- **WHEN** an administrator adds 公司帳號 Alice in 即時口譯權限
- **THEN** `interpret_access` holds `alice`, and alice's `/api/interpret/config` answers `"allowed": true`

#### Scenario: A member without access opens the WebSocket

- **WHEN** member bob, not granted, opens `/ws/interpret`
- **THEN** it closes with code 4403 and the translation service is not contacted

#### Scenario: Access withdrawn during a session

- **WHEN** alice is interpreting and an administrator removes her, and the next re-check runs
- **THEN** the session stops with code 4403 and what was interpreted is saved

##### Example: who may interpret

| User | Granted | Allowed |
| ---- | ------- | ------- |
| administrator t05313 | no | yes |
| member alice | yes | yes |
| member bob | no | no |
| `POST` username `Bad Name` | — | 422 |

### Requirement: Saved records are kept for a set number of days

Saved sessions of both kinds SHALL be kept for the number of days in the setting `records_retention_days` (table `app_settings`), 90 when it is not set. `GET /api/admin/records-retention` SHALL return `{"days": <n>}` and `PUT /api/admin/records-retention` with `{"days": <n>}` SHALL change it; both SHALL require a system administrator (403 otherwise), and `days` SHALL be an integer from 1 to 3650, otherwise the answer is 422. The server SHALL delete every saved session folder under `output/interpret/<username>/` whose id date (`YYYYMMDD`, in `MEETING_TIMEZONE`) is earlier than today minus the number of days, and every working folder starting with `.recording-` that was last changed more than one day ago: once when the server starts, every 6 hours after that, and right after the setting changes. A folder that cannot be deleted SHALL be logged and SHALL NOT stop the others. The system settings page (`/admin/settings`, system-settings) SHALL show 紀錄保存期限 with the number of days, a way to change it and the note 即時翻譯與即時口譯紀錄超過天數會自動刪除. `GET /api/interpret/config` SHALL include `retentionDays`, and 我的紀錄 SHALL read 紀錄保存 <n> 天，到期自動刪除.

#### Scenario: Old records are removed

- **WHEN** today is 2026-11-17, the setting is 90 days, and the sweep runs
- **THEN** the folders are kept or deleted as in the example table

##### Example: which folders a 90-day sweep deletes on 2026-11-17

| Folder | Result |
| ------ | ------ |
| `20260818-235959` | deleted (2026-11-17 − 90 days = 2026-08-19; this date is earlier) |
| `20260819-000000` | kept |
| `20261117-101500` | kept |
| `.recording-20261115-…` changed 2 days ago | deleted |
| `.recording-20261117-…` changed 1 hour ago | kept |

#### Scenario: An administrator shortens the period

- **WHEN** an administrator sets 紀錄保存期限 to 30 days on 2026-11-17
- **THEN** `GET /api/admin/records-retention` answers `{"days": 30}`, records dated before 2026-10-18 are deleted right away, and 我的紀錄 reads 紀錄保存 30 天，到期自動刪除

#### Scenario: Invalid number of days

- **WHEN** an administrator sends `{"days": 0}` or `{"days": "90"}`
- **THEN** the answer is 422 and the setting is unchanged
