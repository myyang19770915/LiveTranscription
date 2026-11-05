## Purpose

A meeting's decisions, action items, open questions and risks become an actionable record: a model proposes them from the reviewed transcript with evidence, and team members confirm, correct or reject each one before it counts. This is the base for follow-up in later meetings.

## ADDED Requirements

### Requirement: Generating minutes

A team member SHALL be able to start minutes generation for a meeting that has stored segments. The whole meeting SHALL be sent to the configured minutes model in one request, as numbered lines `[seq] source text` in order, together with the meeting date, topic and the team's members; it SHALL NOT be split into parts. The minutes model is set by `MINUTES_URL`, `MINUTES_MODEL` and `MINUTES_KEY`, falling back to the cloud refinement model (`TRANSLATE_REFINE_*`). Generation SHALL run in the background, SHALL report its status (running, done or failed), and SHALL refuse a second start while one is running (409). A failed model call SHALL end generation as failed with a message and SHALL keep every existing item.

#### Scenario: Generation finishes

- **WHEN** a member starts generation for a meeting with 42 segments
- **THEN** one model request carries segments 1 to 42, the status is running until it answers, then done with the number of items stored and dropped

#### Scenario: Second start while running

- **WHEN** generation is running and a member starts it again
- **THEN** the system responds 409 and the running generation continues

#### Scenario: Model unavailable

- **WHEN** the model call fails
- **THEN** the status is failed with a message and the meeting's existing items are unchanged

#### Scenario: Minutes model not configured

- **WHEN** neither `MINUTES_URL` nor `TRANSLATE_REFINE_URL` is set and a member starts generation
- **THEN** the system responds 400 with 紀要模型未設定 and does not start

### Requirement: Items carry evidence

Each proposed item SHALL be one of decision, action, question or risk, and SHALL cite at least one segment of the meeting by sequence number. Cited numbers that are not segments of the meeting SHALL be removed; an item left without evidence SHALL NOT be stored. Items with the same kind and the same content after removing spaces and punctuation SHALL be stored once, with their evidence merged.

#### Scenario: Invented evidence

- **WHEN** the model proposes an item citing only segment 99 while the meeting has segments 1–20
- **THEN** the item is not stored

##### Example: evidence filtering

| Meeting segments | Cited | Stored evidence | Stored |
| -------------- | ----- | --------------- | ------ |
| 1–20 | [3, 7] | [3, 7] | yes |
| 1–20 | [7, 99] | [7] | yes |
| 1–20 | [99] | — | no |
| 1–20 | [] | — | no |

### Requirement: Owners and due dates

An action item's owner SHALL be a member of the meeting's team, matched case-insensitively against usernames and display names; a name that matches no member SHALL be kept as an owner hint with no owner. A due date SHALL be stored only when it is a valid calendar date; the phrase the meeting used SHALL be kept with it.

#### Scenario: Name not in the team

- **WHEN** the model names "小王" as owner and no member of the team has that name
- **THEN** the item has no owner, shows 未指派, and keeps 小王 as the owner hint

##### Example: owner and due date

| Model owner | Team members | Stored owner | Hint |
| ----------- | ------------ | ------------ | ---- |
| "Alice" | alice (王愛麗) | alice | — |
| "王愛麗" | alice (王愛麗) | alice | — |
| "小王" | alice (王愛麗) | none | 小王 |

| Meeting date | Model due_text / due_date | Stored due date | Stored phrase |
| ------------ | ------------------------- | --------------- | ------------- |
| 2026-11-04 (Wed) | 下週五 / 2026-11-13 | 2026-11-13 | 下週五 |
| 2026-11-04 | 月底前 / 2026-11-31 | none | 月底前 |

### Requirement: Human confirmation

Generated items SHALL start as proposed. A team member SHALL be able to change an item's kind, content, owner (a team member or none) and due date, to confirm it, to reject it, and to add an item by hand; a hand-added item SHALL be confirmed. The summary SHALL be editable. Each item and the summary SHALL carry a version that every change increments; a change based on an older version SHALL be refused with 409 and the current value.

#### Scenario: Confirming an edited proposal

- **WHEN** a member changes a proposed action's owner to bob and confirms it
- **THEN** the item is confirmed with owner bob and records who confirmed it and when

#### Scenario: Owner outside the team

- **WHEN** a member sets an item's owner to a user who is not in the meeting's team
- **THEN** the system responds 422 and the owner is unchanged

#### Scenario: Stale edit

- **WHEN** two members edit the same item from the same version
- **THEN** the second change is refused with 409 and receives the item as changed by the first

### Requirement: Regenerating keeps human decisions

Generating again SHALL replace only the AI items that are still proposed. Confirmed, rejected and hand-added items SHALL be kept, and a newly generated item with the same kind and content as a kept item SHALL NOT be stored again. The summary SHALL be replaced only if nobody has edited it.

#### Scenario: Second generation

- **WHEN** a meeting has one confirmed decision, one rejected risk and two proposed actions, and generation runs again proposing the same decision and one new action
- **THEN** the meeting has the confirmed decision, the rejected risk and the one new proposed action

### Requirement: Exporting minutes

A team member SHALL be able to download the minutes as Markdown containing the meeting topic, date, team, the summary, and the confirmed items grouped as 決議, 待辦 (with owner display name or 未指派 and due date), 待確認問題 and 風險, each with its evidence as mm:ss timestamps. Proposed and rejected items SHALL NOT appear.

#### Scenario: Only confirmed items

- **WHEN** a meeting has 2 confirmed actions, 1 proposed decision and 1 rejected risk
- **THEN** the Markdown lists the 2 actions only, each with owner, due date and timestamps

### Requirement: Only team members use minutes

Generating, viewing, editing, confirming, rejecting, adding and exporting minutes SHALL be allowed to every member of the meeting's team and to no one else; non-members SHALL receive 404 and change nothing.

#### Scenario: Member of another team

- **WHEN** a user who is not in the meeting's team requests the minutes or starts generation
- **THEN** the system responds 404 and nothing starts or changes
