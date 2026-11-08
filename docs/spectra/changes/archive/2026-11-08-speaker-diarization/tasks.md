## 1. 評估工具

- [x] 1.1 設計決策「採用 MOSS-Transcribe-Diarize Q8_0 以 transcribe.cpp 在 CPU 執行」的依據可重現：把評估腳本整理進 `bench/diarize/`（`prep.py` 從 argmax AliMeeting／AISHELL-4 分片切片段與標準答案、`metrics.py` 計算 DER 與段落歸屬正確率、`score.py` 彙總、`run_sherpa.py`、`run_moss.py`、`run_tcpp.sh`），`bench/README.md` 新增「2026-11-08 說話者辨識評估」記錄資料、指令與 proposal 的結果表。驗證：在評估映像檔中對已切好的片段執行 `python bench/diarize/score.py` 重現 moss-q8cpu 平均 DER 5.6% 與 cam-1.0 平均 11.7%。

## 2. 辨識服務

- [x] 2.1 設計決策「獨立的 diarize 服務，app 解析 CLI 輸出」：`docker/diarize/Dockerfile`（固定 commit 建置 transcribe.cpp）與 `docker/diarize/server.py`（`/health`、`/diarize`、路徑檢查 `resolve()`、一次一個、首次下載模型），compose 新增 `diarize` 服務、`diarize-model-cache` volume、app 的 `DIARIZE_URL`。對應 spec「Diarizing a meeting recording」的情境「Path outside a meeting folder」。驗證：`docker compose up -d diarize` 後 `/health` 回 200；以測試會議 123e46e5 的 `audio.wav` 呼叫 `/diarize` 得到含 `S1:` 的輸出；`../../etc/passwd` 與 `teams/1/x/notes.txt` 回 400（`docker/diarize/test_server.py` 單元測試）。

## 3. app 後端

- [x] 3.1 [after: 2.1] 資料表 `012_speakers.sql`（`diarizations`、`meeting_speakers`、`segments.speaker`／`speaker_manual`）與 `webapp/diarize.py` 的 `parse_output`、`assign`，實作 spec「Labelling segments with speakers」與設計決策「以文字對齊決定段落的說話者，時間重疊為後備」。驗證：`test_server.py` 新增 `parse_output` 測試與 spec 範例表「Choosing a segment's speaker」四列的 `assign` 測試，`python -m unittest -q test_server` 全過。
- [x] 3.2 [after: 3.1] 設計決策「app 內單一工作佇列，狀態存資料庫」與「重新辨識取代所有說話者資料」：`enqueue`／`worker`／`recover`、`finish_recording` 錄音 ≥10 秒自動排入、`POST …/speakers/run`（400／409／422）、完成時寫入 turns、重建 `meeting_speakers` 並重標段落、失敗時保留原資料；`review.save_segments` 後 `label_new_segments`。實作 spec「Diarizing a meeting recording」與「Labelling segments with speakers」的「Segments saved after diarization」。驗證：單元測試以假服務覆蓋自動排入／短錄音不排／409／服務失敗不改資料／重啟恢復／存段落補標且保留手動指定／重新辨識清除命名。
- [x] 3.3 [after: 3.2] spec「Naming and correcting speakers」與「Only team members see and change speakers」：`GET …/speakers`、`PUT …/speakers/{label}`（成員 422、40 字）、`POST …/speakers`、`PUT …/segments/{seq}/speaker`；`segment_payload` 帶 `speaker`。驗證：單元測試覆蓋命名為成員與自填名字、非成員 422、改段落後保留、新增說話者、非團隊成員 404。
- [x] 3.4 [after: 3.1] 設計決策「紀要只在段落前加名字」，spec「Generating minutes」的情境「Segments with speakers」：`minutes.build_messages` 帶 `名字：`、提示詞加一條。驗證：單元測試檢查訊息含 `[3] 林怡安：我來處理報價` 且無說話者的段落（`[4]`）只有原文。

## 4. 校對頁

- [x] 4.1 [after: 3.3] spec「Review page shows aligned segments」的情境「Opening a diarized meeting」：`speakers.js`／`speakers.css` 的說話者面板（狀態、辨識／重新辨識按鈕並在已有說話者時確認、說話者清單與命名編輯）與段落標籤選單；`review.js`／`review.html` 接上、資產版本號。驗證：`bench/speakers_e2e.mjs` 以真實服務辨識一場測試會議，檢查狀態到完成、標籤顯示、命名為成員後所有段落改名、改一段、新增說話者、重新整理後保留、手機寬度不溢出；`catalog_e2e.mjs` 與 `minutes_e2e.mjs` 仍通過。

## 5. 段落層級實測與文件

- [x] 5.1 [after: 4.1] 確認設計決策「以文字對齊決定段落的說話者，時間重疊為後備」的門檻：`bench/diarize/segment_eval.mjs` 以假麥克風播放 AliMeeting 片段開一場真實會議（本機引擎），辨識完成後計算段落歸屬正確率（文字對齊與只用時間重疊兩者），結果寫進 bench/README；需要調整門檻時只改 `diarize.py` 常數並重跑。測試會議事後刪除。驗證：bench/README 有數字；清楚屬於一人的段落兩者皆正確，文字對齊在段落時間延後 0–3 秒時都不下滑（只用時間重疊會隨延遲下滑）。
- [x] 5.2 [after: 5.1] README（說話者辨識的使用方式、資源與 `DIARIZE_*` 設定）與 `docs/roadmap.md` P5 狀態更新。驗證：內容審閱；全部單元測試與 e2e 再跑一次通過。
