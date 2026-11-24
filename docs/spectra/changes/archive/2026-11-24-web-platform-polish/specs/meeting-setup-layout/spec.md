## ADDED Requirements

### Requirement: The sentence menu is a popover

The sentence menu (`#sentenceMenu`) SHALL be a popover (`popover="auto"`) shown in the top layer while it is open, so no part of the page covers it. Pressing the setting word that opened the menu while the menu is open SHALL close it without reopening it. Its options, placement and keyboard behaviour SHALL stay as "Sentence words open their setting" states.

#### Scenario: The menu in the top layer

- **WHEN** the user presses the team name in the sentence on `/` at 1440px
- **THEN** `#sentenceMenu` has `popover="auto"` and matches `:popover-open`

#### Scenario: Pressing the same word again

- **WHEN** the team menu is open and the user clicks the team name in the sentence
- **THEN** the menu is closed and stays closed, and `#team` is unchanged

### Requirement: The settings dialog closes on a tap outside

The settings dialog of narrow screens (`#mobileSettings`) SHALL carry `closedby="any"`. A click or tap on the backdrop outside the dialog SHALL close it, in browsers that support `closedby` and in those that do not, and closing it this way SHALL stop a running audio test as closing it with its buttons does.

#### Scenario: Tapping the backdrop

- **WHEN** the settings dialog is open on `/` at 390px and the user taps the point (5, 5) outside it
- **THEN** `#mobileSettings` is no longer open
