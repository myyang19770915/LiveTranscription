# 翻譯品質 Benchmark

用 10 段公開 YouTube 影片（中／日／英各 3–4 段，每段 4 分鐘）測完整流程：ASR → 斷句 → 即時翻譯 → 精修。
評分以盲評為主，ASR 錯字率為輔。

## 準備

```bash
python -m venv .venv && .venv/Scripts/pip install -r bench/requirements.txt   # 另需 ffmpeg、node、playwright（webapp/replay_page.mjs）
python bench/fetch.py            # 下載音訊（裁成 16 kHz wav）與字幕到 bench/data/
```

`bench/data/`、`bench/results/` 含第三方內容，不進 git。

語橋 Live 需要登入，錄軌與重播前先發一個 session（不需要密碼），並指定會議所屬團隊：

```powershell
$env:YUQIAO_SESSION = docker exec -w /app asr_confucius4-r2t2-app-1 python -m auth issue-session <帳號> --hours 12
$env:YUQIAO_TEAM = "研發部"   # 帳號只屬於一個團隊時可省略
```

## 流程

| 步驟 | 指令 | 產出 |
|---|---|---|
| 錄 ASR 軌（Confucius） | `python bench/run.py record` | `artifacts/replay/tracks/<case>_...json` |
| 錄 ASR 軌（MAI） | `python bench/mai_record.py [case ...]` | `artifacts/replay/tracks/mai_<case>_...json` |
| ASR 錯字率比較 | `python bench/trackcer.py` | Confucius 與 MAI 的 CER/WER |
| 重播進真實 UI | `python bench/run.py TAG` | `artifacts/replay/TAG_<case>.json` |
| 產生評分表 | `python bench/evaluate.py TAG` | `bench/results/TAG/<case>.md` |
| 盲評分組 | `python bench/blindn.py OUT SEED RUN_A RUN_B [RUN_C]` | `bench/results/OUT/<case>.X/Y/Z.md` |

- `TAG` 以 `cloud` 開頭時會開啟雲端精修。`REPLAY_LIVE=1` 以即時翻譯模式重播（字幕分段，中文 40 字就在逗號定稿），用來和開會模式比較翻譯品質。
- `ASR_ENGINE=mai`（或 `hybrid`）透過正式 gateway 錄 MAI 軌（檔名加 `_mai`／`_maip`）；`TRACK_PREFIX=mai_` 則重播 `mai_record.py` 錄的軌。
- 同一批 ASR 軌可重複使用，改翻譯或斷句時比較的是相同輸入。
- 盲評：每段影片由同一位評審依 `rubric.md` 同時評所有版本（滿分 100），評完才看 `mapping.json` 解盲。

## 連線檢查

- `python bench/check_cloud.py clip.wav`：litellm 翻譯模型
- `python bench/check_mai.py clip.wav ja`：MAI Realtime 串流轉錄

## 小工具

