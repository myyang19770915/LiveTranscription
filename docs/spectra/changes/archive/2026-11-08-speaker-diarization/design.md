## Context

段落（`segments`）有錄音時間（`start_ms`／`end_ms`，是瀏覽器看到文字出現與定稿時的閘道器音訊位置，比實際語音晚約 1 秒（本機）到 2.7 秒（MAI））、原文、譯文，但沒有說話者。錄音 `output/teams/<團隊>/<會議>/audio.wav` 是送給 ASR 的同一份 16 kHz PCM，時間軸一致。

主機：RTX 5090 已用約 30/32.6 GB（即時轉錄 vLLM、翻譯 llama.cpp 與其他程式共用），24 核 CPU、62 GB 記憶體。紀要模型在 `minutes.py` 以 `[seq] 原文` 一次送整場。

評估資料與數字見 proposal；評估腳本放在 `bench/diarize/`。

## Goals / Non-Goals

**Goals:**

- 會議結束後自動得到每段的說話者，不用 GPU、不影響即時轉錄。
- 團隊成員能把說話者對應到團隊成員或名字，並修正個別段落。
- 紀要模型拿到說話者名字。

**Non-Goals:**

- 跨會議聲紋記憶、開會中即時說話者、用 MOSS 文字取代轉錄、拆分跨說話者段落、搜尋／問答／匯出顯示說話者、GPU 執行、sherpa-onnx。

## Decisions

### 採用 MOSS-Transcribe-Diarize Q8_0 以 transcribe.cpp 在 CPU 執行

準確度：10 分鐘片段平均 DER 5.6%（CPU Q8）／5.4%（GPU），sherpa-onnx 最佳 11.7%；34 分鐘完整會議 MOSS 7.2%、sherpa 29.4%。GPU 版長會議峰值 8.1 GB，超過平常可用的約 2.5 GB。PyTorch CPU（float32）10 分鐘音訊跑超過 12 分鐘仍未完成，transcribe.cpp Q8 為 250–676 秒。替代方案：sherpa-onnx（快 10 倍但長會議不穩）、MOSS GPU（記憶體不夠）、MOSS 切段＋聲紋串接（複雜，且要另外解決跨段同一人的對應），都不採用。

### 獨立的 diarize 服務，app 解析 CLI 輸出

`docker/diarize/`：多階段建置固定版本的 transcribe.cpp（commit `5700f127e38dd53c4735ea23ef743b4b538eacd4`），執行階段是 Debian slim＋Python 標準函式庫的小 HTTP 伺服器（不裝第三方套件），首次啟動把模型下載到 volume。服務只負責執行 `transcribe-cli --diarize` 並回傳原始輸出；解析在 app 的 `diarize.py`，因此可以在 app 的單元測試覆蓋。替代方案：把 transcribe.cpp 裝進 app 映像檔（app 映像檔會變大、建置需要編譯器，且 app 的 CPU 會被占滿）；用 Python 綁定（transcribe.cpp 沒有穩定的 Python 套件）。

### 以文字對齊決定段落的說話者，時間重疊為後備

段落時間比語音晚、而且晚多少依引擎不同；MOSS 輸出的是帶說話者的文字，與段落是同一段話。對每段：取時間範圍 [start−12 s, end+3 s] 內的 MOSS 片段，兩邊都轉繁體、去標點空白、英文轉小寫後，用 `difflib.SequenceMatcher(autojunk=False)` 的相符區塊計算每位說話者對到的字數；對到的字數至少段落字數 30% 且至少 2 字時取最多者。否則用段落時間往前移 1 秒後與各說話者片段重疊最多者；都沒有則不標。替代方案：只用時間重疊（受引擎延遲影響，跨說話者時容易歸錯）。門檻 12 s／3 s／30%／1 s 是估計值，由 `bench/diarize/segment_eval.mjs` 在真實頁面錄音上量測確認，量測結果寫進 bench/README；若量測顯示需要調整，只改 `diarize.py` 的常數並記錄。

