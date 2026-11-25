## MODIFIED Requirements

### Requirement: Translation cost is recorded for administrators

When an interpret session ends the server SHALL add its translated audio seconds to today's row (date in `MEETING_TIMEZONE`) of the table `interpret_usage (day, purpose, username, seconds)` with purpose `live` and the user's name; rows written before this field existed SHALL have the username `''`. The saved session's `usd` SHALL be those seconds / 3600 × `INTERPRET_USD_PER_HOUR` (default 2.04). A failure to write the usage SHALL be logged and SHALL NOT stop the session from being saved. `GET /api/admin/interpret-usage` SHALL require a system administrator and SHALL return `seconds`, `usd` (rounded to 2 decimals), `usdPerHour`, `byPurpose` and `byUser` (seconds per username). The usage management page (`/admin/usage`, usage-admin) SHALL show these figures with a line per user (the empty username shown as （未記名）); the team administration page SHALL NOT show them. Administrators SHALL be able to set a budget for 即時口譯 on the usage management page; reaching it SHALL only show a warning there and SHALL NOT stop or limit interpreting. The translation cost SHALL NOT be added to the MAI budget. `python -m interpret_usage add <seconds> <purpose>` SHALL add usage by hand with the same purpose rules as `mai_usage` (1–40 of `a-z`, `0-9`, `-`; seconds more than 0 and finite) and the username `''`, and `python -m interpret_usage` SHALL print the total.

#### Scenario: Cost of a session

- **WHEN** alice's session produces 15.4 seconds of translated audio with the default price
- **THEN** `interpret_usage` grows by 15.4 seconds for purpose `live` and username `alice`, and the session's `usd` is 0.0087

##### Example: usage figures

| Seconds recorded | `INTERPRET_USD_PER_HOUR` | `usd` |
| ---------------- | ------------------------ | ----- |
| 0 | 2.04 | 0 |
| 1800 | 2.04 | 1.02 |
| 129 | 2.04 | 0.07 |
| 3600 | 3 | 3 |

#### Scenario: Usage per user

- **WHEN** 129 seconds were added by hand and alice used 1800 seconds
- **THEN** `byUser` is `{"": 129, "alice": 1800}` and the usage management page lists alice and （未記名）

#### Scenario: A member asks for the usage

- **WHEN** member alice requests `/api/admin/interpret-usage`
- **THEN** the response is 403

#### Scenario: The budget is reached

- **WHEN** the accumulated translation cost is at or above the budget set for 即時口譯 and a granted user starts interpreting
- **THEN** the session runs as usual

#### Scenario: The team administration page

- **WHEN** an administrator opens `/admin`
- **THEN** the page has no card 即時口譯用量 and does not request `/api/admin/interpret-usage`
