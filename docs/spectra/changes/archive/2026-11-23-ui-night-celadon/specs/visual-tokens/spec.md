## ADDED Requirements

### Requirement: Night and celadon palettes

`webapp/static/tokens.css` SHALL give the dark theme the night palette and the light theme the celadon palette with exactly the colour values in the example table, keeping the existing token names so every page takes the new colours. It SHALL also define `--live` and `--live-text` in both themes, and `--font-ui` and `--font-mono` with the same value in both themes. `--live` SHALL be used only to mark a session that is recording or a sound level (the live bar's wave and level, the live status dot, the audio test meter while testing, and the subtitle colour of current speech); text in the recording colour SHALL use `--live-text`. `body` SHALL use `--font-ui` on every page, and no stylesheet SHALL load a web font.

#### Scenario: Token values in both themes

- **WHEN** any signed-in page and the sign-in page are opened with `data-theme` set to `dark` and then to `light`
- **THEN** `getComputedStyle(document.documentElement)` returns the values of the example table for each token, and `--font-ui` is the same in both themes

##### Example: palette values

| Token | dark (night) | light (celadon) |
| ----- | ------------ | --------------- |
| `--page` | `#111214` | `#f2f5f3` |
| `--panel` | `#17181b` | `#ffffff` |
| `--field` | `#1f2024` | `#ffffff` |
| `--border` | `#2a2b30` | `#dce4df` |
| `--text` | `#ecedef` | `#14201b` |
| `--muted` | `#a3a5ac` | `#4b5a53` |
| `--faint` | `#80838c` | `#66736d` |
| `--accent` | `#ecedef` | `#2e7a68` |
| `--accent-ink` | `#111214` | `#ffffff` |
| `--live` | `#f2a93b` | `#d98a0b` |
| `--live-text` | `#f2a93b` | `#8a5300` |
| `--danger` | `#f2726b` | `#b3261e` |

#### Scenario: No web font

- **WHEN** the live page is loaded and its network requests are recorded
- **THEN** no request goes to `fonts.googleapis.com` or `fonts.gstatic.com` and no `@font-face` rule is defined

---

### Requirement: Interface without decorative chrome

No page SHALL show a decorative background glow (the `.ambient` elements), an English all-capitals eyebrow label (such as `REAL-TIME MULTILINGUAL MEETING`, `LIVE TRANSCRIPT`, `MEETINGS`, `ACTIONS`, `TEAMS`, `MY RECORDS`, `METRICS`, `SEARCH` or `ASK`), or text styled with `text-transform: uppercase`. Page titles (`h1`, `h2`, `h3`) and the brand name SHALL have a computed `font-weight` of at most 600. The page title of each sub-page SHALL stay as it is.

#### Scenario: Pages after the change

- **WHEN** `/`, `/meetings`, `/interpret`, `/actions`, `/metrics`, `/search`, `/ask`, `/admin` and `/login` are opened at 1440px in both themes
- **THEN** no element has the class `ambient` or `eyebrow`, no visible element has a computed `text-transform` of `uppercase`, no visible text node consists only of 3 or more capital Latin letters and spaces, and every `h1`, `h2`, `h3` and `.brand b` has a computed `font-weight` of at most 600

---

### Requirement: Header links are plain text

The header page links SHALL be plain text links: no border, a transparent background, and the text in `--muted`. The link of the current page SHALL keep `aria-current="page"` and SHALL be marked with the `--field` background and `--text` colour. Hovering a link SHALL change only its colour and background. The links, their order, the widths at which they hide and the avatar menu SHALL stay as the site-navigation requirements state.

#### Scenario: The header on the meetings list

- **WHEN** `/meetings` is opened at 1440px
- **THEN** every header page link has a computed `border-top-width` of `0px`, every link except 會議紀錄 has a transparent background, and 會議紀錄 has `aria-current="page"` and the `--field` background

## REMOVED Requirements

### Requirement: Pages keep their appearance after the token change

**Reason**: This was the transition rule of ui-visual-polish (moving page styles onto radius tokens without a visible change). The night/celadon redesign changes colours, header links and the live page on purpose, so the rule no longer holds.

**Migration**: None. The radius tokens and "Page styles use the radius tokens" stay; "One page width" and "Switching the theme changes only colours" keep the layout stable between themes.
