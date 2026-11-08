## Context

speaker-diarization 已把 MOSS 的逐句發言存在 `diarizations.turns`（`[start_ms, end_ms, label, text]`，中文為簡體），校對頁只用到說話者清單與段落選單。錄音以 `GET /api/meetings/{id}/audio?start&end` 取區間 WAV（單次最多 10 分鐘）。段落列的播放由 review.js 的 `#player` 與 `clip` 狀態管理。使用者提供的參考圖：深色卡片列（名字＋角色、選取時亮框），下方 S1/S2/S3 彩色標籤與圓角發言條。

## Goals / Non-Goals

**Goals:**

- 一眼看出誰在何時發言、講多久；點發言就聽，文字跟著播放動態顯示。
- 說話者可填角色。

**Non-Goals:**

- 編輯發言邊界、縮放時間軸、逐字精確對齊、改搜尋／問答／紀要。

## Decisions

### 時間軸放在既有的說話者區塊，資料隨 speakers API 一起回傳

不另開 API：`GET …/speakers` 在辨識完成時多回 `turns`（繁體）與 `durationMs`，頁面一次拿到。一小時會議約 800 句、50 KB，可接受。排隊／辨識中輪詢時 turns 為上一次完成的結果（重新辨識前仍可瀏覽）。替代方案：獨立 `/turns` 端點（多一次請求，沒有好處）。

### 時間軸播放用獨立的 Audio 物件，分段連續載入

時間軸播放需要「從某句開始一直播下去」，和段落列「只播這一段」不同，所以 speakers.js 用自己的 `Audio`，每次載入 5 分鐘，播完自動載入下一段；兩邊播放互斥（review.js 開始播放時呼叫 `Speakers.stop()`，時間軸開始時暫停 `#player`）。播放位置以 `timeupdate` 加 `requestAnimationFrame` 更新播放線與文字進度。替代方案：共用 `#player`（要改寫 review.js 的 clip 狀態機，風險較大）。

### 文字進度依時間比例估計

MOSS 只給整句起訖時間，文字加亮長度 = 句長 × (播放位置 − 起點) ÷ (終點 − 起點)。對話速度大致均勻，已足夠讓人跟上；不另外做強制對齊。

### 逐字稿對應段落以時間決定

播放位置 t 時，加亮「起點 − 3 秒 ≤ t ≤ 終點」的最後一個段落（段落時間比語音晚，與段落播放的前移 3 秒一致），並以 `scrollIntoView({block:'nearest'})` 捲到可見，不打斷正在編輯的段落（有編輯中的段落時不捲動）。

### 角色存在 meeting_speakers.note

新 migration `013_speaker_notes.sql`：`ALTER TABLE meeting_speakers ADD COLUMN note text NOT NULL DEFAULT ''`。重新辨識會一併清除（整列刪除重建，沿用既有行為）。

### 發言條的畫法

每條軌道 `position:relative`，發言條 `position:absolute`，`left/width` 用百分比（最小 2 px），高 10 px、圓角 5 px、顏色用 `--spk-N`；軌道底色為 `--border`。發言條是 `<button>`（可聚焦、可按 Enter），`title` 帶時間與文字。軌道標籤 S1、S2 用同色文字。選取的說話者其他軌道降低不透明度。

## Implementation Contract

**API**

- `GET /api/meetings/{id}/speakers` 增加：`turns: [[startMs, endMs, label, text], …]`（diarization 有完成過的結果時；中文以 OpenCC s2tw 轉繁體；沒有則 `[]`）、`durationMs`（`team_access.recorded_ms(meeting, False)`）；每位說話者增加 `note`、`turnMs`（該 label 所有 turn 的 end−start 總和）。
- `PUT /api/meetings/{id}/speakers/{label}` body 增加 `note: str ≤ 40`（省略時不變）；超過 40 字 422。
- 資料表：`meeting_speakers.note text NOT NULL DEFAULT ''`。

**頁面（speakers.js／speakers.css／review.js）**

- 區塊標題「發言時間軸」，右側「錄音 mm:ss · N 位說話者」。狀態文字與「辨識說話者／重新辨識」按鈕保留。
- 卡片：`.spk-card`（點選 → `selected` 並開啟編輯表單：成員／自填名字、角色輸入、儲存、取消）。第二行為角色，沒有角色時為「N 段 · 發言 mm:ss」。
- 軌道：`.spk-lanes` 內每位說話者 `.spk-lane`（標籤 `S<label>` ＋ `.spk-track`，其中 `.spk-turn` 按鈕）。`.spk-playhead` 為播放線。
- 正在播放：`.spk-now`（說話者點、名字、時間、文字；文字分成 `.said` 與其餘兩段）＋暫停／繼續按鈕。未播放時顯示「點時間軸上的發言即可從那裡播放」。
- `Speakers.stop()` 供 review.js 在段落播放開始時呼叫；時間軸開始播放時呼叫 review.js 的 `$('player').pause()`。
- 對應段落加 `.speaking` 類別。

**失敗處理**：音訊載入失敗以 `notice()` 顯示訊息並停止播放；沒有 turns（舊資料或辨識未完成）時不顯示軌道與播放區，只顯示卡片。

**驗收**

- 單元測試：speakers API 回傳 turns（繁體轉換，表格範例兩列）、durationMs、turnMs、note；note 41 字 422；重新辨識清除 note。
- `bench/speakers_e2e.mjs`（真實服務）：軌道數＝說話者數（不含手動新增者）、第一條發言條位置與 turns 比例一致、點發言條後音訊播放且播放線前進、正在播放區顯示該句說話者與文字並有加亮部分、對應段落 `.speaking`、暫停鍵有效、段落播放會停止時間軸播放、角色儲存後卡片顯示、400 px 不溢出。

**範圍**：只動上列檔案。

## Risks / Trade-offs

- [長會議發言條很密] → 以整場比例顯示並保留 hover 文字；縮放列為之後再做。
- [文字進度是估計] → 文件與畫面說明「依時間估計」；整句仍完整顯示。
- [MOSS 文字與校對後逐字稿不同] → 正在播放區顯示 MOSS 該句文字，逐字稿段落另外加亮，兩者並存。
