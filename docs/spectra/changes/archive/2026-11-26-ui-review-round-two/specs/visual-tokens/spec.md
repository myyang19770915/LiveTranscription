## MODIFIED Requirements

### Requirement: Header links are plain text

The header page links SHALL be plain text links: no border, a transparent background, and the text in `--muted`. The link of the current page SHALL keep `aria-current="page"` and SHALL be marked with the `--field` background, the `--text` colour and a straight 2px line in `--accent` along its bottom edge, drawn as a background image, so that the current page is not told by colour alone. Hovering a link SHALL change only its colour and background. The links, their order, the widths at which they hide and the avatar menu SHALL stay as the site-navigation requirements state.

#### Scenario: The header on the meetings list

- **WHEN** `/meetings` is opened at 1440px
- **THEN** every header page link has a computed `border-top-width` of `0px`, every link except 會議紀錄 has a transparent background, and 會議紀錄 has `aria-current="page"` and the `--field` background

#### Scenario: The current page carries a line

- **WHEN** `/meetings` is opened at 1440px
- **THEN** the computed `background-image` of 會議紀錄 is a gradient whose `background-size` is 2px high and whose `background-position` is at the bottom, and the other header page links have no `background-image`

## ADDED Requirements

### Requirement: Touch targets on phones are at least 44px tall

In windows 760 px wide or narrower these controls SHALL be at least 44 px tall: in the header the brand link, the 搜尋 link, the avatar button and the theme button (the avatar and theme buttons SHALL also be at least 44 px wide); on `/search` and `/ask` the two links of the 全文搜尋／問答 switch; on `/search` the kind tabs. On a meeting's review page each turn of the speaker timeline SHALL accept taps over an area at least 44 px tall, and the areas of two neighbouring lanes SHALL NOT overlap. The width of a turn follows its duration and is exempt.

#### Scenario: The header on a phone

- **WHEN** `/meetings` is opened at 390 px wide
- **THEN** the brand link, the 搜尋 link, the avatar button and the theme button are each at least 44 px tall, the last two at least 44 px wide, and the document is not wider than the window

#### Scenario: The search switches on a phone

- **WHEN** `/search?q=會議` is opened at 390 px wide
- **THEN** both links of the mode switch and every kind tab are at least 44 px tall

#### Scenario: The speaker timeline on a phone

- **WHEN** the review page of a meeting with speakers is opened at 390 px wide
- **THEN** the tappable area of each turn is at least 44 px tall and the tappable areas of turns in neighbouring lanes do not overlap vertically
