## MODIFIED Requirements

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

### Requirement: Send record

Every send attempt that reaches the mail server SHALL be recorded with its trigger (`auto` or `manual`), recipients, members not reached, who sent it, when, and whether it succeeded with its error. When the server accepts the mail for some recipients but refuses others, the send SHALL be recorded as failed with the refused addresses in its error. The minutes page SHALL show the latest record.

#### Scenario: The latest send is shown

- **WHEN** bob sends the minutes by hand after an earlier automatic send
- **THEN** the minutes API reports bob's manual send as the latest, with its time and recipient count

#### Scenario: Some recipients refused

- **WHEN** the server refuses carol@corp.example but accepts the other recipients
- **THEN** the send responds 502, is recorded as failed, and its error names carol@corp.example
