# live-translation Specification

## Purpose

Lets a signed-in user use the live page for translation only — a conversation between two people, or a video playing in another tab — without creating a meeting or keeping anything on the server, and lets the live translation float above other windows as subtitles.

## Requirements

### Requirement: Translate-only sessions

The live page SHALL offer a mode switch between 開會 and 即時翻譯, remembered in the browser. In 即時翻譯 mode the team, topic and series fields and the series panel SHALL be hidden, the start button SHALL read 開始翻譯, and starting SHALL NOT require membership of any team. A translate-only session SHALL create no meeting record, store no transcript, segments or recording on the server and SHALL NOT appear in the meeting list; the transcript and the browser-side recording SHALL stay available for download from the page until the next session starts. The mode SHALL NOT change while a session is running.

The `/ws/transcribe` handshake SHALL accept `mode: "translate"` without a `meeting_id`: the gateway SHALL forward audio to the chosen engine and return recognition events without `audioMs`, SHALL write no audio file, and SHALL still require a signed-in user and a same-origin request. A handshake without `mode` SHALL keep the existing meeting checks.

#### Scenario: Translating a video

- **WHEN** a user switches to 即時翻譯, chooses 分頁／系統聲音 and presses 開始翻譯
- **THEN** the transcript and translation appear as during a meeting, the meeting list has no new entry afterwards, and 匯出逐字稿 downloads the text

#### Scenario: User without a team

- **WHEN** a user who belongs to no team switches to 即時翻譯 and presses 開始翻譯
- **THEN** the session starts

#### Scenario: Translate handshake stores nothing

- **WHEN** a signed-in client opens `/ws/transcribe` with `{"mode": "translate", "language": "zh"}` and sends audio
- **THEN** recognition events come back without `audioMs`, no row is added to `meetings`, and no file is written under `output/teams`

#### Scenario: Meeting handshake unchanged

- **WHEN** a client opens `/ws/transcribe` with `{"language": "zh"}` and no `meeting_id`
- **THEN** the connection is closed with 4404 before any audio is forwarded


<!-- @trace
source: live-translation
updated: 2026-11-08
code:
  - 20261029_185428.mp4
  - bench/README.md
  - webapp/static/app.js
  - webapp/static/index.html
  - webapp/static/mobile.css
  - webapp/static/refine.css
  - webapp/static/subtitles.js
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/server.py
  - meeting-2026-11-01T00-16-53.txt
  - README.md
  - docs/roadmap.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Floating subtitles window

The live page SHALL offer 浮動字幕: a separate always-on-top window (Document Picture-in-Picture) that the user can move and resize, showing the last two finalized translated sentences and the current draft translation in a distinct style, kept in step with the page's translation. The window SHALL let the user show or hide the last source sentence and choose one of four text sizes; both choices SHALL be remembered in the browser. Closing the window SHALL return the button to its closed state. In a browser without Document Picture-in-Picture the button SHALL be disabled with the reason 需要桌面版 Chrome 或 Edge 116 以上.

#### Scenario: Subtitles follow the translation

- **WHEN** the subtitles window is open and a new sentence is translated
- **THEN** the window shows the last two translated sentences, the draft in the draft style, and the page's own translation is unchanged

#### Scenario: Showing the source

- **WHEN** the user turns on 原文 in the subtitles window and presses A+
- **THEN** the last source sentence appears above the translation, the text grows one size, and both settings are kept after the page reloads

##### Example: Last two sentences

| Translation so far | Draft | Window shows |
| --- | --- | --- |
| 大家好。今天先看進度。合約下週寄出。 | （無） | 今天先看進度。合約下週寄出。 |
| 大家好。 | 今天先 | 大家好。＋暫譯「今天先」 |

<!-- @trace
source: live-translation
updated: 2026-11-08
code:
  - 20261029_185428.mp4
  - bench/README.md
  - webapp/static/app.js
  - webapp/static/index.html
  - webapp/static/mobile.css
  - webapp/static/refine.css
  - webapp/static/subtitles.js
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/server.py
  - meeting-2026-11-01T00-16-53.txt
  - README.md
  - docs/roadmap.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Screen view with subtitles

When the session's audio source includes the shared tab or screen (分頁／系統聲音 or 麥克風＋系統聲音), the live page SHALL offer 畫面＋字幕: an in-page full-window view showing the shared picture with a subtitle box laid over it. The box SHALL show the same content as the floating subtitles window (the last two finalized translated sentences, the draft in a distinct style, optionally the last source sentence) and SHALL share its source toggle and text size setting with that window. The box SHALL have a background opacity slider from 20% to 100% (default 55%) that changes only the background, SHALL be draggable to any position, and the opacity and position SHALL be remembered in the browser. The view SHALL offer full screen and SHALL close on its close button or Esc. The shared picture SHALL be shown locally only: never recorded or sent to the server. Without a shared picture (microphone-only source, or no session) the button SHALL be disabled with the reason 需要分頁／系統聲音來源, and ending the session SHALL close the view.

#### Scenario: Subtitles over the shared tab

- **WHEN** a user starts with 分頁／系統聲音, presses 畫面＋字幕, sets the opacity slider to 30 and drags the subtitle box to the top of the picture
- **THEN** the shared picture fills the window with the subtitle box over it showing the page's latest translation, the box background is 30% opaque while the text is unchanged, and after closing and reopening the view the box is at the top with the same opacity

#### Scenario: Microphone-only session

- **WHEN** a user starts with 麥克風 as the only source
- **THEN** 畫面＋字幕 is disabled with the title 需要分頁／系統聲音來源

#### Scenario: Session ends

- **WHEN** the view is open and the user stops the session or the share is ended in the browser
- **THEN** the view closes and the button is disabled again

##### Example: Saved overlay settings

| localStorage.overlay | Box background | Box centre |
| --- | --- | --- |
| `{"opacity":30,"x":50,"y":12}` | rgba(0,0,0,.3) | 50% across, 12% down |
| missing or invalid | rgba(0,0,0,.55) | 50% across, 88% down |

<!-- @trace
source: screen-subtitles
updated: 2026-11-08
code:
  - webapp/static/mobile.css
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/subtitles.js
  - webapp/static/overlay.css
  - 20261029_185428.mp4
  - README.md
  - webapp/static/index.html
  - webapp/static/overlay.js
  - webapp/static/app.js
  - bench/README.md
  - bench/translate_e2e.mjs
-->