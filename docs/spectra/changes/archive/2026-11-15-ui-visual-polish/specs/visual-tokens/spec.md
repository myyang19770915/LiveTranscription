## Purpose

Every page shares one set of shape and spacing values so the product looks like one system in both themes. This capability names those values once in tokens.css and requires page styles to use them instead of their own numbers.

## ADDED Requirements

### Requirement: Shared shape, shadow, spacing and type tokens

`webapp/static/tokens.css` SHALL define, for both the dark and the light theme, these custom properties: corner radii `--radius-small` (6px), `--radius-control` (10px), `--radius-card` (14px), `--radius-feature` (18px), `--radius-frame` (24px) and `--radius-pill` (999px); `--shadow-card`, which SHALL be `none` in the dark theme and a soft shadow no darker than 10% alpha in the light theme; spacing steps `--space-1` to `--space-6` equal to 4, 8, 12, 16, 24 and 32px; and type sizes `--text-page-title`, `--text-section`, `--text-body` and `--text-note`.

#### Scenario: Tokens resolve in both themes

- **WHEN** any signed-in page is opened with `data-theme` set to `dark` and then to `light`
- **THEN** `getComputedStyle(document.documentElement)` returns a non-empty value for every token named above, and `--shadow-card` is `none` only in the dark theme

### Requirement: Page styles use the radius tokens

Every `border-radius` declaration in `webapp/static/*.css` other than `tokens.css` SHALL use one of the radius tokens, a percentage (circles and illustrations that scale with their box), `inherit`, `0`, or a value of 4px or less (thin bars and marks). A rule that rounds only some corners SHALL use the tokens for its rounded corners. Replacing a former value SHALL change it by at most 2px, except pill-shaped controls (former values of 20px or more), which SHALL become `--radius-pill`.

#### Scenario: No stray radius values

- **WHEN** the stylesheets in `webapp/static/` other than `tokens.css` are searched for `border-radius` values
- **THEN** every value is a `var(--radius-…)` token, a percentage, `inherit`, `0`, or at most 4px

##### Example: former values and their tokens

| Former value | Token |
| ------------ | ----- |
| 6px, 7px | `--radius-small` (6px) |
| 8px | `--radius-small` (6px) or `--radius-control` (10px); both are within 2px, the nearer in look to its neighbours |
| 9px, 10px, 11px, 12px | `--radius-control` (10px) |
| 13px, 14px, 15px, 16px | `--radius-card` (14px) |
| 17px to 20px on a card or frame | `--radius-feature` (18px) |
| 22px to 26px on a page frame or dialog | `--radius-frame` (24px) |
| 20px or more on a chip, 99px, 999px | `--radius-pill` |

### Requirement: Pages keep their appearance after the token change

Moving page styles onto the tokens SHALL NOT visibly change any page beyond corner rounding of at most 2px and the light-theme card shadow. Text, colours, control sizes and layout SHALL stay the same.

#### Scenario: Screenshot comparison

- **WHEN** the meeting page, meeting list, review page, actions board, search, Q&A, metrics, admin and login pages are captured at 1280px in both themes and at 500px in the dark theme before and after the change
- **THEN** every pair has the same layout, with element boxes moved by no more than 2px
