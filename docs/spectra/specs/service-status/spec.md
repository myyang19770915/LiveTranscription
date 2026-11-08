# service-status Specification

## Purpose

Tells people on the meeting page, before they start, whether the local services that meetings and live translation depend on (speech recognition, translation, database) are ready, so a stopped service is visible without first starting a meeting.

## Requirements

### Requirement: Service readiness endpoint

`GET /api/services` SHALL require a signed-in session and SHALL check, concurrently and with a 2-second limit each, the local speech recognition service (its `/health` URL, derived from `ASR_WS_URL` by changing `ws` to `http` and the path to `/health`, or `ASR_HEALTH_URL` when set), the translation service (`TRANSLATE_URL` + `/health`) and the database (`SELECT 1`). A service SHALL count as ready only on HTTP 200 (or a successful query); connection errors, timeouts and other status codes SHALL count as not ready. The response SHALL be HTTP 200 with `ready` (true only when every service is ready) and `services`, a list in the fixed order asr, translate, database, each with `key`, `name` (語音辨識, 翻譯, 資料庫) and `ok`. The response SHALL NOT contain model names, URLs or error details. `/api/health` SHALL stay unchanged.

#### Scenario: All services ready

- **WHEN** a signed-in user calls `/api/services` and all three checks succeed
- **THEN** the response is 200 with `ready` true and three entries with `ok` true

#### Scenario: Not signed in

- **WHEN** a request without a session calls `/api/services`
- **THEN** the response is 401

##### Example: Responses

| ASR | Translation | Database | `ready` | `ok` values in order |
| --- | ----------- | -------- | ------- | -------------------- |
| 200 | 200 | ok | true | true, true, true |
| connection refused | 200 | ok | false | false, true, true |
| 200 | 503 (model loading) | ok | false | true, false, true |
| timeout | 503 | query fails | false | false, false, false |

##### Example: Health URL

| `ASR_WS_URL` | `ASR_HEALTH_URL` | Checked URL |
| ------------ | ---------------- | ----------- |
| `ws://asr:8272/asr_stream_api_v1` | (unset) | `http://asr:8272/health` |
| `wss://asr.example:443/stream` | (unset) | `https://asr.example:443/health` |
| `ws://asr:8272/asr_stream_api_v1` | `http://asr:9000/ready` | `http://asr:9000/ready` |


<!-- @trace
source: service-status
updated: 2026-11-08
code:
  - README.md
  - webapp/server.py
  - webapp/static/refine.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/app.js
  - 20261029_185428.mp4
  - webapp/static/index.html
  - bench/translate_e2e.mjs
  - 20261108_143903.mp4
tests:
  - webapp/test_server.py
-->

---
### Requirement: Readiness in the meeting page status

While no meeting or live translation is running and none is starting, the meeting page SHALL check `/api/services` once after loading, every 30 seconds afterwards while the tab is visible, and immediately when the tab becomes visible again; it SHALL NOT check while hidden. When `ready` is true the status SHALL read 服務就緒 with a steady accent-coloured dot (kind `ready`, not pulsing). When any service is not ready the status SHALL turn red (kind `error`) and read the names of the services that are not ready joined with 、 followed by 服務未啟動, with the title 請確認 Docker 服務已啟動. When the request fails or returns a status other than 200 or 401, the status SHALL read 無法連線到伺服器 in red; a 401 SHALL go to the sign-in page. While a meeting or live translation is running or starting, results SHALL NOT change the status. The message shown when a session ends SHALL stay until the next scheduled check.

#### Scenario: Ready on load

- **WHEN** a signed-in user opens the meeting page and every service is ready
- **THEN** the status reads 服務就緒 with kind `ready`

#### Scenario: A stopped service turns the status red

- **WHEN** the translation service stops while the page is idle
- **THEN** within 30 seconds of the next visible check the status reads 翻譯服務未啟動 with kind `error`

#### Scenario: Running session is not overwritten

- **WHEN** a check completes while live translation is running
- **THEN** the status still reads 即時翻譯中

##### Example: Status text

| `services` with `ok` false | Status text | Kind |
| -------------------------- | ----------- | ---- |
| (none) | 服務就緒 | ready |
| asr | 語音辨識服務未啟動 | error |
| asr, translate | 語音辨識、翻譯服務未啟動 | error |
| (request failed) | 無法連線到伺服器 | error |

<!-- @trace
source: service-status
updated: 2026-11-08
code:
  - README.md
  - webapp/server.py
  - webapp/static/refine.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/app.js
  - 20261029_185428.mp4
  - webapp/static/index.html
  - bench/translate_e2e.mjs
  - 20261108_143903.mp4
tests:
  - webapp/test_server.py
-->