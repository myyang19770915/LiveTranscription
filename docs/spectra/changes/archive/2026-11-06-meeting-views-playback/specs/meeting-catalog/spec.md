## MODIFIED Requirements

### Requirement: Returning from the review page

The review page and the minutes page of a meeting SHALL offer a link 返回會議紀錄 back to the meeting list. When the user entered the meeting from the list, the link SHALL lead to that list with the filters it had, however many times the user switched between the two pages; when the entry right before the current one is that list and the browser supports it, the link SHALL return the way the browser's back button does. Otherwise it SHALL open the meeting list.

#### Scenario: Opened from the list

- **WHEN** a reviewer opens a meeting from the list and presses 返回會議紀錄
- **THEN** the meeting list is shown again

#### Scenario: Returning after switching tabs

- **WHEN** a user opens a meeting from the list filtered to team 研發部, switches to 會議紀要, back to 逐字稿校對, and presses 返回會議紀錄
- **THEN** the meeting list filtered to team 研發部 is shown

#### Scenario: Opened from a direct link

- **WHEN** a user opens a meeting's minutes page from a pasted address and presses 返回會議紀錄
- **THEN** the meeting list is opened

## ADDED Requirements

### Requirement: One header and tabs for a meeting's two views

The review page (逐字稿校對) and the minutes page (會議紀要) of a meeting SHALL show the same header: the meeting's display title and a meta line with its team, start time, recording length or 沒有錄音, languages and creator, followed by a tab strip with 逐字稿校對 and 會議紀要 in that order, the current one marked. A plain click on the other tab SHALL open that view in place of the current history entry, so the number of history entries stays the same; a click with a modifier key or the middle button SHALL keep the browser's default behaviour. The meeting list SHALL label its two links 會議紀要 and 逐字稿校對, at the same height.

#### Scenario: Switching views

- **WHEN** a user on the review page of a meeting clicks the 會議紀要 tab
- **THEN** the minutes page of that meeting opens with the same title and meta line, the 會議紀要 tab is marked, and the browser history has as many entries as before

#### Scenario: Same header on both views

- **WHEN** a user opens both views of the meeting 產品週會（測試資料） of team 研發部
- **THEN** both show the title 產品週會（測試資料） and a meta line of five parts beginning with 研發部

#### Scenario: Opening a view in a new browser tab

- **WHEN** a user Ctrl-clicks the 逐字稿校對 tab
- **THEN** the review page opens in a new browser tab and the current page stays as it is
