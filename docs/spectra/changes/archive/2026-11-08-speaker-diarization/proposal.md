## Why

路線圖 P5 的第一項：逐字稿段落目前沒有「誰說的」。會後校對看不出發言者，紀要模型也只能從內容猜負責人（meeting-minutes 當時把說話者辨識列為 P5 再做）。

2026-11-08 以真實中文會議錄音評估兩種本機方案（AliMeeting 3 段 4 人、AISHELL-4 2 段 6 人，各取前 10 分鐘，另加一段完整 34 分鐘的 AliMeeting；分數為說話者錯誤率 DER，0.25 秒容錯、含重疊）：

| 方案 | 10 分鐘平均 DER | 段落歸屬正確率 | 完整 34 分鐘 DER | 速度（處理時間／音訊長度） |
|---|---|---|---|---|
| sherpa-onnx：pyannote 分段＋CAM++ 聲紋，最佳閾值 1.0 | 11.7% | 85.4% | 29.4% | 0.09 |
| MOSS-Transcribe-Diarize 0.9B，GPU bf16 | 5.4% | 92.7% | 7.2% | 0.20（34 分鐘時 0.57） |
| MOSS-Transcribe-Diarize Q8，CPU（transcribe.cpp，16 執行緒） | 5.6% | 92.7% | 未測 | 0.42–1.13（對話越密越慢） |

（量測值；「段落歸屬正確率」= 每段 1 秒以上的標準答案發言，被歸給正確說話者的時間比例。）

MOSS 準確度明顯較好，人數 5 段猜對 4 段（另一段多 1 人），長會議不退化；sherpa 在長會議退化到 29.4%，而且閾值差 0.1 就可能崩壞（1.1 時一段 45%）。但 MOSS 在 GPU 上處理 34 分鐘會議峰值 8.1 GB，而 GPU 平常只剩約 2.5 GB 且由即時轉錄共用（路線圖原則：不再加 GPU 模型）。因此採用 MOSS 的 CPU 版：會後在背景處理，不占 GPU；代價是處理時間約為會議長度的 0.4–1.1 倍。日文對談與英文法說會的實測也切出合理的說話者（各 2 人、5 人）。

## What Changes

- 新增 Compose 服務 `diarize`：以固定版本的 transcribe.cpp 執行 MOSS-Transcribe-Diarize Q8_0（CPU），首次啟動下載模型；唯讀掛載 `./output`，一次只處理一場會議；HTTP 介面只接受 `teams/<團隊>/<會議>/audio.wav` 形式的相對路徑。
- 會議結束（錄音收尾）時，若服務已設定且錄音至少 10 秒，自動排入說話者辨識；校對頁也可以手動「辨識說話者」／「重新辨識」。狀態：排隊中、辨識中、完成、失敗（附原因）；app 重新啟動時，排隊或辨識中的工作重新排入。
- 把辨識結果標到段落上：MOSS 輸出的是帶說話者的文字，與我們的逐字稿是同一段話，因此以「段落文字對齊 MOSS 文字」決定說話者（不受轉錄延遲影響），對不上時才用時間重疊（扣掉轉錄延遲）；仍無法判斷就不標。辨識完成後才存進來的段落，存檔時補標。
- 校對頁：段落前顯示說話者標籤（顏色＋名字，未命名時為「說話者 1」）；說話者清單可把每位說話者命名為團隊成員或自填名字，一次套用到他所有段落；單一段落可以改指定另一位說話者、新增說話者或設為不指定（手動指定的段落之後補標不會蓋掉）。重新辨識會清除命名與手動指定，按鈕先確認。
- 紀要：送給紀要模型的段落改為 `[seq] 名字：原文`（有說話者時），提示詞說明名字來自聲音辨識、可能有誤，可用來判斷「我來處理」這類句子的負責人。
- 新增評估工具 `bench/diarize/`（切資料、跑兩種方案、計算 DER 與段落歸屬正確率）與 bench/README 的結果；新增段落層級的實測（真實頁面錄音→辨識→比對標準答案）。
- 資料表：`diarizations`（狀態與 MOSS 原始結果）、`meeting_speakers`（每場會議的說話者與命名）、`segments.speaker`／`segments.speaker_manual`。

## Non-Goals (optional)

- 不做跨會議的聲紋記憶（自動認出同一位同事）；之後可用已命名的說話者建聲紋再做。
- 不在開會中即時顯示說話者（MOSS 不是串流模型）。
- 不用 MOSS 的文字取代原本的轉錄；它的文字只用來對齊說話者。
- 不把一段跨兩位說話者的段落拆開；以多數決標一位。
- 全文搜尋、問答、匯出檔暫不顯示說話者。
- 不使用 GPU；不採用 sherpa-onnx（準確度與長會議穩定度不足，見上表）。

## Capabilities

### New Capabilities

- `speaker-diarization`: 會後以本機 MOSS 模型辨識說話者、標到段落、讓團隊成員命名與修正。

### Modified Capabilities

- `transcript-review`: 校對頁的段落顯示說話者。
- `meeting-minutes`: 送給紀要模型的段落帶說話者名字。

## Impact

- 新增：docker/diarize/Dockerfile、docker/diarize/server.py、webapp/diarize.py、webapp/migrations/012_speakers.sql、webapp/static/speakers.js、webapp/static/speakers.css、bench/diarize/（prep.py、metrics.py、score.py、run_sherpa.py、run_moss.py、segment_eval.mjs）、bench/speakers_e2e.mjs。
- 修改：compose.yaml（diarize 服務、app 的 `DIARIZE_URL`、模型快取 volume）、webapp/server.py（掛上路由、錄音收尾時排入、啟動時恢復）、webapp/review.py（段落帶 speaker、存段落後補標）、webapp/minutes.py（段落帶名字、提示詞一句）、webapp/static/review.html／review.js／review.css（說話者標籤與清單）、webapp/test_server.py、README.md、bench/README.md、docs/roadmap.md。
- 資源：CPU 16 執行緒（`DIARIZE_THREADS`），記憶體約模型 1 GB＋每分鐘音訊 85 MB；不用 GPU。