- `segcheck.js`：斷句規則案例
- `guardcheck.js`：精修防重複檢查
- `probe.py probe_*.json`：單句翻譯對照
- `contextcheck.js`：精修請求組裝（`translation-context.js`）與原本 inline 版本一致
- `boardcheck.js`：待辦看板的規則（已完成欄 14 天、到期色調、頭像、泳道；spec 範例）
- `timelinecheck.js`：段落時間、播放區間與證據側欄顯示哪些段落（spec 範例）
- `playback_e2e.mjs`：校對頁與紀要證據側欄的播放、暫停、繼續、空白鍵（`YUQIAO_SESSION=… node bench/playback_e2e.mjs <有錄音的會議 id> <有紀要的會議 id>`；紀要會議沒有錄音時借用前者的錄音，只改瀏覽器看到的回應，不寫入資料）
- `series_e2e.mjs`：系列會議的端到端驗收（就地新增系列、未完成清單、偵測選項預設關閉並記住、以假麥克風開會後會議屬於該系列、攔截回應驅動提示的套用與略過、紀要頁的剩餘提示、標頭與列表顯示系列、校對頁清除系列、400px；`YUQIAO_SESSION=… node bench/series_e2e.mjs <有待辦的會議 id> <截圖目錄>`；會建立一個「驗收系列」與一場短會議，結束時把來源會議移出系列）
- `actions_e2e.mjs`：待辦看板的端到端驗收（紀要頁設逾期、精簡卡片、拖曳換欄、拖到已取消需原因、詳細面板改負責人與到期日、`?item=` 分享、快速篩選互斥、頭像篩選、泳道、看板新增待辦（按鈕與 `c`、空白內容不送出、編輯內容、「看板新增」泳道、刪除需確認、會議待辦不能刪）、400px；`YUQIAO_SESSION=… node bench/actions_e2e.mjs <有待辦的會議 id> <截圖目錄>`；會把一個已確認待辦的到期日設成昨天）
- `metrics_e2e.mjs`：成效指標頁的端到端驗收（只讀取：頁首連結、四張指標卡、AI 分段長條與表格、每週長條圖的滑過提示與表格切換、轉錄表格、期間寫入網址、深色主題的系列色、400px；`YUQIAO_SESSION=… node bench/metrics_e2e.mjs <截圖目錄>`）
- `search_e2e.mjs`：全文搜尋的端到端驗收（只讀取：頁首「搜尋」按鈕（文字，與其他頁首按鈕一致，手機上也顯示）與 `/` 開啟、搜尋結果分組與標示、逐字稿結果開到校對頁那一段並可播放、類型篩選與網址還原、清除篩選、找不到的提示、慢查詢的載入狀態、較新的查詢優先、超過 5 個詞不送出、400px；`YUQIAO_SESSION=… node bench/search_e2e.mjs <會議 id> <截圖目錄> [詞，預設 合約]`）
- `qa_eval.py`＋`qa_eval_data.json`：問答（meeting-qa）的檢索評測。把 6 場擬真會議（含同系列的後續會議當干擾）與 35 題（關鍵字、換句話說、跨語言、無解）載入獨立的評測資料庫 `yuqiao_qa_eval`（結束時刪除），用目前的 `embed` 服務建索引，輸出關鍵字、向量、混合三種檢索的 recall@5／@8／@10 與 MRR；加 `--answer` 會實際呼叫紀要模型，統計引用到正確出處與無解題回「找不到」的比例。換 embedding 模型比較時，先以 `EMBED_MODEL_REPO`／`EMBED_MODEL_FILE`／`EMBED_POOLING` 重啟 `embed`，再以相同的 `EMBED_MODEL_FILE` 執行：`docker cp bench/qa_eval.py bench/qa_eval_data.json` 到 app 容器 `/tmp/` 後 `docker exec -w /app -e EMBED_MODEL_FILE=bge-m3-q8_0.gguf asr_confucius4-r2t2-app-1 python /tmp/qa_eval.py /tmp/qa_eval_data.json [--answer]`
- `qa_e2e.mjs`：問答頁的端到端驗收（攔截 `/api/ask` 回固定內容，不呼叫模型：全文搜尋與問答互相切換帶著字與篩選、打開網址不自動送出、Enter 送出與 Shift+Enter 換行、載入狀態、[n] 與出處在右側側欄開啟（逐字稿前後各一段、紀要條目附證據段落、Esc 關閉並還原焦點，不離開頁面）、有錄音的段落在側欄播放／暫停／繼續（按鈕與空白鍵）、較新的問題優先、找不到連到全文搜尋、只用關鍵字與錯誤的提示、空白問題不送出、索引進度與服務狀態的提示、400px；加 `live` 另外實際問一次模型）：`YUQIAO_SESSION=… node bench/qa_e2e.mjs <會議 id> <截圖目錄> [有錄音的會議 id] [live]`
- `progress_model_eval.py`：會中進度提示的真實模型評估（5 條待辦 × 10 種逐字稿情境，經正式程式送到目前設定的紀要模型，比對預期並統計命中、漏報、誤報與延遲；不寫資料庫，但會呼叫模型 10×N 次）。在 app 容器內執行：`docker cp bench/progress_model_eval.py asr_confucius4-r2t2-app-1:/tmp/` 後 `docker exec -w /app -e PYTHONPATH=/app asr_confucius4-r2t2-app-1 python /tmp/progress_model_eval.py <N>`
- `avatar_e2e.mjs`：成員頭像照片的端到端驗收（團隊管理點頭像後的裁切視窗：預設置中框、取消與 Esc 不上傳、拖曳停在照片邊緣、右下角與滑桿縮放、確定後上傳的是框選範圍；上傳照片為 160×160、看板頭像篩選（按下仍是正圓）、卡片、詳細面板與泳道顯示照片、照片載入失敗退回首字、400px 不橫向捲動、移除後回到首字；頁首選單換自己的照片、看板免重新整理即更新、移除與 Esc 關閉；以系統管理員登入：`YUQIAO_SESSION=… node bench/avatar_e2e.mjs <團隊名稱> <成員帳號> <截圖目錄>`；結束時會移除該成員的照片，並把登入者原本的照片放回去）
- `minutes_e2e.mjs`：會議紀要的端到端驗收（產生、改負責人並確認、駁回、新增、下載 Markdown、證據側欄、分頁切換與返回；`YUQIAO_SESSION=… node bench/minutes_e2e.mjs <會議 id> <截圖目錄>`）
- `catalog_e2e.mjs`：會議主題與篩選的端到端驗收（真實頁面、假麥克風；`YUQIAO_SESSION=… node bench/catalog_e2e.mjs <wav> <截圖目錄>`）
- `translate_e2e.mjs`：即時翻譯模式與浮動字幕的端到端驗收（真實頁面、假麥克風：切換後欄位隱藏與按鈕文案、重新整理後模式仍在、跑一段不建立會議、匯出 `translate-*.txt`；浮動字幕以彈出視窗代替 Document PiP：顯示譯文、暫譯樣式、原文切換、A+、設定在重新整理後仍套用、關閉後按鈕復原、切句範例（含小數）、無 API 時停用；畫面＋字幕以 canvas 影像軌假裝分享的分頁：純麥克風時按鈕停用、分頁來源時可用、覆蓋層顯示畫面與頁面譯文、透明度滑桿只改底色 alpha、拖曳後位置記住並在重新開啟時套用、Esc 關閉、結束後停用；無頭瀏覽器沒有分頁聲音可分享，以假麥克風代替；`YUQIAO_SESSION=… node bench/translate_e2e.mjs <wav> <截圖目錄>`）
- `catalogcheck.js`：會議預設名稱與「今天／本週／更早」分組（`TZ=Asia/Taipei node bench/catalogcheck.js`）
- `lagcheck.py`：用人工字幕量測 ASR 文字落後音訊多久，決定校對頁的播放前延
- `lag_gateway.py`：以指定封包大小把 bench 片段經 `/ws/transcribe`（翻譯模式，不建會議、不寫檔）送給指定引擎，記錄每個事件的到達時間；`--compare` 對另一條軌印出同一段文字晚多少到達（中位數／p10／p90），中日文片段另印文字落後人工字幕多久（`YUQIAO_SESSION=… python bench/lag_gateway.py <片段> <local|mai|hybrid> <封包毫秒> <秒數> <out.jsonl> [--compare 另一條.jsonl]`）
- 精準模式（quality-pass）：`python bench/run.py quality1 [片段…]` 以 `quality` 開頭的 TAG 錄下含 quality 事件的軌（軌檔名多 `_q<目標語言>`）並在重播時勾選精準模式；評分表的段落是頁面保留的句子。需要先在 `.env` 設定 `TRANSLATE_QUALITY_ASR_MODEL` 與 `TRANSLATE_QUALITY_MODEL`。`bench/qualitycheck.js` 檢查頁面的取代與退回規則。2026-11-13 只以 60 秒片段經暫時閘道器（gemini-3.5-transcribe＋gemini-3.5-flash-lite）驗證過錄軌與重播的流程，完整 10 段的盲評見文末「2026-11-14 精準模式 10 段盲評」。
- `replay_browser.py --save-meeting`：重播存成一場會議（只有段落、沒有錄音），可在校對頁查看

