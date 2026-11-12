## ADDED Requirements

### Requirement: Failed sign-ins from one address are limited

Besides the per-username lock, the system SHALL count failed sign-ins (wrong username or password) per client IP address, as seen after the trusted proxy headers. After `LOGIN_IP_MAX_FAILURES` (default 30) failures from one address within 5 minutes, every sign-in from that address SHALL be answered with 429 and the message 嘗試次數過多，請稍後再試 without contacting LDAP, until fewer than that many failures from it remain within the last 5 minutes. Attempts refused because LDAP was unreachable SHALL NOT count, and a successful sign-in SHALL NOT clear the address's count (many people can share one address). The count SHALL be kept in the app's memory.

#### Scenario: Guessing many usernames from one address

- **WHEN** one address fails to sign in 30 times within 5 minutes with 30 different usernames and then tries a correct password
- **THEN** that attempt is answered 429 without contacting LDAP, while sign-ins from another address still work

##### Example: one address

| Failures from the address in the last 5 minutes | Next attempt |
| ----------------------------------------------- | ------------ |
| 29 | checked with LDAP |
| 30 | 429, LDAP not contacted |
| 30, the oldest 6 minutes ago | checked with LDAP |
