## Context

即時路徑：瀏覽器把 16 kHz PCM16 經 `/ws/transcribe` 送到閘道器（`webapp/server.py` 的 `transcribe()`），閘道器轉給本機 ASR 或 Azure MAI（`webapp/mai_asr.py` 的 `MaiBridge`），辨識事件回到 `webapp/static/app.js` 的 `onMessage()`；斷句由 `segmentation.js` 的規則決定，翻譯由本機小模型即時完成，選用的「雲端精修」只在背景重譯已定稿的段落，改不了原文與斷句。

2026-11-13 離線原型（暫存目錄的 proto.py，不進版本庫）量到：
- 同一輪盲評 10 段影片平均 91.5 分，既有最佳組合 83.0 分（實測）。
- 第二段辨識每塊約 2 秒、文字模型每塊中位數約 3–6 秒（gpt-5.5，實測）；較小的模型約 1–2 秒（實測）。
- 原型第二版剩餘的扣分：區塊邊界把句子切斷、過度切碎、少數漏字。第三版已加上「停頓短就一定保留最後一句」與「不成句的片段併回所屬句子」，分數待第二輪盲評確認。

限制：GPU 已用約 30/32 GB，不能再放本機模型；外部服務經 OpenAI 相容代理，可能失敗或額度用盡；`.env` 只能新增 `TRANSLATE_*` 開頭的變數。

## Goals / Non-Goals

**Goals:**

- 精準模式下，頁面最後保留的每一段是一句完整的話，原文經上下文修正，譯文由強模型產生。
- 即時感不變：即時逐字稿與暫譯照舊立刻出現，精準結果在語句結束後約 10–25 秒內取代它（估計值：區塊長度 5–18 秒＋辨識約 2 秒＋文字模型約 1–6 秒；以 bench 重播紀錄中 quality 事件的 `audioMs − throughMs` 驗證）。
- 外部服務任何失敗都不中斷會議，也不遺失內容。
- 精準模式關閉時行為與現在完全相同。

**Non-Goals:**

- 不更換串流辨識模型。2026-11-13 的調查沒有找到比 Confucius4-R2T2 更強且含日文的開源串流模型；本機第二段辨識（Qwen3-ASR-1.7B 離線、TEA-ASR）需要先挪出顯存，另案評估。端點是 OpenAI 相容格式，之後換成本機服務只需改設定。
- 不做逐字時間戳或強制對齊；句子的時間以字數比例估計。
- 不改校對頁、紀要、問答的資料格式；它們讀到的仍是 `segments` 資料表的一段一列。
- 不處理說話者辨識（會後流程不變）。
- 不提供即時路徑以外的入口（例如上傳檔案重跑）。

## Decisions

### 精準模式在閘道器執行，結果走同一條 WebSocket

閘道器本來就收到全部音訊，也已有外部服務的金鑰；瀏覽器不必多送一次音訊，bench 錄軌也能把 quality 事件和辨識事件錄在同一條時間軸。替代方案「瀏覽器自己切音訊再呼叫新 API」要把金鑰代理、切塊、重試都搬到前端，且錄軌重播不到，不採用。

### 以 TeeReceiver 取得音訊，兩種引擎共用

`quality_pass.TeeReceiver(guarded, on_pcm)` 包住 `StreamGuard`：`receive()` 照原樣回傳事件，遇到 `bytes` 時先呼叫 `on_pcm`。本機路徑的 `browser_to_asr()` 與 `MaiBridge` 都拿這個包裝，不必各改一次（與 stream-limits 的「以 StreamGuard 包住瀏覽器連線」同一做法）。其餘屬性以 `__getattr__` 轉給原物件。

### 依停頓切塊，停頓長度決定最後一句要不要先留著

`Chunker`（20 毫秒音框能量；雜訊底為最近 10 秒音框的第 1/7 低值，語音門檻 `max(150, 2.5×底)`，與 `mai_asr.PauseDetector` 相同）：
- 區塊長度達 5 秒後，遇到連續 0.35 秒靜音就在靜音中點切。
- 達 18 秒仍無停頓，就在最後 6 秒內能量最低的 100 毫秒處切，標記 `pause="none"`。
- 切點之後靜音持續達 1.0 秒標記 `pause="long"`，否則 `"short"`；文字模型在辨識結果回來後才讀這個值，所以不需要為了等 1 秒而延後送辨識。
- 語音音框少於 0.3 秒的區塊不送辨識（避免模型對靜音編造文字）；此時若有保留的句尾且靜音已達 2.5 秒，以空的 NEW、`pause="long"` 送文字模型把它定稿。

原型實測：`pause` 不是 `long` 時由程式強制把最後一句退回保留，比只靠提示詞可靠。

### 一次文字模型呼叫完成修字、斷句、翻譯

