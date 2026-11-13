## Purpose

A meeting is read on a screen for a long time without touching the device, so the live page keeps the screen awake while a session runs. This capability covers when the page holds and releases that request.

## ADDED Requirements

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
