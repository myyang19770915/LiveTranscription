# microphone-access Specification

## Purpose

Explains in plain words why the microphone or shared audio cannot be used when the page is opened over an insecure connection or in a browser without media capture, instead of showing the browser's raw script error.

## Requirements

### Requirement: Insecure page explains the microphone is unavailable

When the meeting page is not a secure context (`window.isSecureContext` is false, for example `http://` on a public hostname), the audio source status SHALL show 需要 https 連線才能使用麥克風 as soon as the page loads. Pressing 測試音源 or starting a meeting or translation SHALL NOT call the media capture API; it SHALL show the same status and a message with what to do instead: on a hostname without an explicit port, the https address of the current page (`https://` followed by the hostname, path and query); on an IP address or an explicit port, where that address has no https, the advice to use an https address or open the page as localhost on the same computer, without naming an address. When the page is secure but the browser lacks `navigator.mediaDevices.getUserMedia`, the status SHALL show 此瀏覽器不支援麥克風. No raw script error text (such as `undefined is not an object`) SHALL reach the page.

#### Scenario: Opened over http on a public hostname

- **WHEN** `http://asr.example.test/` is opened, which the browser treats as insecure, and 測試音源 is pressed
- **THEN** the status reads 需要 https 連線才能使用麥克風 and the message contains `https://asr.example.test/`

##### Example: https address in the message

| Current page | Address in the message |
| --- | --- |
| `http://asr.example.test/` | `https://asr.example.test/` |
| `http://asr.example.test/?team=3` | `https://asr.example.test/?team=3` |
| `http://asr.example.test:18082/` | none: 請改用 https 網址，或在這台電腦上以 localhost 開啟 |
| `http://192.168.1.20:18082/` | none: 請改用 https 網址，或在這台電腦上以 localhost 開啟 |

#### Scenario: Status shown before any button is pressed

- **WHEN** the insecure page finishes loading
- **THEN** the audio source status already reads 需要 https 連線才能使用麥克風

#### Scenario: Secure page keeps working

- **WHEN** the page is opened over https or localhost in a browser with media capture
- **THEN** 測試音源 requests the microphone as before

#### Scenario: Browser without media capture

- **WHEN** a secure page is opened in a browser without `navigator.mediaDevices.getUserMedia`
- **THEN** the status reads 此瀏覽器不支援麥克風 and 測試音源 shows a message starting with 此瀏覽器不支援麥克風

#### Scenario: Shared audio on an insecure page

- **WHEN** the insecure page loads, where the browser offers no screen or tab capture either
- **THEN** the 音訊來源 options for sharing a tab or the system are disabled, 音訊來源 stays 麥克風, and the status reads 需要 https 連線才能使用麥克風

<!-- @trace
source: phone-mic-and-layout
updated: 2026-11-15
code:
  - bench/ui_polish_e2e.mjs
  - webapp/static/search.html
  - webapp/static/refine.css
  - docs/ui-review-shots/metrics.jpeg
  - webapp/static/admin.html
  - webapp/static/login.html
  - webapp/static/admin.css
  - webapp/static/actions.css
  - webapp/static/search.js
  - docs/ui-review-shots/actions-board.jpeg
  - webapp/static/accounts.css
  - webapp/static/styles.css
  - webapp/static/evidence-panel.css
  - webapp/static/meetings.html
  - bench/ui_review_e2e.mjs
  - docs/ui-review-shots/404-page.jpeg
  - webapp/static/metrics.html
  - webapp/static/account.js
  - docs/ui-review-shots/search-results.jpeg
  - webapp/static/index.html
  - webapp/static/overlay.css
  - webapp/static/review.css
  - webapp/static/subtitles.css
  - webapp/static/subtitles.js
  - webapp/static/speakers.css
  - webapp/static/actions.html
  - docs/ui-review-shots/qa-answer.jpeg
  - webapp/static/themes.css
  - docs/ui-review-shots/meeting-live.jpeg
  - docs/ui-review-shots/team-management.jpeg
  - docs/ui-review-shots/meetings-list.jpeg
  - bench/README.md
  - webapp/static/app.js
  - webapp/static/ask.css
  - webapp/static/minutes.html
  - chang01.png
  - webapp/static/not-found.html
  - webapp/static/review.html
  - webapp/static/tokens.css
  - webapp/static/search.css
  - webapp/static/series.css
  - webapp/static/ask.html
  - webapp/static/login.css
  - webapp/static/mobile.css
  - docs/ui-design-suggestions-codex.md
  - docs/ui-review-codex.md
  - docs/ui-review-shots/login-dark.jpeg
  - docs/ui-review-shots/mobile-transcript-review.jpeg
  - webapp/static/minutes.css
  - webapp/static/ask.js
  - webapp/static/loading-state.js
  - docs/ui-review-shots/minutes-empty.jpeg
  - webapp/static/metrics.css
tests:
  - webapp/test_server.py
-->

---
### Requirement: Audio test result is always visible

The audio source status (`#micStatus`) and the audio test level meter SHALL be shown inside the 測試音源 button, for every audio source (麥克風, 分頁／系統聲音, 麥克風＋系統聲音), and SHALL NOT be hidden together with the microphone selector. The status SHALL be announced to screen readers when it changes (`aria-live="polite"`). While a test runs, the level meter SHALL follow the audio level, and the status SHALL read 訊號正常： followed by the source name once the level has passed the existing signal threshold. When the level has not passed that threshold within 5 seconds of the test starting, the status SHALL read 還沒收到聲音 with advice for the chosen source, in the error style: for 麥克風, 請對麥克風說話，或換一個麥克風來源; for 分頁／系統聲音 and 麥克風＋系統聲音, 請確認分享時勾選了分享音訊，且正在播放. When the level passes the threshold afterwards, the status SHALL change back to 訊號正常：.

#### Scenario: Tab audio test shows its result

- **WHEN** the audio source is 分頁／系統聲音, 測試音源 is pressed, and a tab with sound is shared
- **THEN** the 測試音源 button shows the status 訊號正常： followed by the source name and a moving level meter

#### Scenario: Silent test is reported

- **WHEN** a test runs for 5 seconds and the level never passes the signal threshold
- **THEN** the status reads 還沒收到聲音 with the advice for the chosen source, in the error style

##### Example: advice by source

| Audio source | Status after 5 silent seconds |
| --- | --- |
| 麥克風 | 還沒收到聲音：請對麥克風說話，或換一個麥克風來源 |
| 分頁／系統聲音 | 還沒收到聲音：請確認分享時勾選了分享音訊，且正在播放 |
| 麥克風＋系統聲音 | 還沒收到聲音：請確認分享時勾選了分享音訊，且正在播放 |

#### Scenario: Insecure page status is shown in the button

- **WHEN** the page is not a secure context (where 分頁／系統聲音 is disabled and the source stays 麥克風)
- **THEN** the status 需要 https 連線才能使用麥克風 is shown inside the 測試音源 button

<!-- @trace
source: audio-test-feedback
updated: 2026-11-22
code:
  - webapp/static/refine.css
  - lab/realtime-translate/server.py
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/server.py
  - webapp/static/app.js
  - chang01.png
  - lab/realtime-translate/index.html
  - lab/realtime-translate/costs.jsonl
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - bench/meeting_end_e2e.mjs
  - gpt-realtime-translate_demoUI.png
  - bench/ui_polish_e2e.mjs
  - webapp/static/index.html
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - 20261122_211227.mp4
  - bench/audio_test_e2e.mjs
  - 20261122_215017.mp4
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
tests:
  - webapp/test_server.py
-->