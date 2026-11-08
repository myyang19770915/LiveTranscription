## Why

使用者附上一張「Speaker Activity」介面（說話者卡片：名字＋角色；下方每位說話者一條軌道，畫出每次發言的位置），要求校對頁做出同樣的區分功能，而且點每一段都能播放聲音，並動態顯示對應的文字。

目前（speaker-diarization）校對頁只有說話者名字標籤與段落選單，看不出「誰在什麼時候講了多久」；MOSS 的逐句發言（時間、說話者、文字）已存在 `diarizations.turns`，但頁面沒有用到。

## What Changes

- 校對頁說話者區塊改為「發言時間軸」：
  - 說話者卡片：顏色點、名字、角色說明（例如「主持人」；未填時顯示發言段數與發言總時間）。點卡片選取該說話者（軌道加亮、其他變淡），並在卡片下方開啟編輯：團隊成員或自填名字，加上角色（最多 40 字）。
  - 每位說話者一條軌道（標籤 S1、S2…，與卡片同色），依整場錄音長度畫出 MOSS 偵測到的每次發言；滑鼠移上去顯示時間與文字。標題列右側顯示錄音總長與說話者人數。
  - 點任一段發言：從那段開始連續播放錄音（分段載入，最多每次 5 分鐘），時間軸上出現播放線；下方「正在播放」區塊顯示目前說話者、時間與那句話，文字依播放進度逐字加亮（MOSS 只給整句時間，進度依時間比例估計）；播到下一句自動切換；正在講的發言條加亮；逐字稿中對應時間的段落也加亮並捲動到可見處。有暫停／繼續按鈕，空白鍵在時間軸有焦點時也可暫停。播放段落列的錄音時，時間軸播放會停止，反之亦然。
- `GET /api/meetings/{id}/speakers` 增加 `turns`（每句發言 `[startMs, endMs, label, text]`，中文轉繁體）與 `durationMs`；說話者增加 `note`（角色）與 `turnMs`（發言總毫秒）。
- `PUT /api/meetings/{id}/speakers/{label}` 接受 `note`（最多 40 字）。資料表 `meeting_speakers` 新增 `note` 欄（migration 013）。
- 手動新增的說話者沒有發言條（軌道空白），只用於段落指定。

## Non-Goals (optional)

- 不提供拖曳修改發言邊界、合併或拆分發言（發言條是辨識結果，只供瀏覽與播放）。
- 不做時間軸縮放；長會議以整場比例顯示，發言條至少 2 px。
- 不做逐字精確對齊（MOSS 沒有逐字時間）。
- 不改搜尋、問答、紀要。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `speaker-diarization`: 新增發言時間軸與播放；說話者可填角色。

## Impact

- webapp/migrations/013_speaker_notes.sql、webapp/diarize.py（turns／durationMs／note／turnMs）、webapp/static/speakers.js、webapp/static/speakers.css、webapp/static/review.js（播放互斥、段落加亮）、webapp/static/review.html（版本號）、webapp/test_server.py、bench/speakers_e2e.mjs、README.md。
