## Purpose

The meeting page puts the settings people change for each meeting first and folds away the advanced options most meetings leave alone, so the live transcript appears sooner on screen without hiding which advanced options are on.

## ADDED Requirements

### Requirement: Advanced settings fold away by default

On the meeting page (`/`) on a window wider than 760px, the 進階 heading SHALL be a button with `aria-expanded` and `aria-controls` that shows or hides the advanced settings it introduces: 辨識引擎, 雲端精修 and 精準模式. On a first visit the group SHALL be folded. The chosen state SHALL be stored in localStorage under `setupAdvancedOpen` and used on later visits; when storage is unavailable the group SHALL start folded. 會議情境 is not an advanced setting and SHALL stay visible. When none of the advanced settings is offered, the heading SHALL stay hidden as before. Folding SHALL NOT change any setting's value or what is sent when a meeting starts.

#### Scenario: First visit

- **WHEN** a user with no stored preference opens `/` on a 1280px window and the server offers at least one advanced setting
- **THEN** the 進階 button shows `aria-expanded="false"`, 辨識引擎, 雲端精修 and 精準模式 are not visible, and 會議情境 is visible

#### Scenario: Unfold and remember

- **WHEN** the user presses 進階 and reloads the page
- **THEN** the advanced settings are visible after the reload and the button shows `aria-expanded="true"`

#### Scenario: Folding keeps the settings

- **WHEN** 精準模式 is checked, the group is folded and a meeting is started
- **THEN** the meeting starts with 精準模式 on, exactly as with the group unfolded

### Requirement: Folded heading names the advanced options in use

While folded, the 進階 button SHALL show a short summary of the offered advanced options that differ from their defaults, joined with 、, or 預設 when none differ. The summary SHALL update when a setting changes.

#### Scenario: Summary text

- **WHEN** the group is folded with the given settings
- **THEN** the button's summary reads as in the example table

##### Example: summary

| 辨識引擎 | 雲端精修 | 精準模式 | Summary |
| -------- | -------- | -------- | ------- |
| 本機 | off | off | 預設 |
| 本機 | off | on | 精準模式 |
| 雲端 MAI | on | off | 雲端 MAI、雲端精修 |
| 混合 | off | on | 混合辨識、精準模式 |

### Requirement: Narrow screens keep the settings dialog unchanged

At 760px or less the meeting page SHALL keep showing the advanced settings the settings dialog already offered before this change (辨識引擎 and 雲端精修, when the server offers them) unfolded inside the dialog, and the 進階 heading there SHALL NOT act as a fold button.

#### Scenario: Phone width

- **WHEN** `/` is opened at 500px and the settings dialog is opened
- **THEN** 辨識引擎 and 雲端精修 appear in the dialog without pressing 進階
