# visual-tokens Specification

## Purpose

Every page shares one set of shape and spacing values so the product looks like one system in both themes. This capability names those values once in tokens.css and requires page styles to use them instead of their own numbers.

## Requirements

### Requirement: Shared shape, shadow, spacing and type tokens

`webapp/static/tokens.css` SHALL define, for both the dark and the light theme, these custom properties: corner radii `--radius-small` (6px), `--radius-control` (10px), `--radius-card` (14px), `--radius-feature` (18px), `--radius-frame` (24px) and `--radius-pill` (999px); `--shadow-card`, which SHALL be `none` in the dark theme and a soft shadow no darker than 10% alpha in the light theme; spacing steps `--space-1` to `--space-6` equal to 4, 8, 12, 16, 24 and 32px; and type sizes `--text-page-title`, `--text-section`, `--text-body` and `--text-note`.

#### Scenario: Tokens resolve in both themes

- **WHEN** any signed-in page is opened with `data-theme` set to `dark` and then to `light`
- **THEN** `getComputedStyle(document.documentElement)` returns a non-empty value for every token named above, and `--shadow-card` is `none` only in the dark theme


<!-- @trace
source: ui-visual-polish
updated: 2026-11-15
code:
  - webapp/static/accounts.css
  - docs/ui-review-shots/mobile-transcript-review.jpeg
  - webapp/static/overlay.css
  - webapp/static/subtitles.css
  - chang01.png
  - webapp/static/minutes.css
  - webapp/static/styles.css
  - webapp/static/minutes.html
  - docs/ui-review-shots/minutes-empty.jpeg
  - webapp/static/mobile.css
  - docs/ui-review-shots/login-dark.jpeg
  - bench/ui_polish_e2e.mjs
  - webapp/static/ask.css
  - webapp/static/metrics.css
  - docs/ui-review-shots/qa-answer.jpeg
  - webapp/static/refine.css
  - webapp/static/speakers.css
  - webapp/static/subtitles.js
  - webapp/static/themes.css
  - webapp/static/tokens.css
  - webapp/static/review.css
  - webapp/static/loading-state.js
  - docs/ui-design-suggestions-codex.md
  - bench/ui_review_e2e.mjs
  - docs/ui-review-shots/404-page.jpeg
  - docs/ui-review-shots/meeting-live.jpeg
  - bench/README.md
  - webapp/static/series.css
  - docs/ui-review-shots/metrics.jpeg
  - docs/ui-review-codex.md
  - webapp/static/actions.css
  - webapp/static/search.css
  - webapp/static/search.js
  - docs/ui-review-shots/search-results.jpeg
  - webapp/static/evidence-panel.css
  - webapp/static/not-found.html
  - docs/ui-review-shots/meetings-list.jpeg
  - webapp/static/index.html
  - docs/ui-review-shots/team-management.jpeg
  - webapp/static/login.html
  - webapp/static/metrics.html
  - webapp/static/admin.css
  - docs/ui-review-shots/actions-board.jpeg
  - webapp/static/admin.html
  - webapp/static/ask.js
  - webapp/static/login.css
  - webapp/static/account.js
  - webapp/static/meetings.html
  - webapp/static/review.html
  - webapp/static/ask.html
  - webapp/static/actions.html
  - webapp/static/app.js
  - webapp/static/search.html
tests:
  - webapp/test_server.py
-->

---
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


