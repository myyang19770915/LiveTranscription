## Purpose

Shows the outcome measures of the closed meeting loop (action completion, overdue, on-time completion, time to confirm minutes, how AI extraction is used, how much transcripts are corrected) per team and period, so a team can see whether the system improves its follow-up.

## ADDED Requirements

### Requirement: Outcome metrics page

The system SHALL provide a metrics page at `/metrics`, linked from the page header, and `GET /api/metrics?team=&days=` for signed-in users. The scope SHALL be the user's teams, or one of them when `team` is given; a team the user does not belong to SHALL get 404. `days` SHALL be 30, 90 or 365 (default 30); any other value SHALL get 422. Dates SHALL be judged in MEETING_TIMEZONE. Every rate SHALL be a fraction between 0 and 1, or `null` when its denominator is 0, and the page SHALL show `—` with an explanation instead of 0%. The metrics SHALL be:

- action completion rate: of confirmed action items created in the period, excluding cancelled ones, the share now done;
- current overdue rate: of action items now 未開始 or 進行中 with a due date, the share past due (not limited by the period);
- on-time completion rate: of action items completed in the period with a due date, the share completed on or before the due date;
- time to confirm minutes: the median hours from a meeting's end to the first confirmation of one of its items, over meetings that ended in the period and have a confirmed item;
- AI extraction: AI items of meetings started in the period, counted as adopted unchanged, adopted after a human edit, rejected, or still pending;
- weekly trend: for the last 12 weeks (Monday first), the action items created and completed each week;
- transcript correction: per recognition engine and language, over segments of meetings started in the period, the share of segments whose text differs from the recognised text, and edited characters per 100 recognised characters (edit distance).

An item SHALL be marked as edited by a person when its kind, content, owner, due date or due phrase actually changes on the minutes page or the board; a status change SHALL NOT mark it.

#### Scenario: Viewing a team's metrics

- **WHEN** a member opens `/metrics?team=1&days=90`
- **THEN** the page shows the four metric tiles with their counts, the AI extraction split, the weekly chart and the transcript table for that team over the last 90 days

##### Example: Action metrics (today 2026-11-13, days 30)

| Items | Result |
| ----- | ------ |
| created in period: 4 done, 1 doing, 1 cancelled | completionRate 0.8 (4 of 5) |
| open with due date: 3, of which 1 due 2026-11-12 | overdueRate 0.333 |
| done in period with due date: done 11-10 due 11-10, done 11-12 due 11-11 | onTimeRate 0.5 |
| nothing created in period | completionRate null, page shows — |

##### Example: Transcript correction

| asr_text | source | editedChars | chars |
| -------- | ------ | ----------- | ----- |
| 今天開會 | 今天開會 | 0 | 4 |
| 迷你max很好 | MiniMax很好 | 5 | 7 |
| two segments above | | per100 = 5 / 11 × 100 = 45.5 | |

#### Scenario: A team the user is not in

- **WHEN** a user requests metrics for a team they do not belong to
- **THEN** the request is refused with 404

#### Scenario: Edited marking

- **WHEN** an AI item's owner is changed on the minutes page, and another AI item only has its status changed on the board
- **THEN** the first is counted as adopted after a human edit and the second as adopted unchanged

#### Scenario: Weekly chart details

- **WHEN** the user points at a week in the weekly chart
- **THEN** a tooltip shows that week's start date and its created and completed counts, and a table view lists the same numbers
