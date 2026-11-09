# minutes-mail Specification

## Purpose

Teams receive the confirmed meeting minutes by e-mail instead of downloading and forwarding them by hand. This capability covers each team's sending preferences, finalizing the minutes, sending them automatically or by hand through the company SMTP server, and the record of every send.

## Requirements

### Requirement: Team mail settings

Each team SHALL have one set of mail settings: a target of either the members' own addresses (`members`, the default) or one team address (`team`), that address, and whether finalizing sends automatically (off by default). Any member of the team and any administrator SHALL be able to change them; others SHALL receive 403. The target `team` SHALL require a well-formed address.

#### Scenario: A member switches to the team address

- **WHEN** a member of the team saves target `team` with address `rd@corp.example` and auto send on
- **THEN** the settings are stored and later sends of that team's minutes go only to `rd@corp.example`

#### Scenario: A non-member cannot change the settings

- **WHEN** a signed-in user who is neither a member of the team nor an administrator saves its settings
- **THEN** the system responds 403 and the settings stay unchanged

#### Scenario: Team target without an address

- **WHEN** a member saves target `team` with an empty or malformed address
- **THEN** the system responds 422 with the message Email 格式不正確


<!-- @trace
source: minutes-mail
updated: 2026-11-09
code:
  - webapp/auth.py
  - webapp/static/ask.html
  - webapp/static/metrics.html
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/minutes.css
  - webapp/static/index.html
  - webapp/migrations/014_minutes_mail.sql
  - webapp/static/admin.html
  - webapp/static/minutes.html
  - login_ui_template.jpg
  - webapp/static/actions.html
  - docker/dev-ldap/users.ldif
  - webapp/mailer.py
  - webapp/server.py
  - webapp/static/minutes.js
  - webapp/static/account.js
  - webapp/static/meetings.html
  - compose.yaml
  - webapp/static/review.html
  - webapp/minutes.py
  - webapp/static/search.html
  - .env.example
  - README.md
  - 20261108_143903.mp4
  - 20261029_185428.mp4
  - bench/mail_e2e.mjs
tests:
  - webapp/test_server.py
-->

---
### Requirement: Finalize minutes

A team member SHALL be able to finalize a meeting's minutes, which records who finalized them and when. Finalizing a second time SHALL change nothing. When the team's auto send is on and the meeting has no earlier automatic send, the first finalize SHALL send the minutes; a failed automatic send SHALL NOT undo the finalize.

#### Scenario: Finalize with auto send on

- **WHEN** a member finalizes minutes of a team whose auto send is on
- **THEN** the minutes are marked finalized and one automatic send is recorded

#### Scenario: Finalize again

- **WHEN** a member finalizes minutes that are already finalized
- **THEN** the finalize time and person stay the same and no further mail is sent

#### Scenario: Finalize with auto send off

- **WHEN** a member finalizes minutes of a team whose auto send is off
- **THEN** the minutes are marked finalized and no mail is sent


<!-- @trace
source: minutes-mail
updated: 2026-11-09
code:
  - webapp/auth.py
  - webapp/static/ask.html
  - webapp/static/metrics.html
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/minutes.css
  - webapp/static/index.html
  - webapp/migrations/014_minutes_mail.sql
  - webapp/static/admin.html
  - webapp/static/minutes.html
  - login_ui_template.jpg
  - webapp/static/actions.html
  - docker/dev-ldap/users.ldif
  - webapp/mailer.py
  - webapp/server.py
  - webapp/static/minutes.js
  - webapp/static/account.js
  - webapp/static/meetings.html
  - compose.yaml
  - webapp/static/review.html
  - webapp/minutes.py
  - webapp/static/search.html
  - .env.example
  - README.md
  - 20261108_143903.mp4
  - 20261029_185428.mp4
  - bench/mail_e2e.mjs
tests:
  - webapp/test_server.py
-->

---
### Requirement: Send minutes

A team member SHALL be able to send a meeting's minutes at any time, finalized or not, as long as they have a summary or at least one confirmed item. The mail SHALL contain only confirmed items, grouped as decisions, action items with owner and due date, open questions and risks, plus the summary and, when `PUBLIC_BASE_URL` is set, a link to the minutes page. It SHALL carry both an HTML and a plain-text part, and all meeting text SHALL be HTML-escaped in the HTML part. With target `members`, every team member with an e-mail address SHALL be a recipient and members without one SHALL be listed as not reached. With target `team`, only the team address SHALL be a recipient.

