# live-translation Specification

## Purpose

Lets a signed-in user use the live page for translation only — a conversation between two people, or a video playing in another tab — without creating a meeting or keeping anything on the server, and lets the live translation float above other windows as subtitles.

## Requirements

### Requirement: Translate-only sessions

The live page SHALL offer a mode switch between 開會 and 即時翻譯, remembered in the browser. In 即時翻譯 mode the team, topic and series fields and the series panel SHALL be hidden, the start button SHALL read 開始翻譯, and starting SHALL NOT require membership of any team. A translate-only session SHALL create no meeting record, store no transcript, segments or recording on the server and SHALL NOT appear in the meeting list; the transcript and the browser-side recording SHALL stay available for download from the page until the next session starts. The mode SHALL NOT change while a session is running.

In 即時翻譯 mode, continuous Chinese or Japanese speech without a sentence end or pause SHALL be finalized for translation at the last settled clause boundary (a comma followed by at least 8 further characters) once the untranslated text reaches 40 characters, each segment at least 16 characters, while clauses the segmentation rules consider unfinished (connectives such as 因為, 如果; open endings such as 的, 就) stay joined. 開會 mode SHALL keep the 100-character threshold.

The `/ws/transcribe` handshake SHALL accept `mode: "translate"` without a `meeting_id`: the gateway SHALL forward audio to the chosen engine and return recognition events without `audioMs`, SHALL write no audio file, and SHALL still require a signed-in user and a same-origin request. A handshake without `mode` SHALL keep the existing meeting checks.

#### Scenario: Translating a video

- **WHEN** a user switches to 即時翻譯, chooses 分頁／系統聲音 and presses 開始翻譯
- **THEN** the transcript and translation appear as during a meeting, the meeting list has no new entry afterwards, and 匯出逐字稿 downloads the text

#### Scenario: Continuous speech is finalized in subtitle-sized segments

- **WHEN** in 即時翻譯 mode the untranslated transcript is 他說我們今天要討論的是這個新的工作流，因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明 with no sentence end or pause
- **THEN** the next finalized segment ends at a comma and is between 16 and 60 characters long, and the same text in 開會 mode is not finalized yet

#### Scenario: User without a team

- **WHEN** a user who belongs to no team switches to 即時翻譯 and presses 開始翻譯
- **THEN** the session starts

#### Scenario: Translate handshake stores nothing

- **WHEN** a signed-in client opens `/ws/transcribe` with `{"mode": "translate", "language": "zh"}` and sends audio
- **THEN** recognition events come back without `audioMs`, no row is added to `meetings`, and no file is written under `output/teams`

#### Scenario: Meeting handshake unchanged

- **WHEN** a client opens `/ws/transcribe` with `{"language": "zh"}` and no `meeting_id`
- **THEN** the connection is closed with 4404 before any audio is forwarded

##### Example: Live profile segment lengths

| Untranslated text (live profile) | Finalized segment |
| --- | --- |
| 他說我們今天要討論的是這個新的工作流，因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明 | ends at a comma, 16–60 characters |
| 因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明 | never ends right after 因為很多同事都還不熟悉， |


<!-- @trace
source: live-subtitle-segments
updated: 2026-11-08
code:
  - webapp/static/segmentation.js
  - README.md
  - bench/README.md
  - bench/run.py
  - webapp/replay_browser.py
  - webapp/static/index.html
  - webapp/replay_inject.js
  - 20261108_143903.mp4
  - webapp/static/app.js
  - meeting-2026-11-01T00-16-53.txt
  - 20261029_185428.mp4
  - webapp/static/subtitles.js
  - bench/segcheck.js
  - bench/translate_e2e.mjs
  - webapp/static/overlay.js
-->

---
### Requirement: Floating subtitles window

The live page SHALL offer 浮動字幕: a separate always-on-top window (Document Picture-in-Picture) that the user can move and resize, showing the recent finalized translation segments (up to 30; in 開會 the recent translated sentences) from the top down with the newest at the bottom, as many as the window has room for, followed by the current draft translation in a distinct style, kept in step with the page's translation. Segments other than the newest two SHALL be dimmed. The window SHALL let the user show or hide the source (each finalized segment's own source text above its translation in 即時翻譯, and the source text still being translated) and choose one of four text sizes; both choices SHALL be remembered in the browser. Source and translation text SHALL use one text size and weight. The source text still being translated and the draft translation SHALL share one highlight colour, distinct from finalized text. The source text still being translated SHALL be shown whole in an area of at most two lines, with its newest words visible and its oldest cut when it is longer, so that it only grows at its end while a segment is spoken. While the window shows any text, the area of the source text still being translated (with the source shown) and the draft SHALL each keep at least one line, also when empty, so that the segments above do not move each time a draft appears or goes. The top edge of the window's text SHALL fade out. Closing the window SHALL return the button to its closed state. In a browser without Document Picture-in-Picture the button SHALL be disabled with the reason 需要桌面版 Chrome 或 Edge 116 以上.

