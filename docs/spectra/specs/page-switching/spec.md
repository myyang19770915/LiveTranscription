# page-switching Specification

## Purpose

Switching between the site's pages through the header feels immediate: the header is drawn at once, a page's data does not queue behind the account request, and supporting browsers prepare the next page while the pointer rests on its link.

## Requirements

### Requirement: The header is drawn without waiting for the server

After the user has opened any signed-in page in a browser tab, every later page opened in that tab SHALL show the header links (with the current page marked) in its first rendering, using the account remembered in that tab's session storage, and SHALL update the header when `/api/me` answers with a different account. The remembered account SHALL be removed when `/api/me` answers 401 and when the user signs out. When session storage is unavailable or holds an unreadable value, the page SHALL draw the header after `/api/me` answers, as before. The remembered account SHALL NOT be used to grant access; the server checks every request.

#### Scenario: Moving to the board

- **WHEN** a signed-in user on 會議紀錄 clicks 待辦看板 with a 100 ms network delay
- **THEN** 待辦看板's first rendering already shows the header links with 待辦看板 marked

#### Scenario: Signing out

- **WHEN** the user signs out and then opens a page in the same tab
- **THEN** no remembered account is used and the page goes to the sign-in page


<!-- @trace
source: faster-page-switching
updated: 2026-11-18
code:
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/series.js
  - webapp/static/index.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/search.html
  - bench/page_switching_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/ask.js
  - webapp/static/actions.html
  - webapp/static/actions.js
  - webapp/static/account.js
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/metrics.js
  - webapp/static/review.html
  - lab/realtime-translate/index.html
  - webapp/static/meetings.html
  - webapp/static/ask.html
  - webapp/static/interpret.js
  - lab/realtime-translate/costs.jsonl
  - webapp/static/admin.html
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/interpret.html
  - webapp/static/search.js
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/server.py
  - webapp/static/minutes.html
  - webapp/static/metrics.html
  - 螢幕擷取畫面 2026-11-17 225637.png
-->

---
### Requirement: A page's data does not wait for the account

The data requests of 成效指標, 待辦看板, 搜尋, 問答 and the live page SHALL start without waiting for `/api/me` when the tab remembers the account (成效指標 always), and the live page SHALL request `/api/config` once per load.

#### Scenario: Opening 成效指標

- **WHEN** 成效指標 is opened with a 100 ms network delay
- **THEN** `/api/metrics` is requested before `/api/me` has answered

##### Example: requests on the live page

| Request | Times per load |
| ------- | -------------- |
| `/api/config` | 1 |
| `/api/me` | 1 |


<!-- @trace
source: faster-page-switching
updated: 2026-11-18
code:
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/series.js
  - webapp/static/index.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/search.html
  - bench/page_switching_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/ask.js
  - webapp/static/actions.html
  - webapp/static/actions.js
  - webapp/static/account.js
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/metrics.js
  - webapp/static/review.html
  - lab/realtime-translate/index.html
  - webapp/static/meetings.html
  - webapp/static/ask.html
  - webapp/static/interpret.js
  - lab/realtime-translate/costs.jsonl
  - webapp/static/admin.html
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/interpret.html
  - webapp/static/search.js
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/server.py
  - webapp/static/minutes.html
  - webapp/static/metrics.html
  - 螢幕擷取畫面 2026-11-17 225637.png
-->

---
### Requirement: The next page is prepared while the pointer rests on its link

In browsers that support speculation rules, the header SHALL ask the browser to prerender the page of a header link (not the current page) when the pointer rests on it (`eagerness: "moderate"`), so that clicking it shows a page that was already prepared. Browsers without support SHALL load the page as before. Prerendering SHALL only issue requests a normal visit issues on load. A prepared page SHALL fetch its data again when it is shown (會議紀錄, 我的紀錄, 待辦看板, 成效指標, 團隊管理), so a change made on another page in the meantime is shown.

#### Scenario: Hovering then clicking 成效指標

- **WHEN** in Edge or Chrome the pointer rests on 成效指標 for half a second
- **THEN** the browser requests `/metrics` with `Sec-Purpose: prefetch;prerender`, and never the current page; a click then shows the prepared page (not observable under automation: browsers driven through DevTools do not show prepared pages)

#### Scenario: A change made while a page is prepared

- **WHEN** 成效指標 was prepared while the pointer rested on it, the user then marks an item done on 待辦看板, and clicks 成效指標
- **THEN** 成效指標 requests `/api/metrics` again when shown and shows the numbers after the change

<!-- @trace
source: faster-page-switching
updated: 2026-11-18
code:
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/static/series.js
  - webapp/static/index.html
  - gpt-realtime-translate_demoUI.png
  - webapp/static/search.html
  - bench/page_switching_e2e.mjs
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - webapp/static/ask.js
  - webapp/static/actions.html
  - webapp/static/actions.js
  - webapp/static/account.js
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/static/metrics.js
  - webapp/static/review.html
  - lab/realtime-translate/index.html
  - webapp/static/meetings.html
  - webapp/static/ask.html
  - webapp/static/interpret.js
  - lab/realtime-translate/costs.jsonl
  - webapp/static/admin.html
  - webapp/static/app.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/interpret.html
  - webapp/static/search.js
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/server.py
  - webapp/static/minutes.html
  - webapp/static/metrics.html
  - 螢幕擷取畫面 2026-11-17 225637.png
-->