### 重新辨識取代所有說話者資料

MOSS 的 S1、S2 只在單次執行內有意義，重跑後編號可能對到不同人，所以重跑完成時清除該會議的說話者、命名與手動指定，再全部重標。頁面在已有說話者時先確認。替代方案：用時間重疊把新舊編號對應（不可靠，而且多數情況是使用者認為第一次結果很差才重跑）。

### app 內單一工作佇列，狀態存資料庫

`diarizations` 表記狀態；app 啟動時起一個 asyncio 背景工作依序處理 `queued`（依 `queued_at`），重啟時把 `running` 改回 `queued`。服務端另有鎖，一次只跑一場。對服務的 HTTP 呼叫逾時 4 小時（transcribe.cpp 單次最長約 2.9 小時音訊）。替代方案：另外的任務佇列系統（多一個元件，不需要）。

### 紀要只在段落前加名字

`[seq] 名字：原文`，提示詞多一條規則說明名字來自聲音辨識、可能有誤，「我來處理」這類句子的負責人可以參考說話者。不改其他規則與輸出格式。

## Implementation Contract

**服務 `diarize`（compose）**

- 映像檔由 `docker/diarize/Dockerfile` 建置；環境變數 `DIARIZE_THREADS`（預設 16）、`DIARIZE_MODEL_URL`（預設 Hugging Face `handy-computer/MOSS-Transcribe-Diarize-gguf` 的 Q8_0）；volume `diarize-model-cache:/models`；`./output:/output:ro`；不對外開埠。
- `GET /health`：模型存在時 200 `{"ok":true}`，下載中 503。
- `POST /diarize`，JSON `{"file":"teams/<數字>/<uuid>/audio.wav","language":"zh"|"en"|""}`：`file` 必須符合 `^teams/\d+/[0-9a-f-]{36}/audio\.wav$` 且檔案存在，否則 400／404；`language` 只傳 zh 或 en 給 `-l`，其他自動。成功回 200 `{"output":"<stdout>","seconds":<float>}`；transcribe-cli 失敗回 500 `{"error":"<stderr 最後 500 字>"}`。同一時間只執行一個，其他請求等待。

**app `webapp/diarize.py`**

- `DIARIZE_URL`（compose 預設 `http://diarize:5002`；空字串＝停用）。
- `parse_output(text) -> list[Turn]`：解析 `[  6.45 ->    7.31] S1: 文字` 行，`Turn(start_ms, end_ms, label, text)`；label 依第一次出現順序重新編號為 1..n。
- `assign(segments, turns) -> dict[seq, label | None]`：依「以文字對齊決定段落的說話者」的規則。
- 佇列：`enqueue(meeting_id, requested_by)`、背景工作 `worker()`、`recover()`；`server.finish_recording` 在 `recorded >= 10 * 32000` 位元組且已設定時呼叫 `enqueue`。
- 路由（皆先 `team_access.require_member`）：
  - `GET /api/meetings/{id}/speakers` → `{"configured":bool,"status":"none|queued|running|done|failed","message":str,"queuedAt","startedAt","finishedAt","speakers":[{"label":1,"name":"","username":null,"shown":"說話者 1","segments":12,"ms":81234}]}`
  - `POST /api/meetings/{id}/speakers/run` → 202 `{"status":"queued"}`；400 說話者辨識未設定；409 已在排隊或辨識中；422 沒有錄音。
  - `PUT /api/meetings/{id}/speakers/{label}` `{"name":str<=40,"username":str|null}` → 更新後的說話者；成員不在團隊 422；label 不存在 404。
  - `POST /api/meetings/{id}/speakers` → 新增下一個編號的說話者，201。
  - `PUT /api/meetings/{id}/segments/{seq}/speaker` `{"label":int|null}` → 段落 payload；label 不屬於該會議 422。設定 `speaker_manual=true`。
