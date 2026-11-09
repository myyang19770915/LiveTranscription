## MODIFIED Requirements

### Requirement: Screen view with subtitles

When the session's audio source includes the shared tab or screen (分頁／系統聲音 or 麥克風＋系統聲音), the live page SHALL offer 畫面＋字幕: an in-page full-window view showing the shared picture with a subtitle box laid over it. The box SHALL show the last two finalized translation segments and the draft in a distinct style, and, when its 原文 toggle is on (on by default, remembered in the browser for this view), a source line with the previous finalized segment's source text followed by the source text still being translated. The source text still being translated and the draft translation SHALL share one highlight colour, distinct from the colour of finalized source and translation, so the reader can match what is being said to its translation. The source line, the finalized translation and the draft SHALL use one text size and weight. The box SHALL keep a fixed height while text arrives: the source line SHALL take two lines, the finalized translation two lines and the draft one line, whether empty or full (without the source line when 原文 is off), and the whole box SHALL be at most half the window height, also in a short window: the text size SHALL shrink with the window height (at most 5.5% of it) and nothing SHALL be drawn outside the box; when a part is longer, its newest text SHALL stay visible and the oldest be cut, so a long finalized translation never hides the source line or the draft. The box SHALL share its text size with the floating subtitles window, SHALL have a background opacity slider from 20% to 100% (default 55%) that changes only the background, SHALL be draggable to any position, and the opacity, position and 原文 toggle SHALL be remembered in the browser. The view SHALL offer full screen and SHALL close on its close button or Esc. The shared picture SHALL be shown locally only: never recorded or sent to the server. Without a shared picture (microphone-only source, or no session) the button SHALL be disabled with the reason 需要分頁／系統聲音來源, and ending the session SHALL close the view.

#### Scenario: Subtitles over the shared tab

- **WHEN** a user starts with 分頁／系統聲音, presses 畫面＋字幕, sets the opacity slider to 30 and drags the subtitle box to the top of the picture
- **THEN** the shared picture fills the window with the subtitle box over it showing the previous segment's source above the page's latest translation, the box background is 30% opaque while the text is unchanged, and after closing and reopening the view the box is at the top with the same opacity

#### Scenario: Long translation stays subtitle-sized

- **WHEN** the two latest translated segments and the draft together take more than four lines
- **THEN** the finalized translation shows at most two lines with its oldest words cut off, the source line and the draft stay visible, and the box is no taller than half the window

#### Scenario: The box keeps its height and one text size

- **WHEN** the box shows a long source, translation and draft and then the source Hello., the translation 你好。 and no draft
- **THEN** the box height is the same in both cases, and the source, translation and draft text have the same font size

#### Scenario: A short window

- **WHEN** the view is 1366×600 with the largest text size and 原文 on, and the box shows a long source, translation and draft
- **THEN** the box is no taller than half the window and the draft line lies inside the box

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
