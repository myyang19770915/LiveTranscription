## MODIFIED Requirements

### Requirement: Readiness in the meeting page status

While no meeting or live translation is running and none is starting, the meeting page SHALL check `/api/services` once after loading, every 30 seconds afterwards while the tab is visible, and immediately when the tab becomes visible again; it SHALL NOT check while hidden. When `ready` is true the status SHALL read 服務就緒 with a steady accent-coloured dot (kind `ready`, not pulsing). When any service is not ready the status SHALL turn red (kind `error`) and read the names of the services that are not ready joined with 、 followed by 服務未啟動, with the title 請聯絡系統管理員. When the request fails or returns a status other than 200 or 401, the status SHALL read 無法連線到伺服器 in red; a 401 SHALL go to the sign-in page. While a meeting or live translation is running or starting, results SHALL NOT change the status. The message shown when a session ends SHALL stay until the next scheduled check.

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
