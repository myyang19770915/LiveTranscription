## Purpose

Pages that wait on the server show the same kind of loading feedback, so people can tell what is happening without the page jumping or flickering on fast responses.

## ADDED Requirements

### Requirement: Shared loading state on search and Q&A

While a search on `/search` or a question on `/ask` is under way, its result region SHALL keep its current height and, once the request has run for 200ms, SHALL show a loading row with a small spinner and a verb (搜尋中… on `/search`, 整理答案中… on `/ask`). When the region held no earlier results, it SHALL also show three low-contrast placeholder lines. Earlier results SHALL stay visible but dimmed and SHALL NOT be clickable. The loading row SHALL be hidden from assistive technology, because the existing polite summary already announces the wait. A request that finishes within 200ms SHALL show neither the loading row nor the placeholder lines. The region's `aria-busy` and `is-loading` marking SHALL stay as now: set as soon as the request starts and cleared only by the newest request.

#### Scenario: Slow search with earlier results

- **WHEN** a search takes longer than 200ms while earlier results are shown
- **THEN** the earlier results are dimmed and unclickable, the loading row with spinner and 搜尋中… appears, and no placeholder lines appear

#### Scenario: First question

- **WHEN** a question on `/ask` takes longer than 200ms and no answer has been shown yet
- **THEN** the answer region shows the loading row with 整理答案中… and three placeholder lines

#### Scenario: Fast response

- **WHEN** a search finishes within 200ms
- **THEN** the loading row and placeholder lines never become visible

### Requirement: One spinner style

The sign-in button's spinner, the search loading row and the Q&A loading row SHALL use the same spinner class, defined once in a shared stylesheet. Under `prefers-reduced-motion: reduce` the spinner SHALL NOT rotate and the placeholder lines SHALL NOT animate; the verb text SHALL still show.

#### Scenario: Reduced motion

- **WHEN** a page is opened with reduced motion requested and a slow search runs
- **THEN** the spinner element has no running animation and 搜尋中… is visible