#### Scenario: Subtitles follow the translation

- **WHEN** the subtitles window is open and a new segment is translated
- **THEN** the window shows the new segment at the bottom below the earlier ones, the draft in the draft style, and the page's own translation is unchanged

#### Scenario: Earlier segments stay above

- **WHEN** five segments have been finalized and the window has room for all of them
- **THEN** the window shows all five in order, the first three dimmed, and with 原文 on each source above its translation in the same text size

#### Scenario: Showing the source

- **WHEN** the user turns on 原文 in the subtitles window and presses A+
- **THEN** the source appears above the translation, the text grows one size, and both settings are kept after the page reloads

#### Scenario: Current speech and its draft share a colour

- **WHEN** the source still being translated is 第二句還在講 and the draft is Second being
- **THEN** both are shown in the same highlight colour, distinct from the finalized translation

#### Scenario: Long current speech

- **WHEN** 原文 is on and the source still being translated is three sentences that take five lines
- **THEN** the area of the current speech is two lines high and its last words are visible

##### Example: Recent segments

| Finalized segments | Draft | Window shows (top to bottom) |
| --- | --- | --- |
| 大家好。／今天先看進度。／合約下週寄出。 | （無） | 大家好。（淡）、今天先看進度。、合約下週寄出。 |
| 大家好。 | 今天先 | 大家好。＋暫譯「今天先」 |


<!-- @trace
source: smooth-subtitles
updated: 2026-11-14
code:
  - webapp/review.py
  - bench/smooth_e2e.mjs
  - webapp/static/themes.css
  - chang01.png
  - bench/translate_e2e.mjs
  - bench/quality_e2e.mjs
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/static/quality-view.js
  - webapp/static/index.html
  - webapp/static/overlay.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - webapp/static/subtitles.css
  - bench/qualitycheck.js
  - webapp/revise_pass.py
  - bench/savecheck.js
  - webapp/static/app.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Screen view with subtitles

When the session's audio source includes the shared tab or screen (分頁／系統聲音 or 麥克風＋系統聲音), the live page SHALL offer 畫面＋字幕: an in-page full-window view showing the shared picture with a subtitle box laid over it. The box SHALL show a translation area holding the most recent finalized translation segments (at most three), each starting on its own line with the newest lowest, followed by the draft in a distinct style as the last of them, and, when its 原文 toggle is on (on by default, remembered in the browser for this view), a source area with the source text of the most recent finalized segments (at most two), each on its own line, followed, on its own line, by the source text still being translated. The source text still being translated and the draft SHALL each keep one line while empty. The source text still being translated and the draft translation SHALL share one highlight colour, distinct from the colour of finalized source and translation, so the reader can match what is being said to its translation. The source text, the finalized translation and the draft SHALL use one text size and weight. The box SHALL keep a fixed height while text arrives: the source area SHALL take two lines and the translation area three lines, whether empty or full (without the source area when 原文 is off), and the whole box SHALL be at most half the window height, also in a short window: the text size SHALL shrink with the window height (at most 5.5% of it) and nothing SHALL be drawn outside the box; when an area holds more than its lines, its newest text SHALL stay visible and the oldest be cut, so a long finalized translation never hides the source area or the draft. When a segment is finalized, its translation SHALL appear where its draft was and the finalized segments already shown SHALL stay where they are. The box SHALL share its text size with the floating subtitles window, SHALL have a background opacity slider from 20% to 100% (default 55%) that changes only the background, SHALL be draggable to any position, and the opacity, position and 原文 toggle SHALL be remembered in the browser. The view SHALL offer full screen and SHALL close on its close button or Esc. The shared picture SHALL be shown locally only: never recorded or sent to the server. Without a shared picture (microphone-only source, or no session) the button SHALL be disabled with the reason 需要分頁／系統聲音來源, and ending the session SHALL close the view.

#### Scenario: Subtitles over the shared tab

- **WHEN** a user starts with 分頁／系統聲音, presses 畫面＋字幕, sets the opacity slider to 30 and drags the subtitle box to the top of the picture
- **THEN** the shared picture fills the window with the subtitle box over it showing the previous segment's source above the page's latest translation, the box background is 30% opaque while the text is unchanged, and after closing and reopening the view the box is at the top with the same opacity

