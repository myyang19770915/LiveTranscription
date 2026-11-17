## Purpose

Pages and messages shown to people describe what the system does in plain words, without naming the suppliers, models or technologies behind it, so users see 本機, 雲端辨識 or 外部服務 instead of product names.

## ADDED Requirements

### Requirement: Visible text names no supplier, model or technology

Text a person can see in the web pages SHALL NOT name a supplier, model or technology. This covers page text, labels, placeholders, `title` and `aria-label` attributes, text set by the page scripts, and the messages the server sends to pages (HTTP error details, WebSocket close reasons and error events). The forbidden names SHALL be: Azure, MAI, Confucius, Qwen, DeepSeek, Gemma, GPT, OpenAI, LDAP, Docker, WebSocket, vLLM, the names of environment variables (such as `MINUTES_*`, `TRANSLATE_REFINE_*`, `AZURE_*`) and the configured model names; the word 模型 SHALL NOT be used to describe how the system works. Plain words SHALL be used instead: 本機 or 本機辨識 for recognition on the 語橋 host, 雲端辨識 for cloud recognition, 雲端翻譯服務 or 翻譯服務 for cloud translation, 外部服務 for any service outside the 語橋 host, 公司帳號 for the sign-in account, and 紀要功能 or 問答功能 for the minutes and question features. A message for a feature that is not set up SHALL say that it is not set up and to contact the system administrator, without naming settings. Program identifiers (the engine values `local`, `mai` and `hybrid`, API paths and fields, environment variable names in code), log lines, code comments, the README, documents under `docs/` and the benchmark tools are out of scope.

#### Scenario: The cloud recognition label

- **WHEN** the meeting page is set to English speech and cloud recognition is available
- **THEN** the recognition row reads 雲端辨識（音訊會傳送到外部服務） and no page text contains Azure or MAI

#### Scenario: A feature that is not set up

- **WHEN** a team member opens the minutes of a meeting and no minutes service is configured
- **THEN** the page reads 紀要功能尚未設定，請聯絡系統管理員 and names no environment variable

#### Scenario: The minutes page names no model

- **WHEN** the minutes service is configured with a model name
- **THEN** the minutes page says the transcript is sent to 外部服務 and does not show the model name

#### Scenario: A test keeps forbidden names out

- **WHEN** `test_server` runs
- **THEN** a test reads every HTML and JavaScript file under `webapp/static`, removes comments, collects the visible strings (text between tags, attribute values of `title`, `placeholder`, `aria-label` and `alt`, and string or template literals that contain Chinese characters), adds the server message constants sent to pages, and fails naming the file and the word when any forbidden name appears

##### Example: words the test reports

| Visible string | Result |
| --- | --- |
| 雲端 MAI（音訊會傳送到 Azure） | fails on MAI and Azure |
| 紀要模型未設定，無法產生（請在 .env 設定 MINUTES_*） | fails on 模型 and MINUTES_ |
| 雲端辨識（音訊會傳送到外部服務） | passes |
| `engine === 'mai'` (no Chinese, an identifier) | not checked |
