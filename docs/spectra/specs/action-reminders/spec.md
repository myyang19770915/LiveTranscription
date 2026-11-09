# action-reminders Specification

## Purpose

Owners of action items get an e-mail before an item is due, on the day it is due, and every day while it is overdue, so deadlines are not discovered only at the next meeting. This capability covers which items are reminded and when, the daily schedule, and switching reminders off per item.

## Requirements

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


<!-- @trace
source: review-followups
updated: 2026-11-09
code:
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/reminders.py
  - webapp/static/index.html
  - webapp/static/overlay.css
  - webapp/static/app.js
  - webapp/mailer.py
  - bench/translate_e2e.mjs
  - bench/reminders_e2e.mjs
  - README.md
  - webapp/static/actions.html
  - webapp/auth.py
  - webapp/static/actions.css
  - webapp/static/actions.js
  - webapp/static/minutes.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: One reminder mail per owner

All of an owner's reminders from one run SHALL be sent as one mail, grouped as overdue, due today and due soon, each item with its content, team and source meeting, due date, status and a link to it on the board when `PUBLIC_BASE_URL` is set. The subject SHALL state the counts. Item text SHALL be HTML-escaped in the HTML part.

#### Scenario: A digest for one owner

- **WHEN** bob has one overdue item and one item due today
- **THEN** bob receives one mail with the subject `[語橋 Live] 待辦提醒：逾期 1 件、今天到期 1 件` listing both items


<!-- @trace
source: action-reminders
updated: 2026-11-09
code:
  - webapp/migrations/015_action_reminders.sql
  - webapp/static/actions.js
  - README.md
  - webapp/static/search.html
  - webapp/reminders.py
  - webapp/static/meetings.html
  - compose.yaml
  - webapp/static/ask.html
  - webapp/minutes.py
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/index.html
  - webapp/static/account.js
  - webapp/static/metrics.html
  - .env.example
  - 20261108_143903.mp4
  - webapp/static/review.html
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/actions.html
  - webapp/static/admin.html
  - login_ui_template.jpg
  - webapp/actions.py
  - webapp/static/actions.css
  - bench/reminders_e2e.mjs
tests:
  - webapp/test_server.py
-->

---
### Requirement: Reminders per item

Reminders SHALL be on for every action item by default. Only the item's owner or a system administrator SHALL be able to switch an item's reminders off or on; other members SHALL receive 403. The board SHALL show whether an item's reminders are off. When an item's owner changes, its reminders SHALL be switched back on.

#### Scenario: The owner switches reminders off

- **WHEN** bob, the owner, switches off reminders of an overdue item
- **THEN** the next run sends bob no reminder for that item and the board marks it as having reminders off

#### Scenario: Another member cannot switch reminders off

- **WHEN** alice, a member who is not the owner and not an administrator, switches off reminders of bob's item
- **THEN** the system responds 403 and the reminders stay on

#### Scenario: A new owner gets reminders

- **WHEN** the owner of an item with reminders off is changed to carol
- **THEN** the item's reminders are on again

<!-- @trace
source: action-reminders
updated: 2026-11-09
code:
  - webapp/migrations/015_action_reminders.sql
  - webapp/static/actions.js
  - README.md
  - webapp/static/search.html
  - webapp/reminders.py
  - webapp/static/meetings.html
  - compose.yaml
  - webapp/static/ask.html
  - webapp/minutes.py
  - webapp/server.py
  - webapp/static/minutes.html
  - webapp/static/index.html
  - webapp/static/account.js
  - webapp/static/metrics.html
  - .env.example
  - 20261108_143903.mp4
  - webapp/static/review.html
  - 20261029_185428.mp4
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/actions.html
  - webapp/static/admin.html
  - login_ui_template.jpg
  - webapp/actions.py
  - webapp/static/actions.css
  - bench/reminders_e2e.mjs
tests:
  - webapp/test_server.py
-->