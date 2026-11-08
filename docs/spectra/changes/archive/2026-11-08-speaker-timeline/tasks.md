## 1. 後端

- [x] 1.1 設計決策「時間軸放在既有的說話者區塊，資料隨 speakers API 一起回傳」與「角色存在 meeting_speakers.note」：`013_speaker_notes.sql`、`webapp/diarize.py` 回傳 `turns`（繁體）、`durationMs`、`turnMs`、`note`，`PUT …/speakers/{label}` 接受 `note`。實作 spec「Speaker timeline」的資料部分與「Naming and correcting speakers」的「Giving a role」。驗證：`test_server.py` 新增測試覆蓋範例表「Turns returned by the speakers endpoint」兩列、durationMs、turnMs、note 儲存、41 字 422、重新辨識清除 note；`python -m unittest -q test_server` 全過。

## 2. 校對頁

- [x] 2.1 [after: 1.1] 設計決策「發言條的畫法」：spec「Speaker timeline」的卡片（名字＋角色或段數與發言時間、選取加亮並開啟含角色的編輯）、每位說話者一條軌道與發言條（hover 顯示時間與文字）、標題列錄音長度與人數。驗證：`bench/speakers_e2e.mjs` 檢查軌道數、第一條發言條的 left／width 與 turns 比例相符、角色儲存後卡片顯示、400 px 不溢出。
- [x] 2.2 [after: 2.1] 設計決策「時間軸播放用獨立的 Audio 物件，分段連續載入」「文字進度依時間比例估計」「逐字稿對應段落以時間決定」：spec「Playing from the timeline」——點發言條連續播放、播放線、正在播放區與文字加亮、跨句自動切換、對應段落 `.speaking` 與捲動、暫停／繼續、與段落播放互斥。驗證：`bench/speakers_e2e.mjs` 以真實服務辨識後點發言條，檢查音訊在播放且播放線前進、正在播放區的說話者與文字、加亮部分非空、段落 `.speaking`、暫停有效、按段落播放後時間軸停止。

## 3. 文件與回歸

- [x] 3.1 [after: 2.2] README「說話者辨識」補發言時間軸與角色說明。驗證：內容審閱；單元測試、`speakers_e2e.mjs`、`translate_e2e.mjs`、`catalog_e2e.mjs` 通過。
