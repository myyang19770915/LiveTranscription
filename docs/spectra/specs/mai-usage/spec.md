# mai-usage Specification

## Purpose

Azure MAI recognition is billed by the length of audio sent. This capability records how much audio the app and its benchmark tools send to MAI and shows administrators the accumulated cost against a budget, so that going over it is a decision and not a surprise.

## Requirements

### Requirement: Audio sent to MAI is recorded

Every connection that sends audio to Azure MAI SHALL add the seconds of audio it actually sent (16 kHz, 16-bit mono: 32000 bytes per second) to the `mai_usage` record of the current date (in `MEETING_TIMEZONE`) and its purpose: `live` for the live recognition engine and `quality` for the quality pass. A connection SHALL write what it has not yet recorded whenever that reaches 300 seconds of audio and when it ends. The record SHALL hold only the date, the purpose and the seconds: no meeting, user or text. A failure to write the record SHALL be logged and SHALL NOT interrupt recognition.

#### Scenario: A live MAI stream ends

- **WHEN** a stream with the MAI engine sends 2 seconds of audio and ends
- **THEN** the `live` record of today has grown by 2 seconds

#### Scenario: The quality pass listens with MAI

- **WHEN** a stream whose quality pass uses MAI sends 3 seconds of audio and ends
- **THEN** the `quality` record of today has grown by 3 seconds

#### Scenario: A long connection

- **WHEN** a connection has sent 301 seconds of audio and is still open
- **THEN** at least 300 seconds are already recorded

#### Scenario: The database is unavailable

- **WHEN** writing the record fails
- **THEN** the stream continues and a warning is logged


<!-- @trace
source: mai-usage
updated: 2026-11-14
code:
  - README.md
  - bench/README.md
  - webapp/server.py
  - webapp/mai_asr.py
  - webapp/mai_usage.py
  - webapp/migrations/018_mai_usage.sql
  - .env.example
  - compose.yaml
  - webapp/static/admin.html
  - bench/mai_usage_e2e.mjs
  - webapp/quality_pass.py
  - webapp/chunk_asr.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Usage outside the app is entered by hand

`python -m mai_usage add <seconds> <purpose>` SHALL add that many seconds to today's record of that purpose, and `python -m mai_usage` SHALL print the accumulated hours, the estimated cost and the budget. A purpose SHALL be 1 to 40 characters of lower-case letters, digits and hyphens; seconds SHALL be a finite number greater than 0.

#### Scenario: Benchmark usage entered

- **WHEN** `python -m mai_usage add 5400 bench` is run
- **THEN** the `bench` record of today has grown by 5400 seconds

#### Scenario: Invalid entry

- **WHEN** `python -m mai_usage add -5 bench` or `python -m mai_usage add 60 "Bench Run"` is run
- **THEN** nothing is recorded and the command exits with an error


<!-- @trace
source: mai-usage
updated: 2026-11-14
code:
  - README.md
  - bench/README.md
  - webapp/server.py
  - webapp/mai_asr.py
  - webapp/mai_usage.py
  - webapp/migrations/018_mai_usage.sql
  - .env.example
  - compose.yaml
  - webapp/static/admin.html
  - bench/mai_usage_e2e.mjs
  - webapp/quality_pass.py
  - webapp/chunk_asr.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Administrators see the accumulated cost against the budget

`GET /api/admin/mai-usage` SHALL require a system administrator and SHALL return `seconds` (all records summed), `usd` (`seconds` / 3600 × `MAI_USD_PER_HOUR`, default 0.54, rounded to 2 decimals), `budgetUsd` (`MAI_BUDGET_USD`, default 50), `usdPerHour`, `state` and `byPurpose` (seconds per purpose). `state` SHALL be `over` when `usd` is at least `budgetUsd`, `near` when it is at least 80% of it, and `ok` otherwise. The team administration page SHALL show these figures to administrators, with a warning for `near` and `over`. Reaching the budget SHALL NOT disable MAI.

The first time the accumulated cost is at or above 80% of the budget, and the first time it is at or above the budget, the app SHALL log one warning each naming the cost and the budget; "first" is per run of the app, so a restarted app logs it again with its first write.

#### Scenario: Not an administrator

- **WHEN** a signed-in user who is not a system administrator calls `/api/admin/mai-usage`
- **THEN** the response is 403

#### Scenario: Budget reached

- **WHEN** the records add up to the budget and a stream with the MAI engine starts
- **THEN** the stream is recognized by MAI as usual

##### Example: cost and state

| Seconds recorded | `MAI_USD_PER_HOUR` | `MAI_BUDGET_USD` | `usd` | `state` |
| ---------------- | ------------------ | ---------------- | ----- | ------- |
| 0 | 0.54 | 50 | 0 | ok |
| 5400 | 0.54 | 50 | 0.81 | ok |
| 266667 | 0.54 | 50 | 40 | near |
| 333334 | 0.54 | 50 | 50 | over |
| 7200 | 1 | 2 | 2 | over |
| 333306 | 0.54 | 50 | 50 | over |

<!-- @trace
source: mai-usage
updated: 2026-11-14
code:
  - README.md
  - bench/README.md
  - webapp/server.py
  - webapp/mai_asr.py
  - webapp/mai_usage.py
  - webapp/migrations/018_mai_usage.sql
  - .env.example
  - compose.yaml
  - webapp/static/admin.html
  - bench/mai_usage_e2e.mjs
  - webapp/quality_pass.py
  - webapp/chunk_asr.py
tests:
  - webapp/test_server.py
-->