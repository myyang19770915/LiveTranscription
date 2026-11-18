## Context

「我的紀錄」（`webapp/interpret.py`）每筆是 `output/interpret/<username>/<id>/` 資料夾：`session.json`（`kind`、`sourceLang`、`target`、`engine`、`startedAt`、`inputSeconds`、`sourceText`、`translation`）、`input.wav`（即時翻譯 16 kHz、即時口譯 24 kHz）、`output.wav`（只有口譯）、`bars.json`、`transcript.txt`。文字是整段，沒有逐句時間。

會議（`meetings`、`segments` 資料表）的段落需要 `seq`、`start_ms`、`end_ms`、`asr_text`、`source`、`live_target`、`target`、`detected`，錄音是 `team_access.meeting_dir(meeting)/audio.wav`（16 kHz 單聲道 PCM16），`meetings.audio_bytes` 記錄長度。

即時翻譯頁面本來就有逐句資料（`app.js` 的 `segmentRecords`：`startMs`、`endMs`、`source`、`target`、`detected`），時間軸就是送給辨識的 16 kHz 音訊，與紀錄的 `input.wav` 相同。精準模式（`quality_pass.QualityPass`）吃 16 kHz PCM，送出 `{"sentences": [{"src","tgt","lang","startMs","endMs"}], "throughMs", "final"}`，失敗的片段送 `{"failed": true}`。

## Goals / Non-Goals

**Goals:**

- 一鍵把本人的一筆紀錄轉成所選團隊的會議，含逐句原文、譯文、錄音。
- 即時翻譯紀錄保存逐句資料，轉換時直接使用。
- 沒有逐句資料的紀錄（即時口譯、舊的即時翻譯）以精準模式整段重跑產生段落。
- 原紀錄保留並標示已轉換，不能重複轉換。

**Non-Goals:**

- 不轉回、不合併紀錄；不帶入口譯譯音；不設定系列與詞彙表。
- 不在伺服器重啟後接續未完成的轉換（重新按一次即可）。

## Decisions

### 即時翻譯紀錄保存逐句資料

`PUT /api/interpret/live/{token}/translation` 與 `PUT /api/interpret/sessions/{sid}/translation` 的內容多一個選填的 `segments`：`[{startMs, endMs, source, target, detected}]`，最多 5000 句，每句文字最多 2000 字，時間為非負整數且 `endMs >= startMs`；不合格回 422。存進 `session.json` 的 `segments`。`app.js` 送出的是已定稿的句子（與會議保存段落用的 `outputRecords()` 相同來源）。沒有 `segments` 的請求照舊只存文字。

### 轉換方式依有無逐句資料

- 有 `segments`：直接成為會議段落（`asr_text` 與 `source` 都是原文，`live_target` 與 `target` 都是譯文），立即完成。
- 沒有：`webapp/record_meeting.py` 讀 `input.wav`（24 kHz 先轉 16 kHz：每 3 個樣本取前 2 個，不另做濾波），以 `QualityPass(collect, sourceLang, target, glossary="", engine="api")` 處理：錄音已經存在，不需要即時聽寫的模型，所以所有語言都由轉錄 API（Qwen3-ASR，`TRANSLATE_QUALITY_ASR_MODEL`）辨識，不使用 MAI；斷句、修正與翻譯照精準模式原本的文字模型。音訊盡快餵入（處理完一段再餵下一段）。收集所有 `sentences`；任何片段 `failed` 時整次轉換失敗，不建立會議，顯示「部分內容處理失敗，請再試一次」。轉錄 API 或文字模型未設定（`quality_pass.URL`、`MODEL`、`ASR_MODEL` 任一為空）時這類紀錄不能轉換。精準模式只支援原文 zh、yue、auto、en、ja、zh_ja 與譯文 zh、en、ja（`quality_pass.NAMES`），其他語言的這類紀錄不能轉換並說明原因（422）。

### 轉換完成時才建立會議

所有段落準備好後，在一個交易中建立 `meetings`（`team_id`、`created_by`、`title`、`language`=`sourceLang`、`engine`=紀錄的引擎、`source_language`、`target_language`、`started_at`=紀錄開始時間、`ended_at`、`audio_bytes`）與 `segments`，錄音寫到 `meeting_dir/audio.wav`；完成後呼叫 `diarize.recording_closed`。中途失敗不留下半個會議。之後在 `session.json` 寫入 `meetingId`。

### API

