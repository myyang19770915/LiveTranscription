## 1. 校正的計算（設計：用整場的發言文字做一條「字 → 時間」對照，逐段比對）

- [x] 1.1 `diarize.py` 新增純函式 `retime(segments, turns, duration_ms=None)`，實作 speaker-diarization「Segment times follow the recording」的比對與換算：發言內依字的位置內插、前 12 秒到後 3 秒的比對範圍、相符至少 50% 且至少 2 字、只取長度 ≥ 2 的相符區塊、不重複比對前一個已校正段落用過的字、開始時間不得早於前一個已校正段落、結束至少晚 200 ms、不超過錄音長度。驗證：`test_server` 新增測試先失敗再通過，涵蓋規格的四個情境與「Start times against the recording」表格的四列（第 2、4、8、10 段開始時間在 7380、21330、45750、59660 的 ±300 ms 內；測試用等長替代文字，不放會議內容）、相符不足不回傳、會倒退的段落不回傳。

## 2. 寫回資料庫（設計：校正後的時間寫回 start_ms／end_ms，另加 timed 欄位）

- [x] 2.1 新增 `webapp/migrations/021_segment_timed.sql`：`segments` 加 `timed boolean NOT NULL DEFAULT false`。`diarize.store_result()` 在標完說話者後，以這場會議全部段落呼叫 `retime()`，更新 `start_ms`、`end_ms`、`timed = true`，不動 `version`、文字、狀態、說話者；計算放在 `asyncio.to_thread`，失敗只記警告。驗證：`test_server` 新增測試，`store_result()` 後資料庫的段落時間與 `timed` 已更新、`version` 不變；比對不到的段落三個欄位都沒變。 [after: 1.1]
- [x] 2.2 段落的 API 輸出（`team_access.py` 的段落轉換）加上 `timed`。驗證：`test_server` 中校對頁資料的測試確認校正過的段落 `timed` 為 true、其餘為 false。 [after: 2.1]
- [x] 2.3 設計「舊會議用指令補做」：`python -m diarize retime [meeting_id]`，沒給 id 時處理所有說話者辨識已完成的會議，印出每場校正的段數；只改 `start_ms`、`end_ms`、`timed`。驗證：`test_server` 新增測試呼叫指令的處理函式，確認指定會議被校正、其他會議不變。 [after: 2.1]

## 3. 播放（設計：播放範圍依 timed 分兩種）

- [x] 3.1 transcript-review「Segment playback」：`timeline.js` 的 `playWindow(startMs, endMs, totalMs, timed)` 在 `timed` 為真時往前、往後各 300 ms；`review.js` 與 `evidence-panel.js` 傳入段落的 `timed`。驗證：`bench/timelinecheck.js` 新增 `playWindow(4200, 9100, 60000, true)` 為 `{start: 3900, end: 9400}`，既有檢查不變並全部通過。 [after: 2.2]
- [x] 3.2 `speakers.js` 的 `segmentAt(ms)`：`timed` 的段落用開始前 300 ms，其餘維持 3000 ms。驗證：瀏覽器測試（新增 `bench/segment_times_e2e.mjs <會議 id>`：開一場真實會議的校對頁，把回應裡的段落與發言換成兩個 timed 段落 12811–17578、21330–27040 和一個非 timed 段落，錄音用真的，不寫入會議）在時間軸播放到 21.5 秒時，被標示的是第二段、播放到 19 秒時還沒有標示它；點第二段播放時請求的音訊範圍是 `start=21030&end=27340`，點非 timed 段落 40000–44000 時是 `37000–44500`。 [after: 3.1]
- [x] 3.3 更新載入 `timeline.js`、`review.js`、`speakers.js`、`evidence-panel.js` 的頁面的 `?v=`。驗證：`grep` 各頁版本參數一致。 [after: 3.2]

## 4. 實測

- [x] 4.1 重啟 app 容器套用 migration，對會議 `6ec5d47e-995a-493f-90a1-bab117838304` 執行 `python -m diarize retime <id>`，把校正前後的段落時間與量到的開口時間並列寫入 evidence.md；跑完整 `test_server`、`bench/checks.js`（既有的 closecheck、privacycheck 兩項失敗除外）與 `bench/segment_times_e2e.mjs`。驗證：evidence.md 的表格中第 2、4、8、10 段校正後與開口時間差距都在 600 ms 內；測試全部通過。 [after: 2.3, 3.3]