#### Scenario: Send to members

- **WHEN** alice sends the minutes of a team with members alice (has an address) and bob (no address) and target `members`
- **THEN** one mail goes to alice's address and the send record lists bob as not reached

#### Scenario: Only confirmed items are sent

- **WHEN** the minutes have one confirmed decision and one proposed action item
- **THEN** the mail contains the decision and does not contain the proposed action item

#### Scenario: Nothing to send

- **WHEN** a member sends minutes with an empty summary and no confirmed item
- **THEN** the system responds 422 with the message 紀要還沒有內容可寄送 and contacts no mail server

#### Scenario: No recipient

- **WHEN** the target is `members` and no member has an e-mail address
- **THEN** the system responds 422 with the message 沒有可寄送的收件人 and contacts no mail server

#### Scenario: Meeting text in the HTML part

- **WHEN** a confirmed item's content is `<b>報價</b> & 交期`
- **THEN** the HTML part shows that text literally (escaped) and the plain-text part contains it unchanged


<!-- @trace
source: minutes-mail
updated: 2026-11-09
code:
  - webapp/auth.py
  - webapp/static/ask.html
  - webapp/static/metrics.html
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/minutes.css
  - webapp/static/index.html
  - webapp/migrations/014_minutes_mail.sql
  - webapp/static/admin.html
  - webapp/static/minutes.html
  - login_ui_template.jpg
  - webapp/static/actions.html
  - docker/dev-ldap/users.ldif
  - webapp/mailer.py
  - webapp/server.py
  - webapp/static/minutes.js
  - webapp/static/account.js
  - webapp/static/meetings.html
  - compose.yaml
  - webapp/static/review.html
  - webapp/minutes.py
  - webapp/static/search.html
  - .env.example
  - README.md
  - 20261108_143903.mp4
  - 20261029_185428.mp4
  - bench/mail_e2e.mjs
tests:
  - webapp/test_server.py
-->

---
### Requirement: Mail server configuration

Sending SHALL use the SMTP server configured by `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` and `SMTP_TLS` (`starttls`, `ssl` or `none`); any other `SMTP_TLS` value SHALL be logged as an error and treated as `starttls`, so credentials are never sent over an unencrypted connection by mistake. Without `SMTP_HOST`, sending SHALL respond 503 with the message 尚未設定寄信伺服器 and the minutes page SHALL disable its send buttons while finalize stays available. A mail server failure, or any unexpected error while sending, SHALL respond 502 with a message that starts with 寄送失敗 and SHALL be recorded as a failed send; the recorded error SHALL NOT contain the SMTP password. A failed automatic send SHALL NOT keep the finalize from succeeding.

#### Scenario: SMTP not configured

- **WHEN** `SMTP_HOST` is empty and a member sends the minutes
- **THEN** the system responds 503 with the message 尚未設定寄信伺服器

#### Scenario: Mail server refuses

- **WHEN** the mail server raises an error during the send
- **THEN** the system responds 502 with a message starting with 寄送失敗 and the minutes page shows the failed send

#### Scenario: Unknown SMTP_TLS value

- **WHEN** `SMTP_TLS` is `tls`
- **THEN** the connection is upgraded with STARTTLS before logging in

#### Scenario: Unexpected error while sending

- **WHEN** composing or sending the mail raises an error that is not an SMTP or connection error during a finalize with auto send on
- **THEN** the finalize succeeds and the send is recorded as failed with the error's type


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
### Requirement: Send record

Every send attempt that reaches the mail server SHALL be recorded with its trigger (`auto` or `manual`), recipients, members not reached, who sent it, when, and whether it succeeded with its error. When the server accepts the mail for some recipients but refuses others, the send SHALL be recorded as failed with the refused addresses in its error. The minutes page SHALL show the latest record.

#### Scenario: The latest send is shown

- **WHEN** bob sends the minutes by hand after an earlier automatic send
- **THEN** the minutes API reports bob's manual send as the latest, with its time and recipient count

#### Scenario: Some recipients refused

- **WHEN** the server refuses carol@corp.example but accepts the other recipients
- **THEN** the send responds 502, is recorded as failed, and its error names carol@corp.example

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