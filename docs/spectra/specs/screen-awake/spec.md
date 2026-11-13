# screen-awake Specification

## Purpose

A meeting is read on a screen for a long time without touching the device, so the live page keeps the screen awake while a session runs. This capability covers when the page holds and releases that request.

## Requirements

### Requirement: The screen stays awake during a session

While a meeting or a live translation session is running, the live page SHALL hold a screen wake lock when the browser supports the Screen Wake Lock API, and SHALL release it when the session ends. When the page becomes visible again while a session is running and the lock is no longer held, the page SHALL request it again. When the browser does not support the API or refuses the request, the page SHALL continue without showing an error.

#### Scenario: Session starts and ends

- **WHEN** a user starts a meeting and later ends it
- **THEN** a wake lock is requested at the start and released at the end

#### Scenario: Returning to the tab

- **WHEN** the browser released the lock because the tab was hidden, and the user returns to the tab while the meeting is still running
- **THEN** the page requests the wake lock again

#### Scenario: Returning after the session ended

- **WHEN** the user returns to the tab after the session has ended
- **THEN** no wake lock is requested

#### Scenario: Unsupported or refused

- **WHEN** the browser has no Screen Wake Lock API, or the request is rejected
- **THEN** the session starts and runs as usual and no error is shown

<!-- @trace
source: wake-lock
updated: 2026-11-13
code:
  - webapp/static/login.html
  - webapp/static/wake-lock.js
  - webapp/static/quality-view.js
  - bench/wakelockcheck.js
  - webapp/static/minutes.html
  - webapp/quality_pass.py
  - webapp/static/search.html
  - webapp/static/not-found.html
  - bench/qualitycheck.js
  - webapp/static/admin.html
  - compose.yaml
  - webapp/static/meetings.html
  - webapp/static/index.html
  - webapp/auth.py
  - webapp/static/metrics.html
  - bench/privacycheck.js
  - bench/returnpathcheck.js
  - webapp/static/account.js
  - webapp/server.py
  - webapp/response_headers.py
  - webapp/static/app.js
  - webapp/static/refine.css
  - webapp/static/return-path.js
  - README.md
  - webapp/static/review.html
  - webapp/static/actions.html
  - webapp/static/ask.html
  - webapp/static/privacy-note.js
tests:
  - webapp/test_server.py
-->