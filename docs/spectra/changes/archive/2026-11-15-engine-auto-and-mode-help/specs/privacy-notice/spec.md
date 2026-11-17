## MODIFIED Requirements

### Requirement: The live page states where audio and text go

The live page SHALL show a privacy notice in its header and the same label in its footer, made of a short label and a sentence chosen by the current recognition engine, the cloud refinement choice and whether the translation model is an external service (`cloudTranslate` of `/api/config`) as in the example table. The recognition engine SHALL be the one the spoken language decides (`local` or `mai`, as meeting-setup-layout specifies); when no cloud engine is configured it SHALL count as `local`. The notice SHALL be updated as soon as the spoken language or the cloud refinement choice changes, and after the page has applied the remembered choices. When the cloud refinement checkbox is hidden, refinement SHALL count as off. When the translation model is external, the notice SHALL never say that text stays on the host. Until the page has read `/api/config` the notice SHALL show 資料去向 and 確認中…, and when that request fails the page SHALL treat the translation model as external. The live page and the sign-in page SHALL NOT state that audio stays on the user's device or that processing is end-to-end local, and SHALL NOT name a server folder as the place where recordings are stored. The `hybrid` rows of the table remain the wording `PrivacyNote.text` gives callers that pass `hybrid`; the live page itself SHALL pass only `local` or `mai`.

#### Scenario: Notice follows the choices

- **WHEN** the spoken language gives the engine of a row and the user chooses that row's cloud refinement setting
- **THEN** the notice shows the label and sentence of the matching row of the example table

##### Example: notice wording

| Engine | Cloud refinement | External translation | Label | Sentence |
| ------ | ---------------- | -------------------- | ----- | -------- |
| local | off | no | 自架主機 | 音訊與文字只在語橋主機處理 |
| local | on | no | 雲端精修 | 文字會傳送到外部模型服務 |
| hybrid | off | no | 雲端辨識 | 中文以外的音訊會傳送到 Azure |
| mai | off | no | 雲端辨識 | 音訊會傳送到 Azure |
| hybrid | on | no | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |
| mai | on | no | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |
| local | off | yes | 雲端翻譯 | 文字會傳送到外部模型服務 |
| local | on | yes | 雲端翻譯與精修 | 文字會傳送到外部模型服務 |
| hybrid | off | yes | 雲端辨識與翻譯 | 音訊與文字會傳送到外部服務 |
| mai | off | yes | 雲端辨識與翻譯 | 音訊與文字會傳送到外部服務 |
| mai | on | yes | 雲端辨識與精修 | 音訊與文字會傳送到外部服務 |

#### Scenario: Spoken language changed before a meeting

- **WHEN** the server offers MAI, there is no external translation and no refinement, the notice shows 自架主機 for 中文, and the user switches the spoken language to 日本語
- **THEN** the notice shows 雲端辨識 and 音訊會傳送到 Azure without reloading the page

#### Scenario: No claim of on-device processing

- **WHEN** a user opens the live page or the sign-in page
- **THEN** neither page contains 不離開你的設備, 端對端本機處理 or output 資料夾

#### Scenario: Settings could not be read

- **WHEN** the request for `/api/config` fails and the engine is local
- **THEN** the notice shows 雲端翻譯 and 文字會傳送到外部模型服務

#### Scenario: External translation with the local engine

- **WHEN** `/api/config` reports `cloudTranslate` true, the engine is local and cloud refinement is off
- **THEN** the notice shows 雲端翻譯 and 文字會傳送到外部模型服務
