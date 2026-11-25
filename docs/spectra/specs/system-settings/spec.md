# system-settings Specification

## Purpose

Settings that apply to the whole system, not to one team, are kept on one administration page so that the team administration page shows only teams.

## Requirements

### Requirement: System settings page

The app SHALL serve the system settings page at `/admin/settings` to system administrators; any other signed-in user SHALL get the 403 page that says the administration pages are open to system administrators only. The page SHALL show 紀錄保存期限 and 即時口譯權限, in this order, as rows of one card: each row SHALL have the name of the setting and its explanation on the left and its controls on the right at widths above 760 px, and the controls below the explanation at 760 px or less. The row 紀錄保存期限 SHALL hold the number of days with 儲存, and the row 即時口譯權限 SHALL hold the granted accounts, each with 移除, and a field to add a 公司帳號. A failed request SHALL be reported on the page. The team administration page (`/admin`) SHALL NOT show these two settings and SHALL NOT request `/api/admin/interpret-access` or `/api/admin/records-retention`. At a width of 390 px the page SHALL NOT scroll sideways.

#### Scenario: A member opens the page

- **WHEN** a signed-in user who is not a system administrator requests `/admin/settings`
- **THEN** the response is 403 and the page reads 管理頁面只開放給系統管理員。

#### Scenario: Both settings in one card

- **WHEN** an administrator opens `/admin/settings` at 1440 px wide
- **THEN** one card holds the rows 紀錄保存期限 and 即時口譯權限 in this order, and in each row the controls start to the right of the name of the setting

#### Scenario: A phone

- **WHEN** the page is opened at 390 px wide
- **THEN** the document is not wider than the window and in each row the controls are below the explanation

#### Scenario: The team administration page shows only teams

- **WHEN** an administrator opens `/admin`
- **THEN** the page has no 即時口譯權限 and no 紀錄保存期限, the first card is 建立新團隊, and neither `/api/admin/interpret-access` nor `/api/admin/records-retention` is requested

<!-- @trace
source: admin-settings-tab
updated: 2026-11-25
code:
  - README.md
  - bench/interpret_e2e.mjs
  - bench/ui_consistency_e2e.mjs
  - bench/usage_admin_e2e.mjs
  - webapp/team_access.py
  - webapp/static/account.js
  - webapp/static/admin.css
  - webapp/static/admin.html
  - webapp/static/settings.html
  - webapp/static/settings.js
  - webapp/static/usage.html
  - webapp/static/actions.html
  - webapp/static/ask.html
  - webapp/static/index.html
  - webapp/static/interpret.html
  - webapp/static/meetings.html
  - webapp/static/metrics.html
  - webapp/static/minutes.html
  - webapp/static/review.html
  - webapp/static/search.html
tests:
  - webapp/test_server.py
-->