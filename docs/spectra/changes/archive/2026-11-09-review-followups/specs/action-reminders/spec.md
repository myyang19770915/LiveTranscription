## MODIFIED Requirements

### Requirement: Reminder timing

Once a day, after `REMIND_AT` (default 09:00) in `MEETING_TIMEZONE`, the system SHALL e-mail the owner of every confirmed action item whose status is 未開始 or 進行中, that has an owner who is still a member of the item's team and has an e-mail address, that has a due date, and whose reminders are on. An item SHALL be reminded once while it is due in one to three days, once on its due date, and once every day while it is overdue. A changed due date SHALL count as a new due date. Without a configured mail server no reminder SHALL be sent. The schedule SHALL be checked at least every five minutes, so a server that starts, wakes up or changes its clock after `REMIND_AT` still sends that day's reminders. A reminder that was not sent, because its mail failed or because the run was interrupted, SHALL be sent by a later run: a failed send SHALL be retried 30 minutes later on the same day.

#### Scenario: The daily reminders

- **WHEN** the reminders run on 2026-11-10
- **THEN** each eligible item is reminded according to its due date as in the example below

##### Example: which reminder an item gets

| Due date | Status | Reminder on 2026-11-10 |
| -------- | ------ | ---------------------- |
| 2026-11-13 | 未開始 | due soon |
| 2026-11-11 | 進行中 | due soon |
| 2026-11-14 | 未開始 | none |
| 2026-11-10 | 未開始 | due today |
| 2026-11-08 | 進行中 | overdue (2 days) |
| 2026-11-08 | 已完成 | none |
| none | 未開始 | none |

#### Scenario: Running twice on one day

- **WHEN** the reminders run a second time on the same day
- **THEN** no item receives the same reminder again

#### Scenario: Overdue every day, due soon only once

- **WHEN** the reminders run on 2026-11-10 and again on 2026-11-11 for one item due 2026-11-08 and one due 2026-11-13
- **THEN** the overdue item is reminded on both days and the item due 2026-11-13 only on 2026-11-10

#### Scenario: A failed send is retried

- **WHEN** the mail server refuses an owner's reminder
- **THEN** the next run sends that owner's reminders again

#### Scenario: An interrupted run loses nothing

- **WHEN** a run is interrupted while sending the first of two owners' reminders
- **THEN** neither owner's reminders stay recorded as sent, and the next run sends both

#### Scenario: When the schedule runs

- **WHEN** the schedule is checked with `REMIND_AT` 09:00
- **THEN** it runs as in the example below

##### Example: due_now

| Now | Last run | Retry at | Runs |
| --- | -------- | -------- | ---- |
| 2026-11-10 08:59 | 2026-11-09 | none | no |
| 2026-11-10 09:00 | 2026-11-09 | none | yes |
| 2026-11-10 15:00 | 2026-11-10 | none | no |
| 2026-11-10 09:40 | 2026-11-10 | 2026-11-10 09:35 | yes |
| 2026-11-11 09:10 | 2026-11-10 | 2026-11-10 09:35 | yes |

#### Scenario: Owners who cannot be reached

- **WHEN** an item's owner has no e-mail address or is no longer a member of the item's team
- **THEN** no reminder is sent for that item
