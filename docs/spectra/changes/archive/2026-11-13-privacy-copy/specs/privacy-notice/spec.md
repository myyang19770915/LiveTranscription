## Purpose

The live page tells the user where meeting audio and text are processed, because the answer depends on the recognition engine and the cloud refinement choice. This capability covers that notice and its wording.

## ADDED Requirements

### Requirement: The live page states where audio and text go

The live page SHALL show a privacy notice in its header and the same label in its footer, made of a short label and a sentence chosen by the current recognition engine and cloud refinement choice as in the example table. The notice SHALL be updated as soon as the engine or the cloud refinement choice changes, and after the page has applied the remembered choices. When the engine selector is hidden because no cloud engine is configured, the engine SHALL count as `local`; when the cloud refinement checkbox is hidden, refinement SHALL count as off. The live page and the sign-in page SHALL NOT state that audio stays on the user's device or that processing is end-to-end local, and SHALL NOT name a server folder as the place where recordings are stored.

#### Scenario: Notice follows the choices

- **WHEN** the user chooses a recognition engine and a cloud refinement setting
- **THEN** the notice shows the label and sentence of the matching row of the example table

##### Example: notice wording

| Engine | Cloud refinement | Label | Sentence |
| ------ | ---------------- | ----- | -------- |
| local | off | 自架主機 | 音訊與文字只在語橋主機處理 |
| local | on | 雲端精修 | 文字會傳送到外部模型服務 |
| hybrid | off | 雲端辨識 | 中文以外的音訊會傳送到 Azure |
| mai | off | 雲端辨識 | 音訊會傳送到 Azure |
| hybrid | on | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |
| mai | on | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |

#### Scenario: Engine changed before a meeting

- **WHEN** the notice shows 自架主機 and the user switches the engine to 雲端 MAI
- **THEN** the notice shows 雲端辨識 and 音訊會傳送到 Azure without reloading the page

#### Scenario: No claim of on-device processing

- **WHEN** a user opens the live page or the sign-in page
- **THEN** neither page contains 不離開你的設備, 端對端本機處理 or output 資料夾

### Requirement: The sign-in page shows no real account name

The account field of the sign-in page SHALL have the placeholder 公司帳號 and SHALL NOT contain the name of any existing account.

#### Scenario: Placeholder

- **WHEN** a signed-out user opens the sign-in page
- **THEN** the account field placeholder is 公司帳號
