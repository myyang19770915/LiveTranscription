# site-navigation Specification

## Purpose

The page header links every signed-in page to the others. On narrow screens the header hides some links to fit, and this capability makes sure every hidden link is still reachable from the avatar menu.

## Requirements

### Requirement: Hidden header links stay reachable on narrow screens

Whenever the page header hides one of its page links because the window is narrow, the signed-in user's avatar menu SHALL offer it instead. Every page SHALL hide the same links at the same widths: 我的紀錄 (`/interpret`), 成效指標 (`/metrics`) and 管理 (`/admin`) at 900px or less, and every link except 搜尋, together with 登出, at 700px or less. A destination SHALL NOT be offered on its own page (管理 counts as the page of `/admin`, `/admin/usage` and `/admin/settings`), 管理 SHALL NOT be offered to a user who is not an administrator, and the menu SHALL NOT offer a link the header is showing.

#### Scenario: Narrow window menu

- **WHEN** a signed-in user opens the avatar menu in a window of the given width on the given page
- **THEN** the menu offers exactly the page links in the example table

##### Example: menu page links

| Width | Page | User | Menu page links |
| ----- | ---- | ---- | --------------- |
| 500px | `/review?…` | administrator | 即時會議, 我的紀錄, 待辦看板, 成效指標, 管理 |
| 500px | `/actions` | member | 即時會議, 會議紀錄, 我的紀錄, 成效指標 |
| 500px | `/actions` | administrator | 即時會議, 會議紀錄, 我的紀錄, 成效指標, 管理 |
| 850px | `/` | administrator | 我的紀錄, 成效指標, 管理 |
| 500px | `/admin/usage` | administrator | 即時會議, 會議紀錄, 我的紀錄, 待辦看板, 成效指標 |
| 1280px | `/actions` | administrator | none |


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

---
### Requirement: Every page shows the same header in the same place

Every signed-in page (the live page and `/meetings`, `/interpret`, `/actions`, `/metrics`, `/search`, `/ask`, `/admin`, `/admin/usage`, `/admin/settings`, `/review`, `/minutes`) SHALL show one header with the brand on the left and, on the right, the links 即時會議, 會議紀錄, 我的紀錄, 待辦看板, 成效指標, 管理 (system administrators only) and 搜尋 in this order, then the account and the theme button. The link of the current page SHALL stay in its place, marked as current (`aria-current="page"` and a distinct style); `/review` and `/minutes` count as 會議紀錄, `/ask` as 搜尋, and `/admin/usage` and `/admin/settings` as 管理. No page SHALL add a page-specific button to the header. At the same window width the brand and the theme button SHALL be at the same position on every page (within 1 px), and hovering a header button SHALL NOT move it. On the live page the service status SHALL stand next to the brand, not among the links. The sign-in page SHALL use the same round theme button.

#### Scenario: Moving between pages

- **WHEN** an administrator at 1440 px wide goes from the live page to 會議紀錄 and then to 管理
- **THEN** the header links read 即時會議 會議紀錄 我的紀錄 待辦看板 成效指標 管理 搜尋 on all three pages, the brand and the theme button do not move, and the marked link is 即時會議, then 會議紀錄, then 管理

##### Example: the marked link

| Page | Marked link |
| ---- | ----------- |
| `/` | 即時會議 |
| `/meetings`, `/review?…`, `/minutes?…` | 會議紀錄 |
| `/interpret` | 我的紀錄 |
| `/search`, `/ask` | 搜尋 |
| `/admin`, `/admin/usage`, `/admin/settings` | 管理 |


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

---
### Requirement: The avatar menu works from the keyboard

The header avatar menu (`.account-menu`, `role="menu"`) SHALL open as a popover (`popover="auto"`) directly below the avatar with its right edge aligned to the avatar. On opening, the focus SHALL move to the first visible menu item. The down and up arrows SHALL move the focus to the next and previous visible item, wrapping at either end; Home and End SHALL move it to the first and last visible item. Escape or Tab SHALL close the menu and return the focus to the avatar, and a click outside the menu SHALL close it. Pressing the avatar while the menu is open SHALL close it without reopening it. Pressing the down arrow on the avatar SHALL open the menu with the focus on the first visible item, and pressing the up arrow SHALL open it with the focus on the last. Items hidden at the current width SHALL be skipped. The items, their order and the widths at which they show SHALL stay as "Hidden header links stay reachable on narrow screens" states.

#### Scenario: Opening with the mouse

- **WHEN** a signed-in user clicks the avatar on `/meetings` at 1440px
- **THEN** `.account-menu` matches `:popover-open`, its top is below the avatar's bottom edge, and the focus is on the first visible `[role=menuitem]`

#### Scenario: Moving through the items

- **WHEN** the avatar menu is open and the user presses End, then the down arrow, then Escape
- **THEN** End focuses the last visible item, the down arrow wraps the focus to the first visible item, and Escape closes the menu with the focus on the avatar

#### Scenario: Items for a narrow window

- **WHEN** the avatar menu is opened on `/meetings` at 900px and the user presses the down arrow through every item
- **THEN** the focus visits the page links shown in the menu at that width and never an item hidden at that width

#### Scenario: Pressing the avatar again

- **WHEN** the avatar menu is open and the user clicks the avatar
- **THEN** the menu is closed and stays closed

<!-- @trace
source: web-platform-polish
updated: 2026-11-24
code:
  - webapp/static/account.js
  - webapp/static/topbar.css
  - webapp/static/actions.html
  - webapp/static/admin.html
  - webapp/static/ask.html
  - webapp/static/index.html
  - webapp/static/interpret.html
  - webapp/static/login.html
  - webapp/static/meetings.html
  - webapp/static/metrics.html
  - webapp/static/minutes.html
  - webapp/static/review.html
  - webapp/static/search.html
tests:
  - bench/web_platform_polish_e2e.mjs
-->

---
### Requirement: The administration pages share section tabs

The team administration page (`/admin`), the usage management page (`/admin/usage`) and the system settings page (`/admin/settings`) SHALL each show, above the page title, one navigation labelled 管理 with the links 團隊管理 (`/admin`), 用量管理 (`/admin/usage`) and 系統設定 (`/admin/settings`) in this order. The link of the page being shown SHALL be marked with `aria-current="page"` and a distinct style that does not rely on colour alone; the others SHALL be ordinary links. The three links SHALL be at the same position on all three pages (within 1 px) at the same window width, and each SHALL be at least 44 px high.

#### Scenario: Switching between the pages

- **WHEN** an administrator on `/admin` presses 用量管理, then 系統設定 and then 團隊管理
- **THEN** the address is `/admin/usage`, then `/admin/settings` and then `/admin`, the marked tab is 用量管理, then 系統設定 and then 團隊管理, and the tabs do not move

#### Scenario: The tabs from the keyboard

- **WHEN** an administrator moves the focus with Tab on `/admin/usage`
- **THEN** all three tabs receive a visible focus and Enter on 團隊管理 opens `/admin`

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