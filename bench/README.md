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

- `TAG` 以 `cloud` 開頭時會開啟雲端精修。
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
- `translate_e2e.mjs`：即時翻譯模式與浮動字幕的端到端驗收（真實頁面、假麥克風：切換後欄位隱藏與按鈕文案、重新整理後模式仍在、跑一段不建立會議、匯出 `translate-*.txt`；浮動字幕以彈出視窗代替 Document PiP：顯示譯文、暫譯樣式、原文切換、A+、設定在重新整理後仍套用、關閉後按鈕復原、切句範例（含小數）、無 API 時停用；無頭瀏覽器沒有分頁聲音可分享，以假麥克風代替；`YUQIAO_SESSION=… node bench/translate_e2e.mjs <wav> <截圖目錄>`）
- `catalogcheck.js`：會議預設名稱與「今天／本週／更早」分組（`TZ=Asia/Taipei node bench/catalogcheck.js`）
- `lagcheck.py`：用人工字幕量測 ASR 文字落後音訊多久，決定校對頁的播放前延
- `replay_browser.py --save-meeting`：重播存成一場會議（只有段落、沒有錄音），可在校對頁查看

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
