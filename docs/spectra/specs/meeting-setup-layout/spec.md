# meeting-setup-layout Specification

## Purpose

The meeting page puts the settings people change for each meeting first and folds away the advanced options most meetings leave alone, so the live transcript appears sooner on screen without hiding which advanced options are on.

## Requirements

### Requirement: Advanced settings fold away by default

On the meeting page (`/`) on a window wider than 760px, the 進階 heading SHALL be a button with `aria-expanded` and `aria-controls` that shows or hides the advanced settings it introduces: 辨識引擎, 雲端精修 and 精準模式. On a first visit the group SHALL be folded. The chosen state SHALL be stored in localStorage under `setupAdvancedOpen` and used on later visits; when storage is unavailable the group SHALL start folded. 會議情境 is not an advanced setting and SHALL stay visible. When none of the advanced settings is offered, the heading SHALL stay hidden as before. Folding SHALL NOT change any setting's value or what is sent when a meeting starts.

#### Scenario: First visit

- **WHEN** a user with no stored preference opens `/` on a 1280px window and the server offers at least one advanced setting
- **THEN** the 進階 button shows `aria-expanded="false"`, 辨識引擎, 雲端精修 and 精準模式 are not visible, and 會議情境 is visible

#### Scenario: Unfold and remember

- **WHEN** the user presses 進階 and reloads the page
- **THEN** the advanced settings are visible after the reload and the button shows `aria-expanded="true"`

#### Scenario: Folding keeps the settings

- **WHEN** 精準模式 is checked, the group is folded and a meeting is started
- **THEN** the meeting starts with 精準模式 on, exactly as with the group unfolded


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
### Requirement: Folded heading names the advanced options in use

While folded, the 進階 button SHALL show a short summary of the offered advanced options that differ from their defaults, joined with 、, or 預設 when none differ. The summary SHALL update when a setting changes.

#### Scenario: Summary text

- **WHEN** the group is folded with the given settings
- **THEN** the button's summary reads as in the example table

##### Example: summary

| 辨識引擎 | 雲端精修 | 精準模式 | Summary |
| -------- | -------- | -------- | ------- |
| 本機 | off | off | 預設 |
| 本機 | off | on | 精準模式 |
| 雲端 MAI | on | off | 雲端 MAI、雲端精修 |
| 混合 | off | on | 混合辨識、精準模式 |


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
### Requirement: Narrow screens keep the settings dialog unchanged

At 760px or less the meeting page SHALL show every advanced setting the server offers (辨識引擎, 雲端精修 and 精準模式) unfolded inside the settings dialog, in that order, and the 進階 heading there SHALL NOT act as a fold button. At that width the setup area above the transcript SHALL hold only the language row (語音語言, the swap button and 翻譯成) in a single grid row; no advanced setting SHALL remain in it. Returning to a wider window SHALL put each moved setting back in its original place.

#### Scenario: Phone width

- **WHEN** `/` is opened at 500px and the settings dialog is opened
- **THEN** 辨識引擎 and 雲端精修 appear in the dialog without pressing 進階

#### Scenario: 精準模式 offered on a phone

- **WHEN** `/` is opened at 390px in 即時翻譯 mode while the server offers 精準模式
- **THEN** 語音語言 and 翻譯成 are each at least 120px wide and share one row, 精準模式 is not in the setup area, and the settings dialog shows 精準模式 after 雲端精修

#### Scenario: Back to a wide window

- **WHEN** the page is resized from 390px to 1280px
- **THEN** 精準模式 is back inside the 進階 group next to 雲端精修

<!-- @trace
source: phone-mic-and-layout
updated: 2026-11-15
code:
  - bench/ui_polish_e2e.mjs
  - webapp/static/search.html
  - webapp/static/refine.css
  - docs/ui-review-shots/metrics.jpeg
  - webapp/static/admin.html
  - webapp/static/login.html
  - webapp/static/admin.css
  - webapp/static/actions.css
  - webapp/static/search.js
  - docs/ui-review-shots/actions-board.jpeg
  - webapp/static/accounts.css
  - webapp/static/styles.css
  - webapp/static/evidence-panel.css
  - webapp/static/meetings.html
  - bench/ui_review_e2e.mjs
  - docs/ui-review-shots/404-page.jpeg
  - webapp/static/metrics.html
  - webapp/static/account.js
  - docs/ui-review-shots/search-results.jpeg
  - webapp/static/index.html
  - webapp/static/overlay.css
  - webapp/static/review.css
  - webapp/static/subtitles.css
  - webapp/static/subtitles.js
  - webapp/static/speakers.css
  - webapp/static/actions.html
  - docs/ui-review-shots/qa-answer.jpeg
  - webapp/static/themes.css
  - docs/ui-review-shots/meeting-live.jpeg
  - docs/ui-review-shots/team-management.jpeg
  - docs/ui-review-shots/meetings-list.jpeg
  - bench/README.md
  - webapp/static/app.js
  - webapp/static/ask.css
  - webapp/static/minutes.html
  - chang01.png
  - webapp/static/not-found.html
  - webapp/static/review.html
  - webapp/static/tokens.css
  - webapp/static/search.css
  - webapp/static/series.css
  - webapp/static/ask.html
  - webapp/static/login.css
  - webapp/static/mobile.css
  - docs/ui-design-suggestions-codex.md
  - docs/ui-review-codex.md
  - docs/ui-review-shots/login-dark.jpeg
  - docs/ui-review-shots/mobile-transcript-review.jpeg
  - webapp/static/minutes.css
  - webapp/static/ask.js
  - webapp/static/loading-state.js
  - docs/ui-review-shots/minutes-empty.jpeg
  - webapp/static/metrics.css
tests:
  - webapp/test_server.py
-->