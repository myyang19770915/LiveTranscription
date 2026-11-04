## Context

會議中的翻譯段落（`webapp/static/app.js` 的 `segmentRecords`）只有字元位置 `start`／`end`、原文 `source`、譯文 `target`、偵測語言 `detected`；ASR（Confucius 的 `ws_server.py` 與 MAI）送回的事件都不帶時間。錄音是瀏覽器 MediaRecorder 的混音 webm，與送往 ASR 的 PCM 不是同一條路徑，時間起點也不同。

兩種辨識引擎在 gateway 都會呼叫共用的 `TranscriptDisplay.annotate(payload)` 再送給瀏覽器（本機路徑在 `transcribe()` 的 `asr_to_browser`，MAI 路徑在 `MaiBridge.emit`）；音訊則分別在 `transcribe()` 的 `browser_to_asr` 與 `MaiBridge.browser_to_mai` 收進來。

即時精修的請求由 `app.js` 的 `correctNext()` 組裝：同方向的前兩段原文與譯文作 history、下一段前 120 字作 following、會議詞彙、自動學習詞彙、雲端精修開關；結果經 `plausibleRefinement()` 檢查才採用。`bench/guardcheck.js` 以正規表示式從 app.js 擷取 `plausibleRefinement` 來測試。

前置變更 `team-accounts` 提供：登入、團隊、`meetings` 表（含 `team_id`）、`team_access.require_member`、會議檔案目錄 `output/teams/<team_id>/<meeting_id>/`、WebSocket 首包的 `meeting_id`。

## Goals / Non-Goals

**Goals:**

- 錄音與轉錄共用時間軸，任何段落都能播放原音
- 段落、詞彙與修改紀錄保存在 Postgres
- 校對頁修改轉錄後，以與即時精修相同的策略重譯
- 匯出可直接用於 ASR 微調的資料

**Non-Goals:**

- 說話者辨識（roadmap P5）
- 字詞層級的強制對齊；段落邊界以事件到達時間估計，播放時以前後延伸補償
- 調整段落邊界、合併或拆分段落
- 直接修改譯文（只改轉錄、由系統重譯；使用者 2026-11-04 表示通常只改轉錄）
- 舊會議（本變更前）的段落補建
- 微調訓練本身

## Decisions

### 伺服器端錄音寫入 WAV

新增 `webapp/meeting_audio.py` 的 `MeetingAudio`：開檔時先寫 44 bytes 的 WAV header（長度欄位暫填 0），之後逐段附加 PCM，結束時回填長度。`read_range(start_ms, end_ms)` 依位元組位移切出區間並加上 header 回傳。讀取時若 header 長度為 0 或與檔案大小不符，依檔案大小修正（app 中途停止的情況）。

替代方案：沿用瀏覽器 webm。它與 ASR 收到的音訊時間起點不同、且需要解碼才能切段；伺服器端 WAV 與 ASR 輸入完全一致，切段只是位移計算。代價是檔案較大（32 KB/s，計算值），之後可另加壓縮。

### 兩種引擎共用錄音與 audioMs

`TranscriptDisplay` 新增可選的 `audio: MeetingAudio`；`transcribe()` 的 `browser_to_asr` 與 `MaiBridge.browser_to_mai` 收到 bytes 時呼叫 `display.audio.write(bytes)`；`annotate(payload)` 在 payload 加上 `audioMs = audio.bytes // 32`。這樣兩條路徑只各加一行，時間戳在同一處產生。

### 段落時間以事件到達時間標記

前端維護 `timeMarks`：每收到帶文字的事件就記下 `{end: transcript.length, ms: data.audioMs}`。段落定稿時，`endMs` 取第一個 `end >= 段落結束位置` 的 mark 的 `ms`；`startMs` 取前一段的 `endMs`。播放視窗前延 3000 ms、後延 500 ms（`webapp/static/timeline.js` 的 `PLAY_LEAD_MS`、`PLAY_TAIL_MS`）。量測（`bench/lagcheck.py`，2026-11-04，以人工字幕結束時間對照錄軌事件的音訊位置）：中文落後中位 0.5 s（本機）／1.8 s（MAI），日文 3.8 s（本機）／1.0 s（MAI）；英文兩引擎都約 11 s 且彼此只差 1.4 s，判定為字幕時間軸偏移而不採用。前延取 3 s 涵蓋中日文中位數，校對頁另可再前後延伸 2 秒。

替代方案：由 ASR 回傳字詞時間戳。Confucius 的 WebSocket 介面與 MAI 都沒有提供，需改上游模型服務，不在本變更範圍。

### 段落保存採整批 upsert

`PUT /api/meetings/{id}/segments` 收 `{glossary, learned, sourceLanguage, targetLanguage, segments:[{seq, startMs, endMs, source, target, detected}]}`。伺服器依 `seq` upsert：新段落寫入時 `asr_text`＝`source`、`live_target`＝`target`；既有段落只更新 `target`（精修結果），且僅當該段沒有任何校對紀錄。會議頁面在段落有變動時最多每 10 秒存一次、會議結束時與每次精修改變譯文後各存一次（沿用現有 `storeTranscript()` 的時機）。`seq` 為 `finalizedRecords()` 排序後的序號（從 1 開始）。

### 重譯請求組裝抽成共用模組

新增 `webapp/static/translation-context.js`，匯出 `refinementRequest(finals, index, options)` 與 `plausibleRefinement(old, fresh, neighbours)`；`app.js` 的 `correctNext()` 改用它（行為不變），校對頁也用它。`bench/guardcheck.js` 改為載入此模組。依 expand → migrate → contract：先新增模組並讓 guardcheck 通過，再把 app.js 切過去並刪除舊函式。

