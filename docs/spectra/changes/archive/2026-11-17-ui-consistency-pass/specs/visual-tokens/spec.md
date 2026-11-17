## ADDED Requirements

### Requirement: One page width

`tokens.css` SHALL define `--page-width` (1280px) and `--page-gutter` (24px, 16px at most 700px wide). The header SHALL keep its content within `--page-width` with at least `--page-gutter` on each side, and the content of every page SHALL use the same width and gutter, so the left edge of the content lines up with the brand on every page.

#### Scenario: Content edges line up

- **WHEN** the window is 1440 px wide
- **THEN** on the live page and on `/meetings`, `/interpret`, `/actions`, `/metrics`, `/search`, `/ask` and `/admin` the brand's left edge and the content's left edge are both at 80 px

### Requirement: Switching the theme changes only colours

Switching between the dark and the light theme SHALL NOT change the size or position of any page element: on the same page and window width, `main`, the header, the brand and the theme button SHALL have the same bounding boxes in both themes.

#### Scenario: The live page in both themes

- **WHEN** the live page at 1440 px wide is switched from dark to light
- **THEN** `main` keeps its width and left edge, and the header does not move

### Requirement: No sideways scrolling on narrow screens

At 390 px wide no signed-in page and not the sign-in page SHALL scroll sideways (`document.documentElement.scrollWidth` at most the window width), and every field with its label SHALL stay inside its card.

#### Scenario: Team administration on a phone

- **WHEN** an administrator opens `/admin` at 390 px wide
- **THEN** the page does not scroll sideways and 紀錄保存期限 shows 保存, the number field and 天 inside the card