輸入：最近 8 句的原文與譯文（CONTEXT）、保留的句尾（CARRY）、本塊辨識文字（NEW）、停頓（PAUSE）、同一時間範圍的即時辨識文字（ALT，可為空）、是否結束（LAST）、會議詞彙。輸出 JSON `{"sentences":[{"src","tgt","lang"}],"carry":""}`。提示詞沿用原型第三版（修字只在上下文明確時、不成句片段併回、插話獨立成段、數字與否定不可變、不留原文文字、中文一律台灣繁體）。分成三次呼叫（修字、斷句、翻譯）延遲約三倍且互相看不到對方的判斷，不採用。

回傳不是合法 JSON 或沒有 `sentences` 時重試一次；仍失敗視為該塊失敗。

### 句子的時間以字數比例分配

每次呼叫涵蓋的時間是 `[carry_start_ms, chunk_end_ms]`；依各句與新 carry 的原文字數比例切分，得到每句的 `startMs`／`endMs`，新 carry 的起點成為下一次的 `carry_start_ms`。沒有逐字時間戳，誤差以校對頁既有的播放前後延（前 3 秒、後 0.5 秒）吸收。

### 頁面以時間範圍取代即時內容

`app.js` 新增 `qualityRecords`（依序的句子）與 `qualityThroughMs`（最後一句的 `endMs`）。精準模式下：
- 左欄＝各句原文（一句一段）＋即時逐字稿中晚於 `qualityThroughMs` 的部分（以 `timeMarks` 找到第一個 `ms > qualityThroughMs` 的位置）＋暫定文字。
- 右欄＝各句譯文＋ `endMs > qualityThroughMs` 的即時定稿段落＋暫譯。
- `finalizedRecords()` 的呼叫端（字幕、匯出、段落儲存）改用 `outputRecords()`：精準模式回傳 `qualityRecords`，會議結束且收到 `final` 事件後即為全部內容。
- 即時辨識文字比音訊晚 0.4–1.3 秒到達，所以取代邊界可能短暫重複或缺幾個字；下一個 quality 事件會蓋掉，不另做對齊。

### 失敗的區塊把即時定稿段落升級為正式段落

閘道器送 `{"quality":{"failed":true,"throughMs":…}}`。頁面把 `endMs ≤ throughMs` 且尚未被取代的即時定稿段落複製進 `qualityRecords`，並把 `qualityThroughMs` 推到 `throughMs`。閘道器同時清空 CARRY（那段話已由即時段落涵蓋）。這樣只有一條退回路徑，且會議紀錄的段落序號仍然只增不改。

佇列中等待的區塊超過 3 個（外部服務太慢）時，最舊的區塊直接視為失敗，讓結果追上講話進度。

### 設定只用 TRANSLATE_QUALITY_* 變數，沒設定就不出現

`TRANSLATE_QUALITY_ASR_MODEL`（第二段辨識模型）與 `TRANSLATE_QUALITY_MODEL`（文字模型）兩者都有值才啟用；`TRANSLATE_QUALITY_URL`／`TRANSLATE_QUALITY_KEY` 預設沿用 `TRANSLATE_REFINE_URL`／`TRANSLATE_REFINE_KEY`；`TRANSLATE_QUALITY_EXTRA`（JSON，預設 `{}`）併入文字模型請求，用來設定各家模型的推理參數。`/api/config` 多回 `quality: true|false`。瀏覽器送的標頭帶 `quality: true` 且伺服器已設定時才執行。

### 實作時補上的行為

- 辨識服務以 HTTP 400 拒絕帶 `prompt` 的請求時，改成不帶 `prompt` 重送，該場之後都不帶。2026-11-13 實測：經 litellm 的 gemini-3.5-transcribe 不接受 `prompt`，gpt-transcribe 接受。
- 停頓是短是長，要等切點之後 1 秒的音訊到齊才知道；辨識比這更快回來時先等判定出來再送文字模型，否則句子會一直被保留。
- 即時翻譯模式沒有錄音檔的時鐘，精準模式開啟時改用它自己收到的音訊長度在即時事件附上 `audioMs`，頁面才分得出哪些即時內容已被取代。
- 雜訊底另外以最近 10 秒最大音量的 4% 為上限（`mai_asr.PauseDetector` 沒有這個上限）：連續講話 10 秒沒有空隙時，雜訊底會升到說話的音量，使整段都被當成停頓。
- 全靜音的區塊只會因長度被切開；留著句尾時，靜音區塊長達 2.5 秒以上就以空的 NEW、`pause="long"` 送文字模型把它定稿。
- 「等待中的區塊超過 3 個」不含正要處理的那一塊。
- 「即時辨識文字交叉比對」（ALT）以 `TRANSLATE_QUALITY_ALT=1` 開啟，預設關閉：2026-11-13 盲評得 92.1 分的組合沒有用它，開啟後的效果尚未評測。

### 精準模式的請求不記錄內容

日誌只記區塊序號、音訊毫秒數、字數、耗時與成功與否，不記辨識文字與譯文（與 asr-log-no-transcript 的原則一致）。

## Implementation Contract

**行為**

- `/api/config` 回傳 `quality`（布林）。為真時開會頁「進階」出現核取方塊 `#quality`「精準模式」，小字「音訊與文字會傳送到外部服務」；選擇記在 `localStorage.quality`；會議進行中停用。勾選時「雲端精修」停用並顯示為未勾選的效果（精準模式已包含）。
- 連線標頭 `quality: true` → 閘道器建立 `QualityPass`。之後瀏覽器收到的事件多一種：