替代方案：在伺服器以 Python 重寫一套重譯邏輯。會出現兩份策略、日後容易分歧；使用者要求「策略跟現行一樣」，共用同一份程式最直接。

### 修改與重譯分兩步記錄

1. `POST /api/meetings/{id}/segments/{seq}/edit {version, source}` → 存新原文、version+1、新增一筆 `kind=edit` 紀錄，回傳新 version。
2. 瀏覽器以 `refinementRequest` 呼叫既有的 `/api/translate/stream`，通過 `plausibleRefinement` 後 `POST .../translation {version, target}` → 存新譯文、version+1、新增 `kind=retranslate` 紀錄。
3. `POST .../confirm {version}` → `kind=confirm` 紀錄。

各步驟都以 version 做樂觀鎖，不符回 409。重譯失敗不影響第 1 步，畫面顯示重試。

### 資料表

`webapp/migrations/002_review.sql`：

| 表 | 欄位 |
| --- | --- |
| `meetings`（新增欄位） | `source_language`、`target_language`、`glossary`、`learned_terms`、`audio_bytes`、`ended_at` |
| `segments` | `meeting_id`、`seq`（PK 兩欄）、`start_ms`、`end_ms`、`asr_text`、`source`、`live_target`、`target`、`detected`、`state`（`unreviewed`／`confirmed`／`edited`）、`version` |
| `segment_history` | `id`、`meeting_id`、`seq`、`kind`（`edit`／`retranslate`／`confirm`）、`username`、`at`、`source_before`、`source_after`、`target_before`、`target_after`、`refine`（是否雲端） |

`segment_history` 只新增，app 不提供修改或刪除。

### 校對頁與會議列表

`/meetings`（列表）與 `/meetings/{id}`（校對）為靜態頁 `meetings.html`、`review.html` + `review.js`，沿用登入頁與團隊管理頁的 `tokens.css`（深淺主題色）與 `admin.css`（頂部列、卡片、按鈕、輸入框），頁面專屬樣式在 `review.css`，手機寬度改為單欄。音訊以 `GET /api/meetings/{id}/audio?start=&end=` 取得區間 WAV，交給 `<audio>` 播放。

### 匯出採 zip 串流

`GET /api/teams/{team_id}/asr-export?from=YYYY-MM-DD&to=YYYY-MM-DD` 以 `zipfile` 寫入暫存檔後串流回傳（避免整份放在記憶體），內含 `clips/<meeting>_<seq 4 位>.wav` 與 `manifest.jsonl`。

## Implementation Contract

**可觀察的行為：**

- 會議結束後 `output/teams/<team_id>/<meeting_id>/audio.wav` 存在，長度與送出的音訊一致（本機與 MAI 引擎皆然）。
- 每個辨識事件 JSON 帶 `audioMs`（整數）。
- `GET /api/meetings/{id}` → `{meeting:{…}, segments:[{seq,startMs,endMs,asrText,source,liveTarget,target,detected,state,version}]}`。
- `GET /api/meetings/{id}/audio?start=&end=` → `audio/wav`；範圍超出時截到 0 與錄音結尾；無錄音 404。
- `/meetings` 列出所屬團隊會議；`/meetings/{id}` 校對頁：點段落播放、「往前 2 秒」「往後 2 秒」「重播」、編輯原文、儲存並重譯、確認正確、查看歷程、雲端精修勾選、「一併重譯下一段」。
- 錯誤訊息：`這段已被其他人修改，已重新載入`、`重譯失敗`（附重試）、`重譯結果重複了前後文，已保留原譯文`。
- `GET /api/teams/{team_id}/asr-export` → zip，內容符合 asr-training-export spec。

**驗收：**

- `webapp/test_server.py` 新增測試涵蓋三份 spec 的 scenario（WAV header 與長度、`audioMs`、upsert 不覆蓋校對、409、歷程、匯出內容、跨團隊 404）。
- `bench/guardcheck.js` 與 `bench/segcheck.js` 在模組抽出後仍全部 ok。
- 以 `bench/` 的一段重播音檔實際開會、到校對頁播放 3 個段落，人工確認聲音與文字相符。
- 抽出共用模組後，以 bench 重播一段影片，精修結果與抽出前一致（同一 ASR 軌、比對譯文）。

**範圍內：** 上述 API、頁面、資料表、錄音、前端時間標記與保存、共用模組、文件。
**範圍外：** 見 Non-Goals。

## Risks / Trade-offs

- [段落邊界不準，聽到的不是那句話] → 播放視窗前後延伸並可再延伸 2 秒；任務 2.2 量測實際延遲調整常數。
- [WAV 佔空間：每小時約 115 MB（計算值）] → 先接受；之後可加背景壓縮成 FLAC 或 Opus，區間讀取改為解碼。
- [抽出共用模組時改變了即時精修行為] → expand → migrate → contract，並以 guardcheck 與 bench 重播比對。
- [會議中瀏覽器關閉，段落沒存到] → 會議中每 10 秒保存；錄音在伺服器端，不受瀏覽器影響。
- [重譯佔用唯一的本機翻譯模型、與進行中的會議競爭] → 校對重譯走同一個 `/api/translate/stream`，與即時翻譯排隊；可勾選雲端精修分流。

## Migration Plan

1. 部署 `team-accounts` 後部署本變更；app 啟動時套用 `002_review.sql`。
2. 新會議自動有錄音與段落；舊會議在列表中顯示但沒有校對連結。
3. 回滾：回到前一版程式；新增的表與欄位不影響舊版。

## Open Questions

- 已解決：ASR 文字延遲已量測，`PLAY_LEAD_MS` 定為 3000（見「段落時間以事件到達時間標記」）。英文字幕時間軸偏移的原因未查，之後若英文播放邊界不準再以英文重測。