<!-- @trace
source: ui-visual-polish
updated: 2026-11-15
code:
  - webapp/static/accounts.css
  - docs/ui-review-shots/mobile-transcript-review.jpeg
  - webapp/static/overlay.css
  - webapp/static/subtitles.css
  - chang01.png
  - webapp/static/minutes.css
  - webapp/static/styles.css
  - webapp/static/minutes.html
  - docs/ui-review-shots/minutes-empty.jpeg
  - webapp/static/mobile.css
  - docs/ui-review-shots/login-dark.jpeg
  - bench/ui_polish_e2e.mjs
  - webapp/static/ask.css
  - webapp/static/metrics.css
  - docs/ui-review-shots/qa-answer.jpeg
  - webapp/static/refine.css
  - webapp/static/speakers.css
  - webapp/static/subtitles.js
  - webapp/static/themes.css
  - webapp/static/tokens.css
  - webapp/static/review.css
  - webapp/static/loading-state.js
  - docs/ui-design-suggestions-codex.md
  - bench/ui_review_e2e.mjs
  - docs/ui-review-shots/404-page.jpeg
  - docs/ui-review-shots/meeting-live.jpeg
  - bench/README.md
  - webapp/static/series.css
  - docs/ui-review-shots/metrics.jpeg
  - docs/ui-review-codex.md
  - webapp/static/actions.css
  - webapp/static/search.css
  - webapp/static/search.js
  - docs/ui-review-shots/search-results.jpeg
  - webapp/static/evidence-panel.css
  - webapp/static/not-found.html
  - docs/ui-review-shots/meetings-list.jpeg
  - webapp/static/index.html
  - docs/ui-review-shots/team-management.jpeg
  - webapp/static/login.html
  - webapp/static/metrics.html
  - webapp/static/admin.css
  - docs/ui-review-shots/actions-board.jpeg
  - webapp/static/admin.html
  - webapp/static/ask.js
  - webapp/static/login.css
  - webapp/static/account.js
  - webapp/static/meetings.html
  - webapp/static/review.html
  - webapp/static/ask.html
  - webapp/static/actions.html
  - webapp/static/app.js
  - webapp/static/search.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: One page width

`tokens.css` SHALL define `--page-width` (1280px) and `--page-gutter` (24px, 16px at most 700px wide). The header SHALL keep its content within `--page-width` with at least `--page-gutter` on each side, and the content of every page SHALL use the same width and gutter, so the left edge of the content lines up with the brand on every page.

#### Scenario: Content edges line up

- **WHEN** the window is 1440 px wide
- **THEN** on the live page and on `/meetings`, `/interpret`, `/actions`, `/metrics`, `/search`, `/ask` and `/admin` the brand's left edge and the content's left edge are both at 80 px


<!-- @trace
source: ui-consistency-pass
updated: 2026-11-17
code:
  - bench/ui_consistency_e2e.mjs
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.html
  - webapp/static/metrics.html
  - chang01.png
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/actions.css
  - webapp/static/ask.html
  - webapp/static/search.html
  - webapp/static/interpret-mode.js
  - bench/translate_e2e.mjs
  - webapp/static/admin.html
  - webapp/static/tokens.css
  - webapp/server.py
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/server.py
  - webapp/static/ask.css
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - bench/metrics_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/index.html
  - bench/ui_review_e2e.mjs
  - webapp/static/accounts.css
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/interpret_usage.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/account.js
  - webapp/static/interpret.css
  - webapp/static/search.css
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/admin.css
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/app.js
  - webapp/static/metrics.css
  - webapp/static/topbar.css
  - webapp/static/meetings.html
  - webapp/static/login.html
  - webapp/static/refine.css
  - bench/actions_e2e.mjs
  - webapp/static/not-found.html
  - webapp/records_retention.py
  - webapp/static/index.html
  - webapp/static/interpret-langs.js
  - webapp/static/review.css
  - webapp/interpret.py
  - webapp/static/mobile.css
  - webapp/static/review.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/themes.css
  - README.md
  - bench/interpret_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/static/interpret.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Switching the theme changes only colours

Switching between the dark and the light theme SHALL NOT change the size or position of any page element: on the same page and window width, `main`, the header, the brand and the theme button SHALL have the same bounding boxes in both themes.

#### Scenario: The live page in both themes

- **WHEN** the live page at 1440 px wide is switched from dark to light
- **THEN** `main` keeps its width and left edge, and the header does not move


