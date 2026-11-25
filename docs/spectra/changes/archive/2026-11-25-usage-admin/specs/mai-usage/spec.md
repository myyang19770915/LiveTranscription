## MODIFIED Requirements

### Requirement: Administrators see the accumulated cost against the budget

`GET /api/admin/mai-usage` SHALL require a system administrator and SHALL return `seconds` (all records summed), `usd` (`seconds` / 3600 × `MAI_USD_PER_HOUR`, default 0.54, rounded to 2 decimals), `budgetUsd`, `usdPerHour`, `state` and `byPurpose` (seconds per purpose). `budgetUsd` SHALL be the budget administrators set for cloud recognition on the usage management page (usage-admin), which is `MAI_BUDGET_USD` (default 50) until one is saved and `null` when they removed it. `state` SHALL be `over` when `usd` is at least `budgetUsd`, `near` when it is at least 80% of it, and `ok` otherwise or when there is no budget. The usage management page (`/admin/usage`) SHALL show these figures to administrators, with a warning for `near` and `over`; the team administration page SHALL NOT show them. Reaching the budget SHALL NOT disable MAI.

The first time the accumulated cost is at or above 80% of the budget, and the first time it is at or above the budget, the app SHALL log one warning each naming the cost and the budget; "first" is per run of the app, so a restarted app logs it again with its first write. Without a budget no warning SHALL be logged.

#### Scenario: Not an administrator

- **WHEN** a signed-in user who is not a system administrator calls `/api/admin/mai-usage`
- **THEN** the response is 403

#### Scenario: Budget reached

- **WHEN** the records add up to the budget and a stream with the MAI engine starts
- **THEN** the stream is recognized by MAI as usual

#### Scenario: The budget saved on the usage page

- **WHEN** an administrator saved a budget of 2 USD for cloud recognition and the records add up to 7200 seconds at 0.54 USD per hour
- **THEN** `/api/admin/mai-usage` reports `budgetUsd` 2 and the state `ok`, and after 7200 more seconds at that price the state is `over`

#### Scenario: The team administration page

- **WHEN** an administrator opens `/admin`
- **THEN** the page has no card 雲端辨識用量 and does not request `/api/admin/mai-usage`

##### Example: cost and state

| Seconds recorded | `MAI_USD_PER_HOUR` | Budget | `usd` | `state` |
| ---------------- | ------------------ | ------ | ----- | ------- |
| 0 | 0.54 | 50 | 0 | ok |
| 5400 | 0.54 | 50 | 0.81 | ok |
| 266667 | 0.54 | 50 | 40 | near |
| 333334 | 0.54 | 50 | 50 | over |
| 7200 | 1 | 2 | 2 | over |
| 333306 | 0.54 | 50 | 50 | over |
| 400000 | 0.54 | none | 60 | ok |