#### Scenario: Long translation stays subtitle-sized

- **WHEN** the latest translated segments and the draft together take more than three lines
- **THEN** the translation area shows three lines with its oldest words cut off, the draft and the source area stay visible, and the box is no taller than half the window

#### Scenario: The box keeps its height and one text size

- **WHEN** the box shows a long source, translation and draft and then the source Hello., the translation 你好。 and no draft
- **THEN** the box height is the same in both cases, and the source, translation and draft text have the same font size

#### Scenario: A short window

- **WHEN** the view is 1366×600 with the largest text size and 原文 on, and the box shows a long source, translation and draft
- **THEN** the box is no taller than half the window and the draft lies inside the box

#### Scenario: Current speech and its draft share a colour

- **WHEN** the previous segment's source is 第一句。, the source still being translated is 第二句還在講, the translation is First. and the draft is Second being
- **THEN** 第二句還在講 and Second being are shown in the same highlight colour, and 第一句。 and First. in the normal colour

#### Scenario: A segment is finalized in place

- **WHEN** the box shows the finalized segment First. and the draft Second being, and the segment is finalized as Second being here.
- **THEN** Second being here. is shown on the line where the draft was, in the normal colour, and First. is where it was

#### Scenario: Microphone-only session

- **WHEN** a user starts with 麥克風 as the only source
- **THEN** 畫面＋字幕 is disabled with the title 需要分頁／系統聲音來源

#### Scenario: Session ends

- **WHEN** the view is open and the user stops the session or the share is ended in the browser
- **THEN** the view closes and the button is disabled again

##### Example: Saved overlay settings

| localStorage.overlay | Box background | Box centre | 原文 |
| --- | --- | --- | --- |
| `{"opacity":30,"x":50,"y":12,"source":false}` | rgba(0,0,0,.3) | 50% across, 12% down | hidden |
| missing or invalid | rgba(0,0,0,.55) | 50% across, 88% down | shown |


<!-- @trace
source: smooth-subtitles
updated: 2026-11-14
code:
  - webapp/review.py
  - bench/smooth_e2e.mjs
  - webapp/static/themes.css
  - chang01.png
  - bench/translate_e2e.mjs
  - bench/quality_e2e.mjs
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/static/quality-view.js
  - webapp/static/index.html
  - webapp/static/overlay.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - webapp/static/subtitles.css
  - bench/qualitycheck.js
  - webapp/revise_pass.py
  - bench/savecheck.js
  - webapp/static/app.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Subtitle text moves smoothly

In the floating subtitles window and in the subtitle box of 畫面＋字幕, when arriving text moves a segment that is already shown to another place, the segment SHALL glide there from where it was: in about a quarter of a second, longer for a longer way (6 ms per px, at most 0.7 s). A segment finalized just now SHALL start where its draft was, and a segment whose text was replaced SHALL start where the replaced one was. When the source text still being translated or the draft gets another line, the lines already shown SHALL glide up inside its area and the new line SHALL come in from below without covering the text under it. Text whose own wording is replaced MAY change at once. A change of the 原文 toggle or the text size MAY move text at once. When the system asks for reduced motion (`prefers-reduced-motion: reduce`) text SHALL move at once.

#### Scenario: A new line of draft

- **WHEN** the floating window is full and the draft grows from one line to two
- **THEN** the segments above move up by one line over about 250 ms, in steps of at most 12 px per frame, and the draft's first line glides up as its second line comes in from below

#### Scenario: Reduced motion

- **WHEN** the system setting for reduced motion is on and the draft grows from one line to two
- **THEN** the segments above are one line higher in the next frame


<!-- @trace
source: smooth-subtitles
updated: 2026-11-14
code:
  - webapp/review.py
  - bench/smooth_e2e.mjs
  - webapp/static/themes.css
  - chang01.png
  - bench/translate_e2e.mjs
  - bench/quality_e2e.mjs
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/static/quality-view.js
  - webapp/static/index.html
  - webapp/static/overlay.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - webapp/static/subtitles.css
  - bench/qualitycheck.js
  - webapp/revise_pass.py
  - bench/savecheck.js
  - webapp/static/app.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: A draft continues the draft already shown

When the page asks for a draft translation of speech that begins with the speech of its previous draft request, the request SHALL carry the draft currently shown as `previous_draft`; otherwise it SHALL carry none. For a draft request with a `previous_draft` the gateway SHALL tell the text model that this text is already shown to the reader for the beginning of the speech, and that it is to keep that wording for the part it covers unless it is wrong and add the translation of the rest. A request for a finalized translation SHALL NOT use `previous_draft`, and a draft request without one SHALL be the same as before.