- `POST /api/interpret/sessions/{sid}/meeting`，內容 `{team_id, title}`：使用者必須是該團隊成員（否則 404）；已轉換回 409 並附 `meetingId`；同一筆正在轉換回 409；有逐句資料時回 200 `{meetingId}`；需要精準模式時回 202 `{state: "running"}`；精準模式未設定回 503。標題空白時用「即時翻譯 2026-11-18 14:03」或「即時口譯 …」。
- `GET /api/interpret/sessions/{sid}/meeting`：`{state: "none"|"running"|"done"|"failed", meetingId?, doneMs?, totalMs?, error?}`。轉換狀態存在記憶體；伺服器重啟後 `running` 變回 `none`。
- `GET /api/interpret/sessions` 每筆多 `meetingId`（已轉換時）與 `segments`（是否有逐句資料，布林）。
- 每位使用者同時最多一個轉換，全站同時最多 2 個；超過回 429。

### 我的紀錄畫面

列表每筆有「轉成會議紀錄」（重新整理後列表仍帶著轉換狀態：`GET /api/interpret/sessions` 每筆的 `conversion`）。按下開啟對話框：團隊（本人的團隊）、標題；需要精準模式的紀錄另外註明「會用精準模式重新辨識與翻譯，音訊與文字會傳送到外部服務，約需 N 分鐘」（N 依錄音長度估算，約錄音長度的 1/2：2026-11-18 實測 98.6 秒的即時口譯紀錄 41.7 秒完成，含回顧修訂）。轉換中顯示進度（已處理 mm:ss／總長），每 2 秒查詢一次；完成後顯示「已轉成會議紀錄・開啟」連到 `/meetings/<id>`。已轉換的紀錄在列表顯示「已轉成會議紀錄」，按鈕改為開啟會議。

### 錄音逐秒處理，不整段放進記憶體

錄音每次讀 1 秒（`wave.readframes(rate)`，24 kHz 時仍是 3 個樣本的倍數），轉成 16 kHz 後寫進紀錄資料夾裡的暫存檔 `.meeting-audio.wav`（`meeting_audio.MeetingAudio`），需要精準模式時同一秒也送進 `QualityPass.feed`。會議建立時把暫存檔搬到 `meeting_dir/audio.wav`；失敗或取消時刪除暫存檔。4 小時的口譯紀錄因此不會在記憶體裡保留數 GB。

### 最後一段沒有逐句資料時提醒

即時翻譯每 30 秒送一次逐句資料；最後一次沒送到時，最後一句的 `endMs` 比錄音長度短超過 35 秒。列表每筆帶 `missingTailMs`，對話框註明「最後約 N 秒當時沒有存到逐句資料，會議裡這段只有錄音」。

## Implementation Contract

- 行為：本人在我的紀錄按「轉成會議紀錄」、選團隊後得到該團隊的一場會議，段落、錄音與紀錄一致，可在逐字稿校對播放；原紀錄保留並標示已轉換。
- 介面：見「API」；`session.json` 新增選填欄位 `segments`、`meetingId`；`record_meeting.convert(username, folder, team_id, title, job)`（`job` 是進度 dict：`totalMs`、`doneMs`）；同一筆紀錄的請求處理中時以 `record_meeting.CLAIMED` 擋下第二個請求（409）；`segments` 為空清單時視為沒有逐句資料。
- 失敗情形：非成員 404；已轉換或轉換中 409；並行上限 429；精準模式未設定 503；片段失敗整次失敗、不建立會議；紀錄被刪除時轉換中止。
- 驗收：`test_server` 新增測試（逐句資料驗證、直接轉換的段落與錄音、重複轉換 409、非成員 404、以假的 QualityPass 跑精準模式路徑含 24→16 kHz 與失敗不建會議、列表欄位）；`bench/record_meeting_e2e.mjs`（不花費：用有逐句資料的紀錄）；精準模式實際跑一筆短紀錄並回報花費。
- 範圍：只動上面列出的檔案與新增檔；`QualityPass` 只加 `engine` 參數，不改精準模式本身的演算法、不改會議頁。

## Risks / Trade-offs

- 長錄音需要數分鐘：畫面先告知估計時間，可離開頁面，回來時仍看得到進度（伺服器未重啟時）。
- `QualityPass` 新增選填參數 `engine`（預設照 `TRANSLATE_QUALITY_ASR` 設定），會議即時的精準模式不受影響。
- 精準模式的原文與當時即時看到的不同（通常更準）：這是使用者的選擇。
- 24→16 kHz 簡化重新取樣可能有少量混疊，對辨識影響小；不引入新套件。
- 轉換狀態只在記憶體：重啟後需重按，不會有半個會議。
