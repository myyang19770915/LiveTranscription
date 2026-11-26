# sign-in-page Specification

## Purpose

The sign-in page tells a visitor what 語橋 Live does and shows the meeting screen before they sign in, in the same visual language as the rest of the product.

## Requirements

### Requirement: The sign-in page says what the product does and shows the meeting screen

The sign-in page SHALL have one `h1`, 會議中即時顯示逐字稿和翻譯, followed by one sentence that names the three supported languages (中文, 日文, 英文) and what happens after a meeting. In windows wider than 760 px the page SHALL show, under that sentence, a preview of the meeting screen built from HTML text: a pane headed 原文 and a pane headed 翻譯, each with the same number of lines, the last translated line marked 暫譯. The preview SHALL be exposed to assistive technology as one image named 開會畫面示意：左邊是原文，右邊是翻譯. In windows 760 px wide or narrower the preview SHALL be hidden and the document SHALL NOT be wider than the window. The page SHALL NOT contain the feature-card diagram, the words Cloud or Local, or a slogan in place of the description.

#### Scenario: A wide window

- **WHEN** `/login` is opened at 1440 px wide
- **THEN** the `h1` reads 會議中即時顯示逐字稿和翻譯, the preview is visible with the panes 原文 and 翻譯 holding three lines each, the last line of 翻譯 carries the label 暫譯, and the page text contains neither Cloud nor Local

#### Scenario: A phone

- **WHEN** `/login` is opened at 390 px wide
- **THEN** the `h1` and the sentence are visible above the form, the preview is not displayed, and the document is not wider than the window


<!-- @trace
source: signin-legibility-focus
updated: 2026-11-26
code:
  - bench/README.md
  - bench/legibility_focus_e2e.mjs
  - bench/login_e2e.mjs
  - webapp/static/actions.css
  - webapp/static/actions.html
  - webapp/static/admin.css
  - webapp/static/admin.html
  - webapp/static/ask.css
  - webapp/static/ask.html
  - webapp/static/evidence-panel.css
  - webapp/static/index.html
  - webapp/static/interpret.html
  - webapp/static/login.css
  - webapp/static/login.html
  - webapp/static/meetings.html
  - webapp/static/metrics.css
  - webapp/static/metrics.html
  - webapp/static/minutes.html
  - webapp/static/mobile.css
  - webapp/static/not-found.html
  - webapp/static/refine.css
  - webapp/static/review.html
  - webapp/static/search.css
  - webapp/static/search.html
  - webapp/static/series.css
  - webapp/static/settings.html
  - webapp/static/styles.css
  - webapp/static/subtitles.js
  - webapp/static/themes.css
  - webapp/static/tokens.css
  - webapp/static/usage.css
  - webapp/static/usage.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: The sign-in form is headed by a second-level heading

The form SHALL be headed by an `h2` that reads 登入, and at every width that `h2` SHALL be set smaller than the `h1`. The label of the submit button SHALL be 登入 with normal letter spacing, and 登入中… while the request is running.

#### Scenario: Heading order and sizes

- **WHEN** `/login` is opened at 1440 px and at 390 px wide
- **THEN** the page has exactly one `h1`, the form's heading is an `h2` reading 登入, and the computed font size of the `h2` is smaller than that of the `h1`

#### Scenario: The submit button

- **WHEN** the page is loaded
- **THEN** the button reads 登入 and its computed `letter-spacing` is `normal` or 0


<!-- @trace
source: signin-legibility-focus
updated: 2026-11-26
code:
  - bench/README.md
  - bench/legibility_focus_e2e.mjs
  - bench/login_e2e.mjs
  - webapp/static/actions.css
  - webapp/static/actions.html
  - webapp/static/admin.css
  - webapp/static/admin.html
  - webapp/static/ask.css
  - webapp/static/ask.html
  - webapp/static/evidence-panel.css
  - webapp/static/index.html
  - webapp/static/interpret.html
  - webapp/static/login.css
  - webapp/static/login.html
  - webapp/static/meetings.html
  - webapp/static/metrics.css
  - webapp/static/metrics.html
  - webapp/static/minutes.html
  - webapp/static/mobile.css
  - webapp/static/not-found.html
  - webapp/static/refine.css
  - webapp/static/review.html
  - webapp/static/search.css
  - webapp/static/search.html
  - webapp/static/series.css
  - webapp/static/settings.html
  - webapp/static/styles.css
  - webapp/static/subtitles.js
  - webapp/static/themes.css
  - webapp/static/tokens.css
  - webapp/static/usage.css
  - webapp/static/usage.html
tests:
  - webapp/test_server.py
-->

---
### Requirement: The sign-in page is calm and uses the shared colours

The sign-in page SHALL take every colour from the tokens of `tokens.css`; its stylesheet SHALL NOT define a colour per feature, a violet, or a blurred glow. No animation SHALL still be running two seconds after the page has loaded, and with `prefers-reduced-motion: reduce` no animation SHALL run at all.

#### Scenario: Nothing keeps moving

- **WHEN** `/login` has been open for two seconds at 1440 px wide
- **THEN** `document.getAnimations()` returns no animation whose play state is running

#### Scenario: Reduced motion

- **WHEN** `/login` is opened with `prefers-reduced-motion: reduce`
- **THEN** `document.getAnimations()` returns no running animation at any moment after load and every part of the page is visible

#### Scenario: No colours of its own

- **WHEN** `webapp/static/login.css` is read
- **THEN** it contains no hexadecimal colour and no `blur(`

<!-- @trace
source: signin-legibility-focus
updated: 2026-11-26
code:
  - bench/README.md
  - bench/legibility_focus_e2e.mjs
  - bench/login_e2e.mjs
  - webapp/static/actions.css
  - webapp/static/actions.html
  - webapp/static/admin.css
  - webapp/static/admin.html
  - webapp/static/ask.css
  - webapp/static/ask.html
  - webapp/static/evidence-panel.css
  - webapp/static/index.html
  - webapp/static/interpret.html
  - webapp/static/login.css
  - webapp/static/login.html
  - webapp/static/meetings.html
  - webapp/static/metrics.css
  - webapp/static/metrics.html
  - webapp/static/minutes.html
  - webapp/static/mobile.css
  - webapp/static/not-found.html
  - webapp/static/refine.css
  - webapp/static/review.html
  - webapp/static/search.css
  - webapp/static/search.html
  - webapp/static/series.css
  - webapp/static/settings.html
  - webapp/static/styles.css
  - webapp/static/subtitles.js
  - webapp/static/themes.css
  - webapp/static/tokens.css
  - webapp/static/usage.css
  - webapp/static/usage.html
tests:
  - webapp/test_server.py
-->