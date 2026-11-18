## 1. 即時翻譯紀錄保存逐句資料

- [x] 1.1 （Requirement: 即時翻譯 records keep their sentences；設計：即時翻譯紀錄保存逐句資料）兩個譯文 PUT 接受選填 `segments` 並驗證（5000 句、2000 字、時間），存進 `session.json`；`app.js` 在即時翻譯模式送出已定稿的句子（`outputRecords()`），30 秒一次與存檔後一次。驗證：test_server 新增「segments 存入／422 的三種情形／不帶 segments 照舊」，bench/interpret_e2e.mjs 仍通過。

## 2. 轉換 API 與直接轉換

- [x] 2.1 （Requirement: Turning a record into a meeting；設計：轉換完成時才建立會議、API）新增 `webapp/record_meeting.py` 建立會議（交易內寫 meetings 與 segments、錄音寫入 meeting_dir/audio.wav、呼叫 diarize.recording_closed、session.json 寫 meetingId）；`POST`／`GET /api/interpret/sessions/{sid}/meeting`；列表帶 `meetingId` 與 `segments`。驗證：test_server 新增「有逐句資料直接轉換：段落、錄音位元組、標題預設、started_at」「重複轉換 409」「非成員 404」「別人的紀錄 404」「列表欄位」。 [after: 1.1]

## 3. 沒有逐句資料：精準模式

- [x] 3.1 （Requirement: Records without sentences go through 精準模式；設計：轉換方式依有無逐句資料）`QualityPass` 加選填 `engine` 參數；`record_meeting` 以 `engine="api"`（Qwen3-ASR，所有語言、不用 MAI）處理整段錄音（24→16 kHz、盡快餵入）、進度（doneMs/totalMs）、任何片段失敗整次失敗不建會議、未設定 503、每人 1 個全站 2 個（429）。驗證：test_server 以假的 QualityPass 測「口譯紀錄 24 kHz 轉換後錄音長度與段落」「片段失敗不建會議、紀錄不標示」「未設定 503」「英文紀錄也走轉錄 API、不建立 MaiLive」「並行 429」。 [after: 2.1]

## 4. 我的紀錄畫面

- [x] 4.1 （Requirement: Turning a record into a meeting、Records without sentences go through 精準模式；設計：我的紀錄畫面）列表每筆加「轉成會議紀錄」（不能轉換的紀錄改為「為何不能轉換」，點了顯示原因）；對話框（團隊、標題、精準模式的外部服務說明與估計時間）；轉換中進度每 2 秒更新；完成顯示「已轉成會議紀錄・開啟」；已轉換的紀錄改為開啟會議；精準模式未設定時說明不能轉換；`?v=` 更新。驗證：新增 bench/record_meeting_e2e.mjs（用有逐句資料的紀錄，不花費；精準模式路徑以攔截回應測進度與失敗訊息），bench ui_consistency_e2e、interpret_e2e 通過。 [after: 3.1]

## 5. 實際執行

- [x] 5.1 用一筆約 1 分鐘的即時口譯紀錄實際跑精準模式轉換一次，回報花費、所需時間與段落品質；全部 test_server 與相關 bench 通過。 [after: 4.1]