## 2026-11-08 說話者辨識評估（speaker-diarization）

資料：Hugging Face `argmaxinc/ali-meetings`（AliMeeting 測試集，遠場會議，4 人）與 `argmaxinc/aishell-4`（AISHELL-4 測試集，6 人）的 parquet 分片，含逐人發言時間。取 AliMeeting 3 場、AISHELL-4 2 場的前 10 分鐘，另取一場完整 34 分鐘的 AliMeeting。分數：DER（10 毫秒格、最佳說話者對應、標準答案邊界前後 0.25 秒不計、含重疊）與段落歸屬正確率（每段 1 秒以上的標準答案發言，歸給正確說話者的時間比例）。速度＝處理時間÷音訊長度。

| 方案 | 10 分鐘平均 DER | 段落歸屬正確率 | 34 分鐘 DER | 速度 |
|---|---|---|---|---|
| sherpa-onnx：pyannote segmentation 3.0＋CAM++ zh_en（閾值 1.0） | 11.7% | 85.4% | 29.4% | 0.09 |
| 同上，閾值 0.9／1.1 | 14.1%／23.6% | 82.6%／72.8% | — | — |
| 同上，給正確人數 | 24.3%（3 段） | 75.9% | — | — |
| sherpa-onnx：TitaNet small／WeSpeaker ResNet34（閾值 1.0） | 26.7%／46.2% | 70.7%／51.4% | — | — |
| MOSS-Transcribe-Diarize 0.9B，GPU bf16（PyTorch） | 5.4% | 92.7% | 7.2% | 0.20（34 分鐘 0.57，峰值 8.1 GB） |
| MOSS-Transcribe-Diarize Q8_0，CPU 16 執行緒（transcribe.cpp） | **5.6%** | **92.7%** | — | 0.42–1.13（AISHELL-4 0.42／0.47，AliMeeting 1.13） |
| MOSS，PyTorch CPU float32 | — | — | — | 超過 1.2（10 分鐘音訊 12 分鐘未完成，停止） |