#### Scenario: The speech grew

- **WHEN** the draft `所以這有點取決於` is shown for `So it kind of depends` and the next draft request is for `So it kind of depends on what your definition of scale is`
- **THEN** the request carries `previous_draft` `所以這有點取決於` and the text model's instructions contain that text

#### Scenario: A new segment

- **WHEN** a segment was finalized and the first draft of the next segment is requested
- **THEN** the request carries no `previous_draft`

#### Scenario: A finalized translation

- **WHEN** a request with `draft` false carries a `previous_draft`
- **THEN** the text model's instructions do not contain it


<!-- @trace
source: smooth-subtitles
updated: 2026-11-14
code:
  - webapp/review.py
  - bench/smooth_e2e.mjs
  - webapp/static/themes.css
  - chang01.png
  - bench/translate_e2e.mjs
  - bench/quality_e2e.mjs
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/static/quality-view.js
  - webapp/static/index.html
  - webapp/static/overlay.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - webapp/static/subtitles.css
  - bench/qualitycheck.js
  - webapp/revise_pass.py
  - bench/savecheck.js
  - webapp/static/app.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: The panes follow the newest text smoothly

While a pane of the live page (原始逐字稿 or the translation) is following its newest text, new text SHALL be brought into view with a smooth scroll; with reduced motion asked for by the system, at once. A pane SHALL follow from the start; after the user scrolls it with the wheel, touch, keyboard or mouse, it SHALL follow only while its view is within 72 px of its end, and SHALL NOT move while the user reads earlier text.

#### Scenario: Following

- **WHEN** a pane is at its end and three more lines of text arrive
- **THEN** the pane scrolls to its new end with a smooth scroll

#### Scenario: Reading earlier text

- **WHEN** the user has scrolled a pane 300 px up from its end and new text arrives
- **THEN** the pane's scroll position stays the same

#### Scenario: Back at the end

- **WHEN** the user scrolls the pane back to within 72 px of its end and new text arrives
- **THEN** the pane follows again


<!-- @trace
source: smooth-subtitles
updated: 2026-11-14
code:
  - webapp/review.py
  - bench/smooth_e2e.mjs
  - webapp/static/themes.css
  - chang01.png
  - bench/translate_e2e.mjs
  - bench/quality_e2e.mjs
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/static/quality-view.js
  - webapp/static/index.html
  - webapp/static/overlay.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - webapp/static/subtitles.css
  - bench/qualitycheck.js
  - webapp/revise_pass.py
  - bench/savecheck.js
  - webapp/static/app.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: The unsettled end of a draft is shown lighter

Wherever a draft translation is shown (the translation pane, the floating subtitles window, the subtitle box of 畫面＋字幕), its end SHALL be drawn lighter than the rest of the draft, in the same colour and size. The lighter end SHALL be the part that differs from the draft shown before it for the same speech, and at least the last 4 and at most the last 12 characters for Chinese and Japanese text, or at least the last 2 and at most the last 5 words for text in words. The text of the draft itself SHALL NOT change.

#### Scenario: A draft grows

- **WHEN** the draft `所以這有點取決於` is followed by `所以這有點取決於你對大規模的定義是什麼`
- **THEN** `所以這有點取決於` is drawn in the draft colour and `你對大規模的定義是什麼` lighter

##### Example: the lighter end

| Draft before | Draft | Lighter end |
| ------------ | ----- | ----------- |
| （none） | 所以這有點取決於 | 所以這有點取決於 |
| 所以這有點取決於 | 所以這有點取決於你對大規模的定義是什麼 | 你對大規模的定義是什麼 |
| So we decided to | So we decided to start next month with the new plan | month with the new plan |
| Hello there friend | Hello there friend | there friend |

<!-- @trace
source: smooth-subtitles
updated: 2026-11-14
code:
  - webapp/review.py
  - bench/smooth_e2e.mjs
  - webapp/static/themes.css
  - chang01.png
  - bench/translate_e2e.mjs
  - bench/quality_e2e.mjs
  - webapp/static/overlay.js
  - webapp/static/subtitles.js
  - webapp/static/quality-view.js
  - webapp/static/index.html
  - webapp/static/overlay.css
  - bench/README.md
  - README.md
  - webapp/server.py
  - webapp/static/subtitles.css
  - bench/qualitycheck.js
  - webapp/revise_pass.py
  - bench/savecheck.js
  - webapp/static/app.js
tests:
  - webapp/test_server.py
-->