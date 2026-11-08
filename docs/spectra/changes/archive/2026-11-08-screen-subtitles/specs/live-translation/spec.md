## ADDED Requirements

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
