## MODIFIED Requirements

### Requirement: Narrow screens keep the settings dialog unchanged

At 760px or less the meeting page SHALL show every advanced setting the server offers (辨識引擎, 雲端精修 and 精準模式) unfolded inside the settings dialog, in that order, and the 進階 heading there SHALL NOT act as a fold button. At that width the setup area above the transcript SHALL hold only the language row (語音語言, the swap button and 翻譯成) in a single grid row; no advanced setting SHALL remain in it. Returning to a wider window SHALL put each moved setting back in its original place.

#### Scenario: Phone width

- **WHEN** `/` is opened at 500px and the settings dialog is opened
- **THEN** 辨識引擎 and 雲端精修 appear in the dialog without pressing 進階

#### Scenario: 精準模式 offered on a phone

- **WHEN** `/` is opened at 390px in 即時翻譯 mode while the server offers 精準模式
- **THEN** 語音語言 and 翻譯成 are each at least 120px wide and share one row, 精準模式 is not in the setup area, and the settings dialog shows 精準模式 after 雲端精修

#### Scenario: Back to a wide window

- **WHEN** the page is resized from 390px to 1280px
- **THEN** 精準模式 is back inside the 進階 group next to 雲端精修