人數：MOSS 5 段猜對 4 段（AISHELL-4 一段 7/6）；sherpa（閾值 1.0）每段多切 1–11 人。日文對談（ja_pivot）與英文法說會（en_tesla）MOSS 分別切出 2 人、5 人，內容合理（無標準答案）。AliMeeting 後兩段的 CPU 時間與 GPU 測試同時執行，偏慢。

結論：採用 MOSS Q8_0 CPU 版（會後背景執行，不占 GPU）。重現：

```bash
docker build -t diar-eval -f bench/diarize/Dockerfile.eval bench/diarize
mkdir -p bench/diarize/work/data && cd bench/diarize/work   # 下載分片到 data/、sherpa 模型到 models/、MOSS 權重到 moss-model/
docker run --rm -v "$PWD/..:/bench" -w /bench/work diar-eval python ../prep.py 10 2 data/clips ali=data/ali0.parquet aishell=data/aishell0.parquet
docker run --rm -v "$PWD/..:/bench" -w /bench/work diar-eval python ../run_sherpa.py cam-1.0 3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx 1.0 8
docker run --rm --gpus all -v "$PWD/..:/bench" -w /bench/work diar-eval python ../run_moss.py moss-gpu cuda 4
docker run --rm --entrypoint sh -v "$PWD/..:/bench" -w /bench/work asr_confucius4-r2t2-diarize ../run_tcpp.sh moss-q8cpu data/clips 16
docker run --rm -v "$PWD/..:/bench" -w /bench/work diar-eval python ../score.py
```

### 段落層級（真實頁面錄音）

以假麥克風播放 AliMeeting 一場的前 10 分鐘（4 人），用開會頁（本機引擎、開會模式）錄成一場真實會議，再以 app 的辨識流程（`diarize.run_next`，對 diarize 服務）處理：40 段全部標上說話者，切出 4 人（與標準答案相同），處理 602 秒。每段的「正確說話者」＝段落時間往前移 1 秒後，標準答案中講最久的人；「清楚」＝移 0.5–2 秒結果都一樣且占七成以上。

