## MODIFIED Requirements

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

### Requirement: The administration pages share section tabs

The team administration page (`/admin`), the usage management page (`/admin/usage`) and the system settings page (`/admin/settings`) SHALL each show, above the page title, one navigation labelled 管理 with the links 團隊管理 (`/admin`), 用量管理 (`/admin/usage`) and 系統設定 (`/admin/settings`) in this order. The link of the page being shown SHALL be marked with `aria-current="page"` and a distinct style that does not rely on colour alone; the others SHALL be ordinary links. The three links SHALL be at the same position on all three pages (within 1 px) at the same window width, and each SHALL be at least 44 px high.

#### Scenario: Switching between the pages

- **WHEN** an administrator on `/admin` presses 用量管理, then 系統設定 and then 團隊管理
- **THEN** the address is `/admin/usage`, then `/admin/settings` and then `/admin`, the marked tab is 用量管理, then 系統設定 and then 團隊管理, and the tabs do not move

#### Scenario: The tabs from the keyboard

- **WHEN** an administrator moves the focus with Tab on `/admin/usage`
- **THEN** all three tabs receive a visible focus and Enter on 團隊管理 opens `/admin`
