## 1. 錄音與時間軸

- [x] 1.1 資料表：新增 webapp/migrations/002_review.sql，為 `meetings` 加 `source_language`、`target_language`、`glossary`、`learned_terms`、`audio_bytes`、`ended_at`，建立 `segments` 與 `segment_history`。驗證：`test_migrations_apply_once` 擴充為兩個版本都只套用一次，表與欄位存在
- [x] 1.2 Server-side meeting recording，伺服器端錄音寫入 WAV：新增 webapp/meeting_audio.py 的 `MeetingAudio`（寫 header、附加 PCM、結束回填長度、`read_range` 依位移切段、讀取時依檔案大小修正 header）。驗證：測試「10 秒音訊 → header 為 16 kHz 單聲道 16-bit 且長度 10 秒」「未回填 header 的檔案可修正並讀出區間」「區間超出時截到 0 與結尾」
- [x] 1.3 Recognition events carry audio time，兩種引擎共用錄音與 audioMs：`TranscriptDisplay` 接受 `audio`，`transcribe()` 的 `browser_to_asr` 與 `MaiBridge.browser_to_mai` 收到音訊時寫入，`annotate` 為每個事件加 `audioMs`；會議結束時回填 header 並記錄 `audio_bytes`、`ended_at`。驗證：測試「收到 96000 bytes 後的事件 `audioMs` 為 3000」，本機與 MAI（FakeBrowser）兩條路徑的 audio.wav 內容與送出位元組相同 [after: 1.1, 1.2]

## 2. 前端段落時間與保存

- [x] 2.1 重譯請求組裝抽成共用模組（expand）：新增 webapp/static/translation-context.js，提供 `refinementRequest(finals, index, options)` 與 `plausibleRefinement`，內容與 `correctNext()` 目前組出的請求一致；bench/guardcheck.js 改為載入此模組。驗證：`node bench/guardcheck.js` 全部 ok，另新增 node 檢查比對兩者對同一組段落產生相同請求
- [x] 2.2 Segments record their time span，段落時間以事件到達時間標記：app.js 記錄 `timeMarks` 並在段落定稿時寫入 `startMs`／`endMs`；以 bench 一段已知音檔量測 ASR 文字落後音訊的實際延遲，據此設定 `PLAY_LEAD_MS`／`PLAY_TAIL_MS` 並把量測值寫進 design 的 Open Questions 結論。驗證：node 檢查 spec 的 consecutive segments 例子與 playback window 表；量測紀錄附在任務完成說明中 [after: 1.3]
- [x] 2.3 Segments are stored with the meeting，段落保存採整批 upsert：`PUT /api/meetings/{id}/segments` 依 `seq` upsert，新段落寫入 `asr_text`／`live_target`，既有段落只更新沒有校對紀錄者的 `target`；app.js 在會議中最多每 10 秒、結束時、精修改變譯文後保存，並帶會議詞彙、自動學習詞彙與語言方向。驗證：測試 spec 的兩個 scenario（精修後更新、已校對不覆蓋），另以 /browse 實際開一場會確認資料庫有段落 [after: 1.1, 2.2]
- [x] 2.4 重譯請求組裝抽成共用模組（migrate + contract）：app.js 的 `correctNext()` 改用 `refinementRequest`，刪除 app.js 內的舊 `plausibleRefinement`。驗證：guardcheck 與 segcheck 全部 ok；以同一 ASR 軌用 `bench/run.py` 重播一段影片，精修後的譯文與抽出前的重播結果一致 [after: 2.1, 2.3]

## 3. 校對

- [x] 3.1 Meeting list 與 Review page shows aligned segments，校對頁與會議列表（唯讀部分）：`GET /api/meetings`（含段落數與已校對數）、`GET /api/meetings/{id}`，`/meetings` 與 `/meetings/{id}` 頁面依序列出段落（mm:ss、原文、譯文、狀態），沿用深淺主題與手機版面；主頁加「會議紀錄」入口。驗證：測試「兩個團隊的會議都列出、其他團隊不出現」，以 /browse 截圖確認桌面與 400px 寬度版面 [after: 2.3]
- [x] 3.2 Segment playback：`GET /api/meetings/{id}/audio?start=&end=` 回傳區間 WAV（非成員 404、無錄音 404）；校對頁點段落播放、往前 2 秒、往後 2 秒、重播。驗證：測試 spec 的 3 個 scenario；以 bench 音檔開會後在校對頁播放 3 個段落，人工確認聲音與文字相符 [after: 3.1]
- [x] 3.3 修改與重譯分兩步記錄，Edit history、Confirming a segment without changes、Concurrent edits are detected：`POST .../edit`、`.../translation`、`.../confirm` 皆以 version 樂觀鎖（不符 409），每次新增 `segment_history`（只新增），`GET .../history` 回傳歷程。驗證：測試「兩次修改依序兩筆且 ASR 原文不變」「確認產生紀錄」「alice 先存、bob 409」[after: 3.1]
- [x] 3.4 Correcting a transcript segment retranslates it 與 Retranslating the next segment：校對頁儲存原文後以 `refinementRequest` 呼叫 `/api/translate/stream`，經 `plausibleRefinement` 才寫入；失敗顯示 `重譯失敗` 與重試、重複時顯示 `重譯結果重複了前後文，已保留原譯文`、409 時顯示 `這段已被其他人修改，已重新載入` 並重新載入；成功後提供「一併重譯下一段」；頁面上有雲端精修勾選與歷程檢視。驗證：/browse 實際把一段「城市設計」改成「程式設計」，確認送出的請求含前兩段與下一段開頭、譯文更新、歷程兩筆；以停掉翻譯服務重現失敗提示 [after: 2.4, 3.3]
- [x] 3.5 Only team members review：所有校對 API（讀取、音訊、修改、確認、重譯寫入、歷程）以 `team_access.require_member` 檢查，非成員 404 且不寫入。驗證：測試「其他團隊成員送出修改回 404、資料庫無變化」，並逐一確認每個校對 API 都有非成員 404 測試 [after: 3.3]

## 4. 匯出與文件

- [x] 4.1 Export reviewed segments for ASR training 與 Manifest content，匯出採 zip 串流：`GET /api/teams/{team_id}/asr-export?from=&to=` 只含已確認或已修改段落，片段依 `startMs`–`endMs` 切（不加播放延伸），`manifest.jsonl` 欄位依 spec；非成員 404；校對頁或列表頁提供匯出按鈕。驗證：測試「3 修改＋2 確認＋10 未校對 → 5 個片段與 5 行」與 manifest 範例逐欄比對、跨團隊 404 [after: 3.3]
- [x] 4.2 文件：README.md 新增「會後校對」使用說明、資料保存位置與容量估計、匯出格式；docs/roadmap.md 將 P1 標為完成。驗證：內容檢查，說明中的 API 與頁面路徑與實作一致 [after: 3.4, 4.1]