| 段落時間比實際晚 | 文字對齊（採用） | 只用時間重疊 |
|---|---|---|
| 照實（本機引擎） | 85.0% | 92.5% |
| ＋1 秒 | 85.0% | 90.0% |
| ＋1.7 秒（約雲端 MAI） | 85.0% | 85.0% |
| ＋3 秒 | 85.0% | 80.0% |
| 清楚屬於一人的 18 段 | 100% | 100% |

兩者不一致的 3 段都是多人交替的段落：文字對齊選講了這段最多字的人，標準答案依講話秒數，而且本身就是用時間算的，所以照實時對時間法有利。文字對齊不受轉錄延遲影響，時間法隨延遲下滑，因此採用文字對齊，門檻（前 12 秒、後 3 秒、三成字、時間法前移 1 秒）維持設計值。工具：`bench/diarize/segment_eval.mjs`（錄會議）、`bench/diarize/segment_eval.py`（在 app 容器計分），測試會議事後以 `segment_eval.mjs --delete` 刪除。

## 2026-11-08 即時翻譯分段比較（live-subtitle-segments，`meetzh` vs `livezh`，盲評 `blindzh`）

即時翻譯模式把中文連續說話的定稿門檻從 100 字降到 40 字（在穩定的逗號切、每段 ≤60 字）。同一批 ASR 軌、同一套上下文機制，重播後依 rubric 盲評：

| 片段 | 開會規則 100 字 | 即時規則 40 字 | 段數（開會→即時） | 每段原文中位數 |
|---|---|---|---|---|
| zh_jian（zh→ja） | 77 | 79 | 15 → 33 | 82 → 33 字 |
| zh_chen（zh→en） | 84 | 83 | 15 → 31 | 82 → 33 字 |
| zh_fire（zh→ja） | 88 | 86 | 14 → 31 | 82.5 → 31 字 |
| 平均 | 83.0 | 82.7 | | |

即時版的失分是逗號結尾的短句與少數接續生硬（「會變通，｜改往上跑的」）；開會版的失分是長段造成的主詞誤判與幻覺（「皆さんは心配されますよね」「2歳児のようなものです」）。正確性持平、定稿頻率加倍，即時模式採用 40 字；開會模式不變。

## 2026-11-08 延遲量測（asr-latency）

使用者反映混合引擎（英文走雲端 MAI）比一開始慢約 1 秒。以 `lag_gateway.py` 送 en_tesla／zh_jian 前 60 秒（160 毫秒一包）：

| 量測 | 結果 |
|---|---|
| 本機 Confucius，中文文字落後語音（人工字幕，2 個句尾） | 中位數 0.40 秒；每 0.16 秒更新 |
| 雲端 MAI 英文，同一段文字比本機晚多久出現 | 中位數 **1.33 秒**，p90 2.06 秒（n=18） |
| 雲端 MAI 中文，同上 | 中位數 0.73 秒，p90 1.91 秒（n=18） |
| 英文也在 0.8 秒停頓時提交（實驗，未採用） | 1.40 秒，沒有改善，且文字變差（「Well, um.No, I I I think.」） |
| 翻譯模型每次請求（llama.cpp 日誌） | 約 0.25 秒（200 tokens/s） |
| 瀏覽器路徑比直接打閘道器多（同一段文字到達時間差，n=27） | 0.2–0.6 秒 |
| 直接打閘道器，2.7 毫秒一包比 160 毫秒一包晚多久（MAI 英文，n=77） | 中位數 0.13 秒 |
| 改成 20 毫秒一包後，直接打閘道器 20 毫秒一包與 160 毫秒一包比較（本機英文，`lag_gateway.py --compare`，n=14） | 中位數差 0.14 秒（20 毫秒略晚；本機引擎固定每 0.16 秒處理一步，封包大小影響不大） |

結論：慢的是雲端 MAI 的固有串流節奏，伺服器與翻譯沒有變慢。改動：瀏覽器送音從每 128 個取樣（48 kHz 時 2.7 毫秒、每秒約 375 則）改為每 20 毫秒一則（`pcm-worklet.js`），省下主執行緒、閘道器與 MAI 端每則訊息的處理（對 MAI 實測早 0.13 秒，對本機引擎沒有差別）；辨識引擎欄位註明雲端約慢 1 秒。

