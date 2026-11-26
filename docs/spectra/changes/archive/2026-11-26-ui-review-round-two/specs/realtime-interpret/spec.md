## ADDED Requirements

### Requirement: A record row has one main action

Each row of the list on `/interpret` SHALL show its actions in this order: 載入 as a bordered button; a 下載 button that opens a menu with the links 原音, 譯音 (only for a 即時口譯 record) and 文字, each downloading the same file as before; the 轉成會議紀錄 control with its existing states; and 刪除 in the `--danger` colour. The menu SHALL close on Escape and on a click outside it. Where the browser has no Popover API the three download links SHALL be shown in the row instead of the 下載 button.

#### Scenario: The actions of an interpreting record

- **WHEN** `/interpret` lists a 即時口譯 record at 1440 px wide
- **THEN** its row shows 載入, 下載, 轉成會議紀錄 and 刪除 in this order, 載入 has a visible border, the colour of 刪除 is the `--danger` colour, and no download link is visible

#### Scenario: The download menu

- **WHEN** 下載 is pressed on a 即時口譯 record
- **THEN** a menu shows the links 原音, 譯音 and 文字 pointing at that record's `input.wav`, `output.wav` and `transcript.txt`, and pressing Escape closes it

#### Scenario: A translating record

- **WHEN** 下載 is pressed on a 即時翻譯 record
- **THEN** the menu shows 原音 and 文字 and no 譯音

### Requirement: The replay area appears when a record is loaded

On `/interpret` the waveform with its replay buttons and the 原文 and 譯文 panels SHALL be hidden until a record is loaded, and SHALL be hidden again when the loaded record is deleted. While they are hidden and the list has records, a line under the list SHALL read 按「載入」重播一筆紀錄，並顯示它的原文和譯文。

#### Scenario: Before anything is loaded

- **WHEN** `/interpret` is opened and the list has records
- **THEN** the waveform and the 原文 and 譯文 panels are not displayed and the line 按「載入」重播一筆紀錄，並顯示它的原文和譯文。 is shown

#### Scenario: After 載入

- **WHEN** 載入 is pressed on a record and its data has arrived
- **THEN** the waveform and both panels are displayed, the panels show that record's text, and the line is hidden
