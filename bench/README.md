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

## 2026-11-14 精準模式的內容遺漏出在哪一層（quality-completeness）

把片段離線跑過 `QualityPass`，記錄每塊的辨識文字與文字模型的回答（修正前的程式）：

| 片段與第二次辨識 | 區塊 | 辨識文字 → 最後保留 | 辨識明顯偏少的區塊 |
|---|---|---|---|
| `ja_komuro`，MAI | 32 | 1309 → 1305 字（100%） | 2 塊：10.3 秒語音 19 字、8.9 秒語音 8 字（中位數每秒 8.1 字） |
| `en_torres`，Qwen3-ASR | 36 | 509 → 485 字（95%） | 無 |
| `zh_chen`，MAI | 37 | 1002 → 983 字（98%） | 1 塊：3.9 秒語音 11 字 |

- **MAI 是串流模型，整塊一次送完只會辨識開頭。** `ja_komuro` 第 12.0–25.6 秒那塊直接送 MAI：一次送完得到 16 字，4 倍速 38 字，照實際速度 95 字（完整）。評審指出遺漏的兩段就是這兩塊。修正：精準模式用 MAI 時另開一條連線，音訊照收到的速度送，在區塊切點 commit。修正後同一片段照實際速度重跑：辨識 1454 字（多 11%），沒有偏少的區塊，32 塊都通過完整性檢查；原本只有 19 字與 8 字的兩塊（第 12.0–25.6 秒、第 38.2–50.1 秒）現在是 91 字與 77 字。工具：`bench/omit_probe.py`（在 app 容器內執行，`REALTIME=1` 時照實際速度送音）與 `bench/omit_analyze.py`。
- **文字模型偶爾丟掉前一塊留下的句子。** 評測那次 `en_torres` 掉了一整個案例，重跑沒有發生。修正：回答中的原文少於輸入的 70%（輸入至少 12 個單位）或多於 150%＋10 時重問一次，仍不合格則該塊失敗、保留即時結果；提示改為明確禁止刪減。
- 這一輪 10 段盲評的 MAI 版（平均 84.7）是在「整塊一次送完」的情況下得到的。

### 修正後重錄三段的盲評（`blind_h`、`blind_i`）

正式站設定 `TRANSLATE_QUALITY_ASR=hybrid`（中文 Qwen3-ASR、其他語言 MAI 即時送音），每段一位評審同輪評三版：基準 `cloudb`、修正前的精準模式（10 段盲評時的軌）、修正後。

| 片段（第二次辨識） | 基準 | 修正前 | 第一輪修正（`quality_h`） | 第二輪修正（`quality_i`） |
|---|---|---|---|---|
| `ja_komuro`（MAI） | 85／87 | 71／69 | 82 | **89** |
| `en_torres`（MAI） | 87／85 | 85／83 | 76 | **88** |
| `zh_chen`（Qwen3-ASR） | 77／83 | 88／87 | 85 | 79 |

基準與修正前各有兩個分數，是兩輪評審各評一次（同一份評分表），可看出同一份內容在不同輪次約有 ±3 分的浮動。

- 第一輪修正（MAI 即時送音＋完整性檢查）讓 `ja_komuro` 補回內容，但 `en_torres` 反而變差：105 塊中有 3 塊被完整性檢查擋下而退回即時結果，接縫處出現重複句與漏句。重現後發現被擋下的回答其實正常，是閘道器把「保留到下一塊的句子」接了兩次（文字模型同時把它寫在最後一句與 carry），輸入變成兩倍長。
- 第二輪修正（carry 不重複、重複的句子只顯示一次、檢查不過時整段留給下一塊重問而不退回即時結果）後，三段 105 塊沒有任何失敗，只有 1 塊留給下一塊；`ja_komuro` 與 `en_torres` 都超過基準，評審的完整性子分數為 14／15 與 14／15。
- `zh_chen` 三次的分數是 88、85、79，第二次辨識與設定都相同；最後一次的主要失分是把女性當事人譯成 he/him（七段），屬於文字模型每次回答的差異，不是這次修正造成的，也還沒有對策。
- 只有三段，不能代表 10 段的平均；完整的 10 段還沒有用修正後的程式重跑。

## MAI 用量紀錄（mai-usage）

Azure MAI 每小時音訊 0.54 美元。經過 app 的用量（即時引擎、精準模式）由系統自動記錄；評測腳本直接連 MAI 的部分（`mai_record.py`、`check_mai.py`、對 MAI 的探測）要手動登記：

```
docker exec -w /app asr_confucius4-r2t2-app-1 python -m mai_usage add <秒數> bench
docker exec -w /app asr_confucius4-r2t2-app-1 python -m mai_usage          # 印出累計小時、金額與上限
```