## 2026-11-03 結果（blind6，正式 gateway 版）

| 版本 | 平均 | 英文 | 日文 | 中文 |
|---|---|---|---|---|
| Confucius + 雲端精修（`cloud1`） | 79.8 | 81.7 | 74.8 | **84.7** |
| MAI 規則標點 + 雲端精修（`cloud_mai`，腳本錄製） | 85.2 | 87.7 | **86.8** | 80.7 |
| MAI 正式 gateway + 雲端精修，中文雲端補標點（`cloud_maig`） | 83.8 | **90.3** | 86.5 | 73.7 |

- 混合模式（英日 MAI、中文 Confucius）推算約 **87.1**。
- 中文雲端補標點變差：模型常在話還沒講完時補「。」，斷句切斷句子，因此預設關閉（`TRANSLATE_PUNCTUATE_MAI`）。
- 單支分數在不同輪次會浮動 ±5，看平均與同一輪內的比較。

## 2026-11-03 結果（blind5）

| 版本 | 平均 | 英文 | 日文 | 中文 |
|---|---|---|---|---|
| 本機 v6（Confucius + Gemma） | 78.3 | 82.3 | 74.8 | 79.0 |
| Confucius + 雲端精修 | 82.0 | 84.0 | 77.8 | 85.7 |
| MAI + 雲端精修 | 85.9 | 88.7 | 88.0 | 80.3 |

## 2026-11-14 精準模式的第二次辨識用哪個引擎（盲評 `blind_q1`，只有 `zh_fire` 一段）

同一段 4 分鐘中文演講（zh→ja），六個版本同一位評審同一輪依 `rubric.md` 評分。精準模式四版的即時引擎都是本機 Confucius，文字模型都是 `deepseek-v4-flash`（`TRANSLATE_QUALITY_EXTRA={"thinking":{"type":"disabled"}}`；開著推理時單塊約 20 秒，收尾會逾時），以即時翻譯模式經暫時閘道器錄製後重播；兩個基準版是開會模式加雲端精修。

| 版本 | 設定 | 盲評 | 留下的原文 CER | `audioMs − throughMs` 中位數 | 段數 |
|---|---|---|---|---|---|
| `quality_q` | 第二次辨識：本機 Qwen3-ASR 1.7B（`TRANSLATE_QUALITY_ASR_URL`，`qwen-asr-serve`） | **92** | 3.4% | 1.8 秒 | 36 |
| `quality_m` | 第二次辨識：Azure MAI（`TRANSLATE_QUALITY_ASR=mai`） | 90 | **3.3%** | 4.8 秒 | 41 |
| `cloudm` | 基準：MAI 即時（`mai_record.py` 的軌）＋雲端精修 | 83 | 4.2% | — | 28 |
| `cloudc` | 基準：Confucius 即時＋雲端精修 | 82 | 4.2% | — | 14 |
| `quality_l` | 第二次辨識：本機 Confucius（`TRANSLATE_QUALITY_ASR=local`） | 82 | 6.6% | 3.8 秒 | 36 |
| `quality_g` | 第二次辨識：`gemini-3.5-transcribe` | 77 | 5.9% | 6.4 秒 | 43 |

- 六版各 36 個 quality 事件，沒有失敗的區塊。CER 以頁面最後留下的段落原文對 `sub.zh-TW.vtt` 計算（`evaluate.py` 表頭的 CER 取自即時逐字稿，精準模式各版都一樣，不能用來比較）。
- 評審意見（`bench/results/blind_q1/judge.md`）：Qwen 與 MAI 兩版內容齊全、每段是完整句子；兩個基準版失分在句中切段與大塊文字；Confucius 當第二次辨識時有兩段在句中截斷並漏字（留下 899 字，其他版約 930 字）；Gemini 版有辨識錯字變成無意義譯文並漏一句。
- 82、83、82 三版差距在 1 分內，視為同級。只有一段影片，不能當成平均，也不能和其他輪次的分數比。
- 花費：litellm 以 UTC 分日，與前一天混計，上限為 DeepSeek 0.33 美元、Gemini 辨識 0.045 美元；MAI 另由 Azure 計費（約 6 分鐘音訊）；Qwen3-ASR 與 Confucius 在本機。
- Qwen3-ASR 佔用約 10 GB 顯示卡記憶體（`--gpu-memory-utilization 0.3`），錄製時先停了本機翻譯模型才放得下。

