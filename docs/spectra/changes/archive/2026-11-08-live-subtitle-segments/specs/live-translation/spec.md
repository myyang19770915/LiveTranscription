## MODIFIED Requirements

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

### Requirement: Floating subtitles window

The live page SHALL offer 浮動字幕: a separate always-on-top window (Document Picture-in-Picture) that the user can move and resize, showing the last two finalized translation segments and the current draft translation in a distinct style, kept in step with the page's translation. The window SHALL let the user show or hide a source line (the previous finalized segment's source text followed by the source text still being translated) and choose one of four text sizes; both choices SHALL be remembered in the browser. The source text still being translated and the draft translation SHALL share one highlight colour, distinct from finalized text. Closing the window SHALL return the button to its closed state. In a browser without Document Picture-in-Picture the button SHALL be disabled with the reason 需要桌面版 Chrome 或 Edge 116 以上.

#### Scenario: Subtitles follow the translation

- **WHEN** the subtitles window is open and a new segment is translated
- **THEN** the window shows the last two finalized segments, the draft in the draft style, and the page's own translation is unchanged

#### Scenario: Showing the source

- **WHEN** the user turns on 原文 in the subtitles window and presses A+
- **THEN** the source line appears above the translation, the text grows one size, and both settings are kept after the page reloads

#### Scenario: Current speech and its draft share a colour

- **WHEN** the source still being translated is 第二句還在講 and the draft is Second being
- **THEN** both are shown in the same highlight colour, distinct from the finalized translation

##### Example: Last two segments

| Finalized segments | Draft | Window shows |
| --- | --- | --- |
| 大家好。／今天先看進度。／合約下週寄出。 | （無） | 今天先看進度。 合約下週寄出。 |
| 大家好。 | 今天先 | 大家好。＋暫譯「今天先」 |

### Requirement: Screen view with subtitles

When the session's audio source includes the shared tab or screen (分頁／系統聲音 or 麥克風＋系統聲音), the live page SHALL offer 畫面＋字幕: an in-page full-window view showing the shared picture with a subtitle box laid over it. The box SHALL show the last two finalized translation segments and the draft in a distinct style, and, when its 原文 toggle is on (on by default, remembered in the browser for this view), a source line with the previous finalized segment's source text followed by the source text still being translated. The source text still being translated and the draft translation SHALL share one highlight colour, distinct from the colour of finalized source and translation, so the reader can match what is being said to its translation. Each part of the box (source line, finalized translation, draft) SHALL be at most two lines of its own text size and the whole box at most half the window height; when a part is longer, its newest text SHALL stay visible and the oldest be cut, so a long finalized translation never hides the source line or the draft. The box SHALL share its text size with the floating subtitles window, SHALL have a background opacity slider from 20% to 100% (default 55%) that changes only the background, SHALL be draggable to any position, and the opacity, position and 原文 toggle SHALL be remembered in the browser. The view SHALL offer full screen and SHALL close on its close button or Esc. The shared picture SHALL be shown locally only: never recorded or sent to the server. Without a shared picture (microphone-only source, or no session) the button SHALL be disabled with the reason 需要分頁／系統聲音來源, and ending the session SHALL close the view.

#### Scenario: Subtitles over the shared tab

- **WHEN** a user starts with 分頁／系統聲音, presses 畫面＋字幕, sets the opacity slider to 30 and drags the subtitle box to the top of the picture
- **THEN** the shared picture fills the window with the subtitle box over it showing the previous segment's source above the page's latest translation, the box background is 30% opaque while the text is unchanged, and after closing and reopening the view the box is at the top with the same opacity

#### Scenario: Long translation stays subtitle-sized

- **WHEN** the two latest translated segments and the draft together take more than four lines
- **THEN** the finalized translation shows at most two lines with its oldest words cut off, the source line and the draft stay visible, and the box is no taller than half the window

#### Scenario: Current speech and its draft share a colour

- **WHEN** the previous segment's source is 第一句。, the source still being translated is 第二句還在講, the translation is First. and the draft is Second being
- **THEN** 第二句還在講 and Second being are shown in the same highlight colour, and 第一句。 and First. in the normal colour

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
