## ADDED Requirements

### Requirement: Every page shows the same header in the same place

Every signed-in page (the live page and `/meetings`, `/interpret`, `/actions`, `/metrics`, `/search`, `/ask`, `/admin`, `/review`, `/minutes`) SHALL show one header with the brand on the left and, on the right, the links 即時會議, 會議紀錄, 我的紀錄, 待辦看板, 成效指標, 團隊管理 (system administrators only) and 搜尋 in this order, then the account and the theme button. The link of the current page SHALL stay in its place, marked as current (`aria-current="page"` and a distinct style); `/review` and `/minutes` count as 會議紀錄 and `/ask` as 搜尋. No page SHALL add a page-specific button to the header. At the same window width the brand and the theme button SHALL be at the same position on every page (within 1 px), and hovering a header button SHALL NOT move it. On the live page the service status SHALL stand next to the brand, not among the links. The sign-in page SHALL use the same round theme button.

#### Scenario: Moving between pages

- **WHEN** an administrator at 1440 px wide goes from the live page to 會議紀錄 and then to 團隊管理
- **THEN** the header links read 即時會議 會議紀錄 我的紀錄 待辦看板 成效指標 團隊管理 搜尋 on all three pages, the brand and the theme button do not move, and the marked link is 即時會議, then 會議紀錄, then 團隊管理

##### Example: the marked link

| Page | Marked link |
| ---- | ----------- |
| `/` | 即時會議 |
| `/meetings`, `/review?…`, `/minutes?…` | 會議紀錄 |
| `/interpret` | 我的紀錄 |
| `/search`, `/ask` | 搜尋 |
| `/admin` | 團隊管理 |

## MODIFIED Requirements

### Requirement: Hidden header links stay reachable on narrow screens

Whenever the page header hides one of its page links because the window is narrow, the signed-in user's avatar menu SHALL offer it instead. Every page SHALL hide the same links at the same widths: 我的紀錄 (`/interpret`), 成效指標 (`/metrics`) and 團隊管理 (`/admin`) at 900px or less, and every link except 搜尋, together with 登出, at 700px or less. A destination SHALL NOT be offered on its own page, 團隊管理 SHALL NOT be offered to a user who is not an administrator, and the menu SHALL NOT offer a link the header is showing.

#### Scenario: Narrow window menu

- **WHEN** a signed-in user opens the avatar menu in a window of the given width on the given page
- **THEN** the menu offers exactly the page links in the example table

##### Example: menu page links

| Width | Page | User | Menu page links |
| ----- | ---- | ---- | --------------- |
| 500px | `/review?…` | administrator | 即時會議, 我的紀錄, 待辦看板, 成效指標, 團隊管理 |
| 500px | `/actions` | member | 即時會議, 會議紀錄, 我的紀錄, 成效指標 |
| 500px | `/actions` | administrator | 即時會議, 會議紀錄, 我的紀錄, 成效指標, 團隊管理 |
| 850px | `/` | administrator | 我的紀錄, 成效指標, 團隊管理 |
| 1280px | `/actions` | administrator | none |