- 2026-11-14 紀錄功能上線前的用量以 4800 秒（80 分鐘）登記為 `bench`，是依各次錄製與探測的片長加總的估計，不是帳單數字：單段六版 6 分鐘、10 段盲評的 MAI 版 40 分鐘、遺漏調查的探測約 9 分鐘、修正後的重跑與兩輪三段重錄 24 分鐘。2026-11-13 以前的用量沒有紀錄。
- 累計上限是 50 美元（自 2026-11-14 起累計）；跑會用到 MAI 的評測前先看累計金額。一段 4 分鐘的片段約 0.036 美元，10 段中 7 段非中文約 0.25 美元。

## 2026-11-14 修正後的完整 10 段與回顧修訂（quality-revision）

三輪盲評，每段一位評審同輪評三版；正式站設定（`TRANSLATE_QUALITY_ASR=hybrid`：中文 Qwen3-ASR、其他語言 MAI 即時送音，文字模型 `deepseek-v4-flash`）。不同輪的分數不能直接相比，看同一輪內的差距。

| 輪次 | 比較的版本 | 平均 | 英文 3 段 | 日文 4 段 | 中文 3 段 |
|---|---|---|---|---|---|
| `blind_j` | 基準 `cloudb` | 80.7 | 82.3 | 82.3 | 77.0 |
| | 修正前的精準模式（`quality_m10`／中文 `quality_q10`） | 83.1 | 86.7 | 79.8 | 84.0 |
| | 內容遺漏修正後（`quality_j`） | **86.2** | 86.0 | 88.8 | 83.0 |
| `blind_k` | 基準 `cloudb` | 80.1 | 83.3 | 79.8 | 77.3 |
| | `quality_j`（同一份） | 85.4 | 87.0 | 86.3 | 82.7 |
| | `quality_j` 離線加上回顧修訂的原型（`review_p1`） | **88.8** | 90.0 | 88.8 | 87.7 |
| `blind_l` | 基準 `cloudb` | 80.4 | 82.3 | 80.5 | 78.3 |
| | `quality_j`（同一份） | 86.1 | 88.0 | 87.8 | 82.0 |
| | 正式站開啟回顧修訂後重錄（`quality_k`） | **87.8** | 89.0 | 85.5 | 89.7 |

- **內容遺漏的修正**（quality-completeness）在完整 10 段上把精準模式由 83.1 提到 86.2，10 段中 9 段高於基準；342 塊沒有失敗，2 塊留給下一塊。
- **回顧修訂的原型**：同一份第一輪結果離線修訂，10 段全部進步（平均 +3.4，`zh_jian` 77→86、`en_sinek` 84→89、`zh_chen` 81→85）。原型允許合併被切開的句子，正式實作不改句數。
- **正式實作重錄**（`quality_k`）：平均 87.8，比沒有修訂的那次錄製高 1.7 分；5 段較高（`zh_jian` +16、`zh_chen` +6、`en_sinek` +5、`ja_taguchi` +3、`zh_fire` +1）、5 段較低（`ja_bluu` −6、`ja_pivot` −5，其餘 −1）。這是兩次不同的錄製，包含第一輪每次回答的差異（單段約 ±5），不像原型那樣是同一份內容的前後比較；變低的兩段，評審指出的是第一輪辨識與斷句的差異（重複句、「鍛えていく」聽成「期待」），不是被修訂改壞。
- 修訂的運作：59 個視窗全部成功，350 句中改了 55 句；每個視窗中位數 9.9 秒、九成在 28 秒內、最慢 72 秒。10 段中有 3 段在結束時最後 5–7 句來不及在 30 秒內修訂，維持第一輪結果；結束後到連線關閉 4–33 秒。
- 文字模型開推理直接用在第一輪不可行：同一段 `zh_chen` 離線比較（`blind_think`），關閉推理每塊中位數 1.4 秒（82 分），開啟 7.9 秒、最慢 34 秒（86 分），`reasoning_effort: low` 7.2 秒、最慢 26 秒（89 分）；語音約每 6.5 秒一塊，跟不上。
- 目標 95 分尚未達到。修訂後仍留下的錯誤：兩個辨識引擎都聽錯的詞（「問題山積」→「問題最先」、「リンレイ村」→「リンデ村」、"Will we deploy" → "We deploy"）、第一輪把兩句併成一句或切在子句中間（修訂不改句數）、第一輪偶爾的重複句。
- MAI 用量：這兩次 10 段錄製各 28 分鐘（各約 0.25 美元），累計約 1.23 美元。

## 2026-11-14 字幕與兩欄的流暢度（smooth-subtitles）

`bench/smooth_e2e.mjs` 把錄好的事件依原本的時間播進真實頁面（浮動字幕以同尺寸的 iframe 代替 Picture-in-Picture 視窗，畫面＋字幕以 canvas 代替分享的畫面），每個動畫格比較各顯示面上看得到的文字與位置。

