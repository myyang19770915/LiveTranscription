## Purpose

The paid cloud services the app uses (cloud recognition and realtime interpreting) are billed by the length of audio. This capability gives system administrators one page that shows how much each service was used and what it is estimated to cost, by month, day, purpose and user, and lets them set a budget for each service there.

## ADDED Requirements

### Requirement: Usage figures for administrators

`GET /api/admin/usage` SHALL require a system administrator (403 otherwise) and SHALL return `today` (the date in `MEETING_TIMEZONE`), `month` (`YYYY-MM` of today), `services`, `daily` and `months`. `services` SHALL hold exactly two entries in this order: `mai` (from `mai_usage`, priced with `MAI_USD_PER_HOUR`) and `interpret` (from `interpret_usage`, priced with `INTERPRET_USD_PER_HOUR`). Each entry SHALL hold `key`, `usdPerHour`, `budgetUsd` (a number or `null`), `state`, and `total`, `month` and `previousMonth`, each as `{seconds, usd}` where `seconds` is rounded to 1 decimal and `usd` is `seconds` / 3600 × `usdPerHour` rounded to 2 decimals; `month` covers the calendar month of `today` and `previousMonth` the one before. `state` SHALL be `over` when the total `usd` is at least `budgetUsd`, `near` when it is at least 80% of it, and `ok` otherwise or when `budgetUsd` is `null`. Each entry SHALL also hold `byPurpose` (`{purpose, seconds, monthSeconds}` per purpose) and `byUser` (`{username, seconds, monthSeconds}` per username; an empty list for `mai`), both ordered by `seconds` descending and then by name. `daily` SHALL hold 30 entries `{day, mai, interpret}` (seconds), one per date from 29 days before `today` to `today` in ascending order, and `months` SHALL hold 6 entries `{month, mai, interpret}` (seconds), one per calendar month ending with the month of `today`, in ascending order; dates and months without usage SHALL be present with 0.

#### Scenario: A member asks for the figures

- **WHEN** a signed-in user who is not a system administrator requests `/api/admin/usage`
- **THEN** the response is 403

#### Scenario: Usage in this month and the month before

- **WHEN** today is 2026-11-25, `mai_usage` holds 5400 seconds of purpose `bench` on 2026-10-31 and 1800 seconds of purpose `live` on 2026-11-25, and `interpret_usage` holds 3600 seconds of purpose `live` for alice on 2026-11-24 and 129 seconds of purpose `lab` with the username `''` on 2026-06-30
- **THEN** the `mai` entry has `total` 7200 seconds and 1.08 USD, `month` 1800 seconds and 0.27 USD, `previousMonth` 5400 seconds and 0.81 USD, and `byPurpose` lists `bench` (5400, month 0) before `live` (1800, month 1800); the `interpret` entry has `total` 3729 seconds and 2.11 USD, `month` 3600 seconds and 2.04 USD, and `byUser` lists alice (3600, month 3600) before `''` (129, month 0); `daily` has 30 entries from 2026-10-27 to 2026-11-25 whose last entry is `{mai: 1800, interpret: 0}` and whose entry for 2026-11-24 is `{mai: 0, interpret: 3600}`; `months` has 6 entries from `2026-06` to `2026-11`, with `{mai: 0, interpret: 129}` for `2026-06` and `{mai: 5400, interpret: 0}` for `2026-10`

#### Scenario: No usage at all

- **WHEN** both tables are empty
- **THEN** every `seconds` and `usd` is 0, both `state` values are `ok`, `byPurpose` and `byUser` are empty lists, and `daily` and `months` still hold 30 and 6 entries

### Requirement: Budgets are set on the usage page

Each service SHALL have a budget in USD or none, kept in `app_settings` under the key `usage_budgets` as `{"mai": number or null, "interpret": number or null}`. Until an administrator saves it, the budget of `mai` SHALL be `MAI_BUDGET_USD` (default 50) and `interpret` SHALL have none. `PUT /api/admin/usage/budgets` SHALL require a system administrator (403 otherwise), SHALL take both keys, each `null` or a finite number greater than 0 and at most 1000000, SHALL store them with the administrator's username and SHALL return the stored budgets; any other body SHALL get 422 and SHALL change nothing. A budget is judged against the accumulated cost of the service. Reaching a budget SHALL NOT disable or limit any service.

#### Scenario: Before any budget was saved

- **WHEN** `app_settings` has no `usage_budgets` and `MAI_BUDGET_USD` is not set
- **THEN** `/api/admin/usage` reports `budgetUsd` 50 for `mai` and `null` for `interpret`

#### Scenario: An administrator saves budgets

- **WHEN** an administrator sends `{"mai": 80, "interpret": 20}` to `PUT /api/admin/usage/budgets`
- **THEN** the response is `{"mai": 80, "interpret": 20}` and `/api/admin/usage` reports those budgets

#### Scenario: A budget is removed

- **WHEN** an administrator sends `{"mai": null, "interpret": null}` and the accumulated `mai` cost is 60 USD
- **THEN** both `budgetUsd` values are `null` and the `mai` state is `ok`

#### Scenario: A member tries to save budgets

- **WHEN** a signed-in user who is not a system administrator sends `{"mai": 80, "interpret": null}`
- **THEN** the response is 403 and the budgets are unchanged