- `team_access.segment_payload` 增加 `"speaker": label|null`；`get_meeting` 的段落查詢帶 `speaker`。
- `review.save_segments` 存完後呼叫 `diarize.label_new_segments(conn, meeting_id)`：辨識已完成時，為 `speaker IS NULL AND NOT speaker_manual` 的段落標上。

**資料表 `webapp/migrations/012_speakers.sql`**

- `diarizations(meeting_id uuid PK → meetings ON DELETE CASCADE, status text CHECK (queued|running|done|failed), message text, turns jsonb NOT NULL DEFAULT '[]', requested_by text, queued_at, started_at, finished_at timestamptz, seconds real)`
- `meeting_speakers(meeting_id uuid → meetings ON DELETE CASCADE, label smallint CHECK (label > 0), name text NOT NULL DEFAULT '', username text, PRIMARY KEY (meeting_id, label))`
- `segments.speaker smallint`、`segments.speaker_manual boolean NOT NULL DEFAULT false`，`FOREIGN KEY (meeting_id, speaker) REFERENCES meeting_speakers ON DELETE SET NULL (speaker)`。

**校對頁**

- `webapp/static/speakers.js`：說話者面板（狀態、辨識／重新辨識按鈕、說話者清單：顏色點＋名字＋段數、點名字開啟編輯：團隊成員下拉或自填名字）、段落的說話者標籤（點擊開選單：會議中的說話者、新增說話者、不指定）。排隊／辨識中每 10 秒查一次狀態，完成後重新載入段落。顏色是 speakers.css 定義的 8 色（`--spk-1`…`--spk-8`，深淺主題各一組），超過 8 位用中性色（名字永遠以文字顯示）。
- `review.js` 在段落列加標籤節點，`review.html` 載入 speakers.js／speakers.css。

**紀要**：`minutes.build_messages` 讀段落的說話者顯示名稱（`name` → 成員顯示名稱 → `說話者 N`），有說話者時輸出 `[seq] 名字：原文`；`SYSTEM_PROMPT` 加一條規則。

**失敗處理**：服務無回應、逾時、500、解析不到任何片段 → `failed`＋訊息（中文，含原因前 200 字），不改段落與說話者。服務未設定時不顯示按鈕；沒有先前結果時整個說話者區塊不顯示，有先前結果時顯示「說話者辨識未設定（以下是先前的結果）」。

**驗收**

- 單元測試（`webapp/test_server.py`）：`parse_output`、`assign`（spec 的範例表）、路由權限與 409／400／422、`label_new_segments` 保留手動指定、重新辨識清除命名、紀要訊息格式、服務路徑檢查（`docker/diarize/server.py` 的 `resolve()` 以單元測試覆蓋）。
- `bench/speakers_e2e.mjs`：真實服務辨識一場測試會議 → 頁面顯示標籤 → 命名為成員 → 改一段 → 新增說話者 → 重新整理後保留。
- `bench/diarize/segment_eval.mjs`：以假麥克風播放一段 AliMeeting 10 分鐘片段開一場真實會議（本機引擎），辨識完成後，與標準答案比對段落歸屬正確率並寫進 bench/README；測試會議事後刪除。

**範圍**：只動上列檔案；不改即時轉錄、翻譯、分段、搜尋、問答。

## Risks / Trade-offs

- [處理時間約為會議長度 0.4–1.1 倍，期間占 16 個 CPU 執行緒] → 會後背景執行、一次一場；`DIARIZE_THREADS` 可調低；頁面顯示排隊與辨識中。
- [MOSS 偶爾多切一人（AISHELL-4 一段 7/6）] → 校對頁可把多出來的說話者命名成同一人，或改段落。
- [超過約 2.9 小時的錄音 transcribe.cpp 會拒絕] → 狀態 failed 並顯示原因。
- [對齊門檻是估計值] → 由真實頁面錄音的段落評估確認後才定案。
- [日文、台語未經標準答案評估] → 日文對談實測切出合理的 2 人；台語未測，結果靠校對修正。