```
YUQIAO_SESSION=… node bench/smooth_e2e.mjs artifacts/replay/tracks/qk_en_tesla_en_0_240_qzh.json --seconds 90 --quality --language en --target zh --source
```

同一段錄製（英→中、精準模式、原文開啟、90 秒），每分鐘的次數。暫譯每次重播都是重新向文字模型請求，所以各次執行之間有差異；修改後的數字是最後一次執行，括號是修改期間幾次執行的範圍。

| 顯示面 | 指標 | 修改前 | 修改後 |
|---|---|---|---|
| 浮動字幕 | 整行瞬間跳動 | 26.7 | 2.7（2.7–4.7） |
| 畫面＋字幕 | 整行瞬間跳動 | 12.0 | 2.7（2.0–4.0） |
| 原文欄 | 整行瞬間跳動 | 10.0 | 2.7 |
| 譯文欄 | 整行瞬間跳動 | 16.7 | 8.7（6.7–9.3） |
| 暫譯 | 被收回的字數 | 271（238–271） | 187（174–213） |
| 畫面＋字幕 | 字幕框高度改變 | 0 | 0 |

- 「整行瞬間跳動」：修改前以單一動畫格位移超過 12 px 計（當時所有位移都在一格內完成，每次約一行 38–46 px）；修改後以單一動畫格位移 30 px 以上計，另外回報超過 12 px 的格數（浮動字幕 3.3、畫面＋字幕 2.7、原文欄 18.0、譯文欄 26.0，兩欄的多數是平滑捲動較快的那幾格）。修改後只計算畫面上看得到的文字；修改前的版本沒有裁切框，兩者在這一點上相同。
- 浮動字幕與畫面＋字幕剩下的跳動來自文字本身被換成行數不同的內容：暫譯定稿後比暫譯多或少一行、精準模式的句子取代即時段落。
- 位移的次數變多是預期的：同一段位移由一格變成約 15 格的動畫。「來回」（1.5 秒內反向移動）因此也變多（浮動字幕 0.7 → 23、畫面＋字幕 2.0 → 27），其中包含同一次動畫裡不同區塊的小幅反向位移；這個指標在修改前後不能直接相比。
- 兩欄的內容與排版沒有改，只把跟隨改成平滑捲動；精準模式的句子取代即時文字時，還沒捲動的欄位（內容不到一欄高）仍會整段重排。
- 「正在講」的原文每分鐘被收回約 800 字，修改前後相同：這是雲端引擎的暫定字被改寫，不在這次的範圍。
- 單位是 1440×900 的無頭 Chromium、預設字級（28 px）、浮動字幕 760×260。只量了這一段錄製。

## 2026-11-14 回顧修訂可合併句子（revision-merge）

`blind_m`：每段一位評審同輪評三版；`quality_rm` 是正式站開啟可合併的回顧修訂後重錄（錄製 `ql_*`），`quality_k` 是上一版（不改句數）的錄製。

| 版本 | 平均 | 英文 3 段 | 日文 4 段 | 中文 3 段 |
|---|---|---|---|---|
| 基準 `cloudb` | 79.5 | 81.3 | 80.2 | 76.7 |
| 回顧修訂、不改句數（`quality_k`） | 88.6 | 89.3 | 87.8 | 89.0 |
| 回顧修訂、可合併（`quality_rm`） | 87.6 | 89.0 | 89.0 | 84.3 |

- 可合併的版本沒有比上一版高：平均低 1.0 分，4 段較高（`en_tesla` +7、`ja_bluu` +5、`ja_komuro` +2、`ja_pivot` +2）、6 段較低（`zh_jian` −10、`ja_taguchi` −4、`en_torres` −4、`en_sinek` −4、`zh_chen` −2、`zh_fire` −2）。這是兩次不同的錄製，單段 ±5 在第一輪每次回答的差異範圍內；`zh_jian` 的 −10 來自第一輪辨識（「程式設計」聽成「城市設計」、「十題」聽成「實體」），不是合併造成的。
- 合併本身的運作：54 個視窗全部成功，329 句改了 54 句、併入 12 句（3.6%）。`ja_taguchi` 的評審指出一段把四句話併成一大段。這次錄製時一個項目最多可併 3 句；之後收緊為 2 句（`MERGE_MAX`），尚未重新量測。
- 這次錄製時，結束時的各組仍要等正在修訂的那一組回來才送出，10 段中 5 段留下 3–16 句沒修訂；之後已改成結束當下立即同時送出（單元測試涵蓋），尚未用新的錄製量測。
- 結論：合併句子在這組測試上沒有量到分數的提升；原型（離線、同一份內容）量到的 +3.4 主要來自修訂本身而不是合併。目標 95 分尚未達到，三輪下來精準模式加回顧修訂穩定在 87–89。
- MAI 用量：這次錄製 28 分鐘（約 0.25 美元）。