##### Example: bodies and results

| Body | Result |
| ---- | ------ |
| `{"mai": 80, "interpret": null}` | 200, stored |
| `{"mai": 0.5, "interpret": 1000000}` | 200, stored |
| `{"mai": 0, "interpret": null}` | 422 |
| `{"mai": -5, "interpret": null}` | 422 |
| `{"mai": 1000001, "interpret": null}` | 422 |
| `{"mai": "80", "interpret": null}` | 422 |
| `{"mai": 80}` | 422 |

##### Example: state against the budget

| Accumulated `usd` | `budgetUsd` | `state` |
| ----------------- | ----------- | ------- |
| 1.65 | 50 | ok |
| 40 | 50 | near |
| 50 | 50 | over |
| 0.29 | `null` | ok |
| 16 | 20 | near |

### Requirement: Usage management page

The app SHALL serve the usage management page at `/admin/usage` to system administrators; any other signed-in user SHALL get a 403 page that says the administration pages are open to system administrators only. The page SHALL name the services 雲端辨識 (`mai`) and 即時口譯 (`interpret`), SHALL state that the amounts are estimates from the usage and the current price and not the bill, and SHALL show, from `/api/admin/usage`:

- four figures: the estimated cost of this month for both services together, of this month for each service, and accumulated for both together, each with its hours;
- for each service a budget card with the accumulated cost, the budget (or 未設上限), a meter of the cost against the budget when there is one, the state as an icon with the words 正常, 接近上限 or 已達上限, the price per hour, and a field with a 儲存 button that sends both budgets to `PUT /api/admin/usage/budgets`; an empty field SHALL mean no budget;
- an alert above the figures for each service whose state is `near` or `over`, naming the service; the alert for `over` SHALL say that the service keeps working;
- a chart of the estimated cost per day for the last 30 days with one stacked bar per day (雲端辨識 below, 即時口譯 above) on one USD axis, a legend naming both services, the date and both amounts shown when a day is hovered or focused from the keyboard, and a button 表格 that shows the same days as a table instead; when no day has usage the page SHALL say so instead of drawing the chart;
- a table of the last 6 months with the hours and cost of each service and the cost of both together;
- a table by purpose for both services, and a table by user for 即時口譯 in which the username `''` reads （未記名）.

Purposes SHALL be shown in plain words where known (`live` 即時辨識 for 雲端辨識 and 即時口譯 for 即時口譯, `quality` 精準模式, `bench` 評測, `lab` 測試) and as recorded otherwise. When `/api/admin/usage` cannot be read the page SHALL say 用量暫時讀不到，請稍後再試。 and SHALL NOT show zeros. When saving a budget fails the page SHALL show the reason under that card and keep what was typed. At a width of 390 px the page SHALL NOT scroll sideways; wide tables SHALL scroll inside their own card.

#### Scenario: A member opens the page

- **WHEN** a signed-in user who is not a system administrator requests `/admin/usage`
- **THEN** the response is 403 and the page reads 管理頁面只開放給系統管理員。

#### Scenario: Figures of the month

- **WHEN** the API reports `mai` month 1800 seconds and 0.27 USD, `interpret` month 3600 seconds and 2.04 USD, and totals of 1.08 and 2.11 USD
- **THEN** the figures read 2.31 美元 for this month together, 0.27 美元 for 雲端辨識, 2.04 美元 for 即時口譯 and 3.19 美元 accumulated

#### Scenario: A service near its budget

- **WHEN** the API reports the `mai` state `near` with 40 USD of a 50 USD budget and the `interpret` state `ok`
- **THEN** one alert names 雲端辨識, its budget card reads 接近上限 with a meter at 80%, and the 即時口譯 card reads 正常

#### Scenario: A service over its budget

- **WHEN** the API reports the `interpret` state `over`
- **THEN** an alert says 即時口譯 has reached its budget and that it keeps working, and its card reads 已達上限

#### Scenario: Saving a budget

- **WHEN** an administrator types 80 in the 雲端辨識 budget field, leaves the 即時口譯 field empty and presses 儲存 on the 雲端辨識 card
- **THEN** the page sends `{"mai": 80, "interpret": null}` and then shows the figures again with the new budget

#### Scenario: Saving is refused

- **WHEN** the server answers 422 to the budget
- **THEN** the reason is shown under that card and the field still holds what was typed

#### Scenario: The daily chart as a table

- **WHEN** two of the 30 days have usage and the administrator presses 表格
- **THEN** the chart is replaced by a table with those two days, the hours of each service and the cost, and pressing the button again shows the chart

#### Scenario: A day from the keyboard

- **WHEN** an administrator moves the focus to a day of the chart with the keyboard
- **THEN** the date and the cost of each service on that day are shown

#### Scenario: No usage in the last 30 days

- **WHEN** every entry of `daily` is 0
- **THEN** the chart card reads 近 30 天沒有用量 and draws no bars

#### Scenario: The figures cannot be read

- **WHEN** `/api/admin/usage` answers 500
- **THEN** the page reads 用量暫時讀不到，請稍後再試。 and shows no figures

#### Scenario: A phone

- **WHEN** the page is opened at 390 px wide
- **THEN** the document is not wider than the window