## 2026-11-14 精準模式 10 段盲評（`blind_q10`，三版）

每段影片一位評審同一輪依 `rubric.md` 評三個版本。精準模式兩版的即時引擎是本機 Confucius、文字模型是關掉推理的 `deepseek-v4-flash`，以即時翻譯模式錄製後重播；基準版是 `mai_record.py` 的 MAI 軌以開會模式加雲端精修重播。當時翻譯草稿與定稿都已改走雲端（cloud-translation）。

| 片段 | 精準模式＋MAI（`quality_m10`） | 基準：MAI 即時＋雲端精修（`cloudb`） | 精準模式＋Qwen3-ASR 1.7B（`quality_q10`） |
|---|---|---|---|
| en_tesla | 90 | 84 | 82 |
| en_torres | 84 | 86 | 75 |
| zh_fire | 87 | 80 | 91 |
| ja_bluu | 86 | 83 | 80 |
| en_sinek | 88 | 79 | 84 |
| zh_chen | 86 | 79 | 87 |
| zh_jian | 78 | 72 | 76 |
| ja_taguchi | 93 | 86 | 71 |
| ja_komuro | 70 | 84 | 81 |
| ja_pivot | 85 | 81 | 79 |
| **平均** | **84.7** | 81.4 | 80.6 |
| 英文 3 段 | 87.3 | 83.0 | 80.3 |
| 日文 4 段 | 83.5 | 83.5 | 77.8 |
| 中文 3 段 | 83.7 | 77.0 | 84.7 |

- 精準模式＋MAI 在 10 段中有 8 段高於基準，平均高 3.3 分；精準模式＋Qwen3-ASR 只有 4 段高於基準，平均與基準相當：中文高 7.7 分，日文低 5.7 分（`ja_taguchi` 的「葉巻たばこ」「仲買人」「事業」等詞辨識錯誤）。同日早上只有 `zh_fire` 一段的結果（Qwen 92、MAI 90）不能代表平均。
- 主要失分是內容遺漏：`ja_komuro` 的 MAI 版掉了四整段（70 分），`en_torres` 的 Qwen 版掉了一整個案例（75 分）。頁面留下的原文對字幕的錯字率（CER，英文為 WER）10 段平均：基準 9.1%、MAI 版 11.6%、Qwen 版 11.5%；精準模式兩版都比基準高，與遺漏一致。遺漏發生在第二次辨識還是文字模型，尚未查明。
- `audioMs − throughMs` 中位數：Qwen 版各段 1.8–2.2 秒，MAI 版 4.4–6.0 秒。20 條軌、約 660 塊中沒有失敗的區塊（修正後）。
- 評測中發現並修正的問題：Qwen3-ASR 新容器的第一段語音要暖機約 30 秒（健康檢查改為實際辨識）；`ja_pivot` 一塊 17.9 秒的日文重複輸出到上限而逾時（`TRANSLATE_QUALITY_ASR_EXTRA` 限制輸出長度，結尾的重複收成一次）；英文→日文被譯成中文（每次請求加 `TRANSLATE INTO`）。`en_sinek` 因最後一項在修正後重錄並單獨重評（`bench/results/blind_sinek/`），表中是重評的分數；其餘 9 段是修正前錄的，方向不受該問題影響。
- 單支分數在不同輪次會浮動約 ±5，82 與 81 這種差距不具鑑別力；評審全文在 `bench/results/blind_q10/judge_<片段>.md`。
- `python bench/run.py quality1 zh_fire` 與 `python bench/evaluate.py quality1` 已實跑：軌中 36 個 quality 事件、沒有失敗，評分表每段是一句且來自 quality 事件。
- 另有兩個瀏覽器檢查：`bench/quality_e2e.mjs`（開關、連線標頭、連續失敗的狀態、停止時的等待）與 `bench/privacy_e2e.mjs`（隱私標示）。
