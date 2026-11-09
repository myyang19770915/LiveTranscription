## ADDED Requirements

### Requirement: Member e-mail address

At sign-in the system SHALL read the user's e-mail address from the LDAP attribute named by `LDAP_MAIL_ATTR` (default `mail`) and store it as the user's address with source `ldap`. When LDAP has no address and the stored address came from LDAP, the stored address SHALL be cleared; an address the user entered (source `self`) SHALL be kept. A signed-in user whose address does not come from LDAP SHALL be able to set or clear their own address; an address from LDAP SHALL NOT be changeable by the user. `GET /api/me` SHALL report the address and its source.

#### Scenario: Address from the directory

- **WHEN** alice signs in and LDAP has `mail: alice@corp.example`
- **THEN** `GET /api/me` reports email `alice@corp.example` with source `ldap`

#### Scenario: Directory address cannot be changed

- **WHEN** alice, whose address comes from LDAP, saves a different address
- **THEN** the system responds 409 with the message Email 由公司目錄提供，無法修改

#### Scenario: Entering one's own address

- **WHEN** bob, who has no address in LDAP, saves `bob@corp.example`
- **THEN** the address is stored with source `self` and kept on his next sign-in

##### Example: address checks

| Input | Result |
| ----- | ------ |
| " bob@corp.example " | stored as "bob@corp.example" |
| "" | address cleared |
| "bob@corp" | 422 Email 格式不正確 |
| "a b@corp.example" | 422 Email 格式不正確 |
