## MODIFIED Requirements

### Requirement: Interpret mode on the live page

The live page SHALL offer the modes 開會, 即時翻譯 and 即時口譯. When `allowed` is false the 即時口譯 button SHALL be disabled and the mode note SHALL read 需要申請權限，請聯絡系統管理員; when `configured` is false it SHALL be disabled with 即時口譯尚未設定，請聯絡系統管理員; a remembered 即時口譯 mode that cannot be used SHALL open as 即時翻譯. In 即時口譯 mode the page SHALL hide the team, topic and series fields, 會議情境, 雲端精修 and 精準模式, SHALL disable 中日雙向 and the direction swap, SHALL offer as output languages the `targets` of `/api/interpret/config`, SHALL show the checkbox 同步播放譯音 in the same row as the start button, and the start button SHALL read 開始口譯 with the note 聽譯音、看譯文 on one line. The empty transcript SHALL name the start button of the current mode (開始會議, 開始翻譯 or 開始口譯). A running session SHALL send the captured audio at 24 kHz to `/ws/interpret` and at 16 kHz to `/ws/transcribe` with `mode: "interpret"` and an empty `system_prompt`, SHALL NOT request text translations, SHALL show the recognized text in 原始逐字稿 and the interpreted text in the translation pane, and the floating subtitles and 畫面＋字幕 SHALL show the interpreted text as their translation (the last two finished sentences and the unfinished rest as the draft) and the recognized text as their source. When the session ends and is saved the page SHALL show 已存檔 with a link 在我的紀錄開啟 to `/interpret?id=<id>`. 匯出逐字稿 SHALL export the source and the interpreted text.

#### Scenario: A member without access

- **WHEN** member bob, not granted, opens the live page
- **THEN** 即時口譯 is shown disabled with 需要申請權限，請聯絡系統管理員, and 開會 and 即時翻譯 work as before

#### Scenario: Interpreting a video into English

- **WHEN** alice, granted, chooses 即時口譯, 分頁／系統聲音 and English, and presses 開始口譯
- **THEN** 原始逐字稿 shows the recognized speech, the translation pane and the floating subtitles show the interpreted English, no request goes to `/api/translate/stream`, and after 停止 the page shows 已存檔 with 在我的紀錄開啟

#### Scenario: The settings of 即時口譯

- **WHEN** a granted user at 1440 px wide switches to 即時口譯
- **THEN** 會議情境 is not shown, 同步播放譯音 and 開始口譯 are in one row, and the empty transcript reads 點擊「開始口譯」
