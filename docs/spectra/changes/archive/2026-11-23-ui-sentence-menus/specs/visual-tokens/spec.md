## ADDED Requirements

### Requirement: The header gives the brand room

On every page with the shared header, on a window wider than 700px, the brand mark (`.topbar .brand-mark`) SHALL be 48px square, the brand name (`.topbar .brand b`) SHALL be 20px, and the page links, the account name and the sign-out button SHALL use 40px-high targets with 16px text from 1024px up and 15px text from 701px to 1023px, where all seven links still show; the service status, the theme button and the avatar SHALL be 40px high. At 700px or less the header SHALL keep its earlier sizes. The links, their order, the widths at which they hide and the avatar menu SHALL stay as the site-navigation requirements state, and no page SHALL scroll sideways at any width from 901px to 1440px.

#### Scenario: The header at 1440px

- **WHEN** `/meetings` is opened at 1440px
- **THEN** `.topbar .brand-mark` is 48px wide, `.topbar .brand b` has a computed font size of 20px, and every `#account > a` has a computed font size of 16px and a height of 40px

#### Scenario: Narrower windows

- **WHEN** `/` is opened at 960px and at 1101px
- **THEN** the page has no horizontal scroll

#### Scenario: A phone

- **WHEN** `/` is opened at 390px
- **THEN** `.topbar .brand-mark` is as wide as before this change