<!-- @trace
source: ui-consistency-pass
updated: 2026-11-17
code:
  - bench/ui_consistency_e2e.mjs
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.html
  - webapp/static/metrics.html
  - chang01.png
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/actions.css
  - webapp/static/ask.html
  - webapp/static/search.html
  - webapp/static/interpret-mode.js
  - bench/translate_e2e.mjs
  - webapp/static/admin.html
  - webapp/static/tokens.css
  - webapp/server.py
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/server.py
  - webapp/static/ask.css
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - bench/metrics_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/index.html
  - bench/ui_review_e2e.mjs
  - webapp/static/accounts.css
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/interpret_usage.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/account.js
  - webapp/static/interpret.css
  - webapp/static/search.css
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/admin.css
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/app.js
  - webapp/static/metrics.css
  - webapp/static/topbar.css
  - webapp/static/meetings.html
  - webapp/static/login.html
  - webapp/static/refine.css
  - bench/actions_e2e.mjs
  - webapp/static/not-found.html
  - webapp/records_retention.py
  - webapp/static/index.html
  - webapp/static/interpret-langs.js
  - webapp/static/review.css
  - webapp/interpret.py
  - webapp/static/mobile.css
  - webapp/static/review.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/themes.css
  - README.md
  - bench/interpret_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/static/interpret.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: No sideways scrolling on narrow screens

At 390 px wide no signed-in page and not the sign-in page SHALL scroll sideways (`document.documentElement.scrollWidth` at most the window width), and every field with its label SHALL stay inside its card.

#### Scenario: Team administration on a phone

- **WHEN** an administrator opens `/admin` at 390 px wide
- **THEN** the page does not scroll sideways and 紀錄保存期限 shows 保存, the number field and 天 inside the card

<!-- @trace
source: ui-consistency-pass
updated: 2026-11-17
code:
  - bench/ui_consistency_e2e.mjs
  - lab/realtime-translate/costs.jsonl
  - webapp/static/interpret.html
  - webapp/static/metrics.html
  - chang01.png
  - webapp/migrations/020_interpret_access.sql
  - webapp/static/actions.css
  - webapp/static/ask.html
  - webapp/static/search.html
  - webapp/static/interpret-mode.js
  - bench/translate_e2e.mjs
  - webapp/static/admin.html
  - webapp/static/tokens.css
  - webapp/server.py
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/server.py
  - webapp/static/ask.css
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - bench/metrics_e2e.mjs
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/index.html
  - bench/ui_review_e2e.mjs
  - webapp/static/accounts.css
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/static/minutes.html
  - webapp/static/actions.html
  - webapp/interpret_usage.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/account.js
  - webapp/static/interpret.css
  - webapp/static/search.css
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/admin.css
  - bench/privacy_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/app.js
  - webapp/static/metrics.css
  - webapp/static/topbar.css
  - webapp/static/meetings.html
  - webapp/static/login.html
  - webapp/static/refine.css
  - bench/actions_e2e.mjs
  - webapp/static/not-found.html
  - webapp/records_retention.py
  - webapp/static/index.html
  - webapp/static/interpret-langs.js
  - webapp/static/review.css
  - webapp/interpret.py
  - webapp/static/mobile.css
  - webapp/static/review.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/themes.css
  - README.md
  - bench/interpret_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/static/interpret.js
tests:
  - webapp/test_server.py
-->

---
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


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: Interface without decorative chrome

No page SHALL show a decorative background glow (the `.ambient` elements), an English all-capitals eyebrow label (such as `REAL-TIME MULTILINGUAL MEETING`, `LIVE TRANSCRIPT`, `MEETINGS`, `ACTIONS`, `TEAMS`, `MY RECORDS`, `METRICS`, `SEARCH` or `ASK`), or text styled with `text-transform: uppercase`. Page titles (`h1`, `h2`, `h3`) and the brand name SHALL have a computed `font-weight` of at most 600. The page title of each sub-page SHALL stay as it is.

#### Scenario: Pages after the change

