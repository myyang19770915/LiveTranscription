## ADDED Requirements

### Requirement: A meeting row opens the meeting

In the list on `/meetings`, a click anywhere on the row of a meeting that has segments, outside its 會議紀要 link, SHALL open that meeting's review page. The row SHALL offer 會議紀要 and 逐字稿校對 as text links without a filled background or a border, of equal height, leading to the minutes page and the review page; each address SHALL appear on one link only, so the row holds exactly two links. A meeting without segments SHALL keep the note 沒有校對資料, SHALL hold no link and its row SHALL NOT be clickable.

#### Scenario: Clicking the row

- **WHEN** a user clicks the topic of a meeting that has segments
- **THEN** the review page of that meeting opens

#### Scenario: The links of a row

- **WHEN** `/meetings` is opened at 1440 px wide
- **THEN** each row with segments holds exactly two links, 會議紀要 to `/meetings/<id>/minutes` and 逐字稿校對 to `/meetings/<id>`, both with a transparent background, no border and the same height

#### Scenario: The minutes link inside a clickable row

- **WHEN** a user clicks 會議紀要 in a row
- **THEN** the minutes page of that meeting opens, not the review page

#### Scenario: A meeting without segments

- **WHEN** the list shows a meeting with no segments
- **THEN** its row reads 沒有校對資料, holds no link, and clicking it does not leave the list
