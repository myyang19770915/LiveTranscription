## ADDED Requirements

### Requirement: Text is never smaller than 12px

On every page, at 1440 px and at 390 px wide and in the state the page opens in, every visible piece of text SHALL have a computed font size of at least 12 px. Text whose own element is a `p`, `small`, `label`, `li`, `button` or `a` (sentences, list items, field labels and the labels of buttons and links) SHALL have a computed font size of at least 13 px.

#### Scenario: The meeting page on a desktop

- **WHEN** `/` is opened at 1440 px wide before a meeting is started
- **THEN** no visible text is smaller than 12 px, and the hints of the two empty panes and the footer actions 清除 and 匯出逐字稿 are at least 13 px

#### Scenario: The meeting page on a phone

- **WHEN** `/` is opened at 390 px wide
- **THEN** no visible text is smaller than 12 px, and the field labels 語音語言 and 翻譯成 are at least 13 px

#### Scenario: Every other page

- **WHEN** each of `/meetings`, a meeting's review page, its minutes page, `/actions`, `/search?q=會議`, `/ask`, `/metrics`, `/interpret`, `/admin`, `/admin/usage`, `/admin/settings`, the not-found page and `/login` is opened at 1440 px and at 390 px wide
- **THEN** no visible text is smaller than 12 px and no text in a `p`, `small`, `label`, `li`, `button` or `a` is smaller than 13 px

##### Example: sizes before and after

| Text | Before | After |
| ---- | ------ | ----- |
| 就緒 chip on a phone | 8 px | 12 px |
| 0 字 count on a phone | 9 px | 12 px |
| 語音語言 field label on a phone | 10 px | 13 px |
| 點擊「開始會議」，逐字稿將即時顯示 | 11 px | 13 px |
| chart axis numbers on `/metrics` and `/admin/usage` | 11 px | 12 px |
| tile notes and chart subtitles on `/metrics` and `/admin/usage` | 12.5 px | 13 px |

### Requirement: Keyboard focus is always visible

Every control that the Tab key reaches SHALL, while it has keyboard focus, show an outline at least 2 px wide, either on the control itself or on the field box that directly wraps it. No stylesheet SHALL remove the outline of a focused element without setting another one for keyboard focus.

#### Scenario: Tabbing through a page

- **WHEN** each page is opened at 1440 px wide and the Tab key is pressed until focus returns to the start
- **THEN** at every stop the focused element, its parent or its grandparent has a computed `outline-style` other than `none` and an `outline-width` of at least 2 px

#### Scenario: Fields inside a box

- **WHEN** the search field of `/actions`, the question field of `/ask` or the search field of `/search` has keyboard focus
- **THEN** the box around the field shows the outline

#### Scenario: The chart on the metrics page

- **WHEN** a bar group of the weekly chart on `/metrics` has keyboard focus
- **THEN** it shows an outline at least 2 px wide