```json
{"quality": {"seq": 3, "throughMs": 41200, "final": false,
             "sentences": [{"source": "…", "target": "…", "lang": "zh", "startMs": 30100, "endMs": 36500}]},
 "audioMs": 47900}
```

  `sentences` 可為空陣列（整塊都被保留為 CARRY）；`final: true` 只出現在最後一個事件。失敗事件為 `{"quality": {"seq": 4, "failed": true, "throughMs": 58000, "final": false}}`。
- 中日雙向（`zh_ja`）：每句 `lang` 為 `zh` 或 `ja`，譯成另一種語言；頁面以既有的方向標籤顯示。中英自動（`auto`）與單一語言：譯成所選目標語言。
- 結束：瀏覽器送 EOS 後，閘道器在辨識引擎收尾後呼叫 `QualityPass.finish()`（最多等 25 秒），送出 `final: true` 的事件再關閉連線；頁面在精準模式下把等待關閉的上限從 20 秒改為 35 秒。逾時則剩餘範圍依失敗處理。
- 儲存：精準模式下 `PUT /api/meetings/{id}/segments` 送的是 `outputRecords()`，`seq` 為句子順序，`startMs`／`endMs` 為事件給的值；格式不變。

**介面**

- `webapp/quality_pass.py`：`configured() -> bool`；`Chunker.feed(pcm) -> list[Chunk]`、`Chunker.flush() -> Chunk | None`；`allocate(start_ms, end_ms, sentences, carry) -> (sentences_with_ms, carry_start_ms)`；`QualityPass(send, language, target, glossary)`，方法 `feed(pcm)`、`live(text)`（閘道器把顯示用逐字稿交給它當 ALT 來源）、`async finish()`、`cancel()`；`TeeReceiver(inner, on_pcm)`。
- 外部請求：`POST {URL}/audio/transcriptions`（multipart：`model`、`file`＝WAV、`response_format=json`、`prompt`＝詞彙＋前文末 200 字、`language` 僅在單一語言時帶）；`POST {URL}/chat/completions`（`response_format: {"type": "json_object"}`、`temperature` 不指定、`max_tokens: 6000`、併入 `TRANSLATE_QUALITY_EXTRA`）。逾時：辨識 15 秒、文字模型 25 秒。

**失敗模式**

- 外部服務錯誤、逾時、回傳格式不對（重試一次後）：送 `failed` 事件，會議繼續；伺服器記一行 warning（不含內容）。
- 未設定或瀏覽器沒帶 `quality`：不建立 `QualityPass`，事件與現在完全相同。
- 瀏覽器中途離開：`cancel()` 取消進行中的請求。

**驗收**

- 單元測試（`webapp/test_server.py`，以假的 HTTP 回應）：切塊規則、時間分配、強制保留最後一句、失敗事件、`/api/config`、標頭未帶 `quality` 時不呼叫外部服務、日誌不含文字。
- `bench/segcheck.js` 同類的 Node 檢查新增 `bench/qualitycheck.js`：以假事件驅動 `app.js` 的取代與升級邏輯（抽成 `webapp/static/quality-view.js` 的純函式）。
- bench：`python bench/run.py qualityN` 錄軌（含 quality 事件）並重播；`python bench/evaluate.py qualityN` 產生評分表；與既有最佳組合同輪盲評，平均分數高於既有最佳組合，並在 bench/README.md 記錄結果與 `audioMs − throughMs` 的中位數。
- `node bench/translate_e2e.mjs` 等既有端到端腳本在精準模式關閉時通過。

**範圍**

- 範圍內：上述模組、頁面開關與顯示、bench 錄軌重播、設定與文件。
- 範圍外：校對頁與紀要頁的任何變更、資料表結構、串流辨識引擎、說話者辨識。

## Risks / Trade-offs

- 外部服務的費用與額度：每分鐘音訊約 4–8 次辨識與 4–8 次文字模型呼叫（原型實測每 4 分鐘 24–41 塊）。額度用盡時每塊都失敗、退回即時結果，頁面不會壞，但使用者只看到品質回到即時水準；因此失敗達連續 3 塊時頁面狀態列顯示「精準模式暫時無法使用，已改用即時結果」。
- 隱私：音訊離開本機。開關預設關閉並標示；即時翻譯模式同樣適用。
- 取代時畫面跳動：精準結果的斷句與即時段落不同，取代時右欄會重排。以「只在使用者位於底部時跟隨捲動」（既有行為）與一句一段的穩定排版降低干擾。
- 時間估計不準：句子時間由字數比例推得，講話速度不均時可能偏 1–2 秒；校對頁的播放前後延可涵蓋，超出時使用者可用既有的「往前／往後 2 秒」。
- 文字模型自行增刪內容：提示詞要求不可增刪，並以 ALT 交叉比對；bench 盲評的「完整」與「意義」分項是回歸檢查。