- **WHEN** `/`, `/meetings`, `/interpret`, `/actions`, `/metrics`, `/search`, `/ask`, `/admin` and `/login` are opened at 1440px in both themes
- **THEN** no element has the class `ambient` or `eyebrow`, no visible element has a computed `text-transform` of `uppercase`, no visible text node consists only of 3 or more capital Latin letters and spaces, and every `h1`, `h2`, `h3` and `.brand b` has a computed `font-weight` of at most 600


<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: Header links are plain text

The header page links SHALL be plain text links: no border, a transparent background, and the text in `--muted`. The link of the current page SHALL keep `aria-current="page"` and SHALL be marked with the `--field` background and `--text` colour. Hovering a link SHALL change only its colour and background. The links, their order, the widths at which they hide and the avatar menu SHALL stay as the site-navigation requirements state.

#### Scenario: The header on the meetings list

- **WHEN** `/meetings` is opened at 1440px
- **THEN** every header page link has a computed `border-top-width` of `0px`, every link except 會議紀錄 has a transparent background, and 會議紀錄 has `aria-current="page"` and the `--field` background

<!-- @trace
source: ui-night-celadon
updated: 2026-11-23
code:
  - webapp/static/subtitles.css
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/overlay.css
  - gpt-realtime-translate_demoUI.png
  - webapp/static/tokens.css
  - webapp/static/refine.css
  - 20261122_215017.mp4
  - webapp/static/series.css
  - webapp/static/setup-sentence.js
  - webapp/static/metrics.html
  - webapp/static/review.css
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/admin.css
  - 20261122_211227.mp4
  - lab/realtime-translate/index.html
  - webapp/static/review.html
  - webapp/static/login.css
  - webapp/revise_pass.py
  - webapp/static/not-found.html
  - webapp/static/topbar.css
  - webapp/static/search.html
  - bench/ui_consistency_e2e.mjs
  - webapp/static/login.html
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/actions.css
  - webapp/static/minutes.html
  - webapp/static/themes.css
  - webapp/static/styles.css
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/app.js
  - bench/translate_e2e.mjs
  - webapp/static/meetings.html
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/speakers.css
  - webapp/static/ask.html
  - webapp/static/subtitles.js
  - bench/ui_night_celadon_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/server.py
  - webapp/static/mobile.css
  - bench/ui_polish_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/server.py
  - webapp/static/interpret.html
  - chang01.png
tests:
  - webapp/test_server.py
-->

---
### Requirement: List pages carry no lead paragraph

The meeting list (`/meetings`) and 我的紀錄 (`/interpret`) SHALL NOT show an explanatory paragraph under the page title. The team administration page (`/admin`) SHALL keep its paragraph, which states who can see which meetings.

#### Scenario: Page headers

- **WHEN** `/meetings`, `/interpret` and `/admin` are opened at 1440px
- **THEN** `/meetings` and `/interpret` have no visible `p.lead`, and `/admin` has one

<!-- @trace
source: ui-setup-collapse
updated: 2026-11-23
code:
  - webapp/static/admin.css
  - webapp/static/review.html
  - bench/audio_test_e2e.mjs
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - webapp/static/actions.html
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - webapp/static/meetings.html
  - webapp/static/minutes.html
  - bench/ui_polish_e2e.mjs
  - webapp/revise_pass.py
  - webapp/static/search.html
  - webapp/static/ask.html
  - bench/ui_consistency_e2e.mjs
  - bench/meeting_end_e2e.mjs
  - 螢幕擷取畫面 2026-11-17 225637.png
  - bench/interpret_e2e.mjs
  - 螢幕擷取畫面 2026-11-23 214336.png
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/interpret.html
  - 20261122_215017.mp4
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/index.html
  - webapp/static/admin.html
  - webapp/static/index.html
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/mobile.css
  - bench/ui_night_celadon_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - 20261122_211227.mp4
  - lab/realtime-translate/server.py
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/metrics.html
  - webapp/static/refine.css
  - webapp/server.py
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - chang01.png
  - gpt-realtime-translate_demoUI.png
  - bench/ui_setup_collapse_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/input.wav
tests:
  - webapp/test_server.py
-->