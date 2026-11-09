## MODIFIED Requirements

### Requirement: Floating subtitles window

The live page SHALL offer 浮動字幕: a separate always-on-top window (Document Picture-in-Picture) that the user can move and resize, showing the recent finalized translation segments (up to 30; in 開會 the recent translated sentences) from the top down with the newest at the bottom, as many as the window has room for, followed by the current draft translation in a distinct style, kept in step with the page's translation. Segments other than the newest two SHALL be dimmed. The window SHALL let the user show or hide the source (each finalized segment's own source text above its translation in 即時翻譯, and the source text still being translated) and choose one of four text sizes; both choices SHALL be remembered in the browser. Source and translation text SHALL use one text size and weight. The source text still being translated and the draft translation SHALL share one highlight colour, distinct from finalized text. Closing the window SHALL return the button to its closed state. In a browser without Document Picture-in-Picture the button SHALL be disabled with the reason 需要桌面版 Chrome 或 Edge 116 以上.

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

##### Example: Recent segments

| Finalized segments | Draft | Window shows (top to bottom) |
| --- | --- | --- |
| 大家好。／今天先看進度。／合約下週寄出。 | （無） | 大家好。（淡）、今天先看進度。、合約下週寄出。 |
| 大家好。 | 今天先 | 大家好。＋暫譯「今天先」 |
