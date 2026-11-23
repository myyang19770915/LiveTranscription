## ADDED Requirements

### Requirement: List pages carry no lead paragraph

The meeting list (`/meetings`) and 我的紀錄 (`/interpret`) SHALL NOT show an explanatory paragraph under the page title. The team administration page (`/admin`) SHALL keep its paragraph, which states who can see which meetings.

#### Scenario: Page headers

- **WHEN** `/meetings`, `/interpret` and `/admin` are opened at 1440px
- **THEN** `/meetings` and `/interpret` have no visible `p.lead`, and `/admin` has one
