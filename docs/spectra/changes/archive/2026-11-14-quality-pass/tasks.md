## 1. 閘道器：切塊與時間

- [x] 1.1 spec「Audio is cut into chunks at pauses」三個情境；設計決策「依停頓切塊，停頓長度決定最後一句要不要先留著」：`webapp/quality_pass.py` 的 `Chunker.feed()`／`flush()` 依規則回傳區塊（起訖毫秒、PCM、語音秒數、之後可更新的 `pause`）。完成時：7 秒語音＋0.5 秒靜音切出一塊且 `pause` 為 `short`；18 秒無停頓在第 12–18 秒最安靜處切且為 `none`；全靜音的區塊語音秒數小於 0.3。驗證：`webapp/test_server.py` 新增 `QualityChunkerTest`（以合成正弦波與靜音）。
- [x] 1.2 spec「Sentences carry an estimated time span」的情境與範例表；設計決策「句子的時間以字數比例分配」：`quality_pass.allocate()` 對範例表三列回傳表中的句子區間與下一個 carry 起點。驗證：`QualityAllocateTest` 逐列比對。

## 2. 閘道器：辨識、精修與事件

- [x] 2.1 [after: 1.1, 1.2] spec「Each chunk yields corrected sentences with translations」三個情境；設計決策「一次文字模型呼叫完成修字、斷句、翻譯」：`QualityPass` 對每塊依序呼叫 transcriptions 與 chat completions（提示詞取自原型第三版，放在模組常數 `SYSTEM`），`pause` 不是 `long` 且未結束時強制把最後一句退回 carry，中文原文與譯文轉台灣繁體，`zh_ja` 每句帶 `lang`。驗證：`QualityPassTest` 以假的 HTTP 傳輸檢查請求內容（prompt 含詞彙與前文末 200 字、CONTEXT 最多 8 句）與三個情境的輸出。
- [x] 2.2 [after: 2.1] spec「A failed chunk keeps the live result」中閘道器的部分；設計決策「失敗的區塊把即時定稿段落升級為正式段落」：外部請求失敗、逾時或格式不對時重試一次，仍失敗就送 `failed` 事件、清空 carry、繼續下一塊；等待中的區塊超過 3 個時最舊的直接視為失敗。驗證：`QualityPassTest` 的逾時、非 JSON、積壓三個測試；確認失敗後下一塊正常送出事件。
- [x] 2.3 [after: 2.1] spec「Quality pass logs contain no meeting text」；設計決策「精準模式的請求不記錄內容」：每塊一行 log，只有序號、音訊毫秒、字數、耗時、結果。驗證：`QualityPassTest` 以 `assertLogs` 檢查 log 不含測試用的原文、譯文與詞彙。
- [x] 2.4 [after: 2.1] spec「Quality pass is opt-in and hidden until configured」的伺服器部分與「The stream closes after the final quality event」；設計決策「精準模式在閘道器執行，結果走同一條 WebSocket」「以 TeeReceiver 取得音訊，兩種引擎共用」「設定只用 TRANSLATE_QUALITY_* 變數，沒設定就不出現」：`/api/config` 回 `quality`；`transcribe()` 在標頭帶 `quality: true` 且已設定時以 `TeeReceiver` 包住 guard、把顯示用逐字稿交給 `QualityPass.live()`、引擎收尾後 `finish()`（最多 25 秒）再關閉連線，瀏覽器中途離開時 `cancel()`；`compose.yaml` 與 `.env.example` 加入 `TRANSLATE_QUALITY_*`。驗證：`test_server.py` 新增：未設定時 `quality` 為 false；標頭沒帶 `quality` 時假傳輸沒有收到任何請求；帶了之後以 WebSocket 測試用戶端收到 `quality` 事件且最後一個為 `final: true`。

## 3. 瀏覽器

- [x] 3.1 spec「Quality events replace live content on the page」兩個情境、「A failed chunk keeps the live result」頁面部分、「Kept segments are stored as the meeting segments」；設計決策「頁面以時間範圍取代即時內容」：新增純函式模組 `webapp/static/quality-view.js`（套用成功事件、套用失敗事件並升級即時段落、算出左右欄要顯示的內容、連續失敗次數）。驗證：新增 `bench/qualitycheck.js`（node 直接執行）涵蓋 spec 情境：兩句取代 9000／14000 的例子、失敗事件升級、2＋0＋3 句後序號 1–5、連續 3 次失敗。
- [x] 3.2 [after: 3.1, 2.4] spec「Quality pass is opt-in and hidden until configured」頁面部分、「The stream closes after the final quality event」頁面部分：`index.html` 新增 `#qualityRow`／`#quality`（文案與小字依 spec），`app.js` 讀 `/api/config` 的 `quality`、記住選擇、會議中停用、標頭帶 `quality`、`onMessage()` 處理 `quality` 事件並改用 `outputRecords()` 供字幕、畫面＋字幕、複製、匯出與段落儲存，精準模式下不排延遲精修與詞彙重譯、等待關閉上限 35 秒、連續 3 次失敗時狀態列顯示 spec 的文字；`refine.css` 讓已取代的句子一句一段、尚未取代的即時文字較淡；更新資源版本號。驗證：`node bench/qualitycheck.js` 通過；`YUQIAO_SESSION=… node bench/translate_e2e.mjs <wav> <dir>` 在未設定精準模式下 exit 0（既有行為不變）；以瀏覽器開啟頁面確認開關只在已設定時出現。

- [x] 3.3 spec「Live events carry the audio clock while the quality pass is on」與「The privacy notice names the quality pass」；設計決策「實作時補上的行為」：即時翻譯模式下精準模式開啟時，閘道器以精準模式的音訊時鐘在即時事件附上 `audioMs`；`PrivacyNote.text()` 在精準模式勾選時回「精準模式／音訊與文字會傳送到外部服務」，勾選時「雲端精修」停用。驗證：`QualityStreamTests` 的兩個測試（開啟時每個即時事件 `audioMs` 為 3000、未開啟時沒有 `audioMs`）與 `node bench/privacycheck.js`。

## 4. Bench 與文件

- [x] 4.1 [after: 2.4, 3.2] 錄軌與重播支援精準模式：`webapp/replay_asr.py --quality` 在標頭帶 `quality` 並等到 `final` 事件；`replay_browser.py`／`bench/run.py` 以 `quality` 開頭的 TAG 開啟（軌檔名加 `_q`）；`replay_inject.js` 勾選 `#quality`；`replay_page.mjs` 輸出頁面的 `outputRecords()` 當作段落。驗證：`python bench/run.py quality1 zh_fire` 後 `python bench/evaluate.py quality1` 產生的評分表每段是一句且來自 quality 事件。
- [x] 4.2 [after: 4.1] 全部 10 段重播並與既有最佳組合同輪盲評；在 `bench/README.md` 記錄各段分數、平均、`audioMs − throughMs` 中位數與所用模型；`README.md` 補「精準模式」使用說明、設定參考與分數演進。驗證：`bench/README.md` 有該節且數字來自本次 `bench/results/quality*/` 的評審檔；單元測試 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全過。
- [x] 4.3 [after: 5.1] 同一段（`zh_fire`）同一輪盲評六個版本：本機即時、MAI 即時、精準模式的第二次辨識分別用本機、MAI、Gemini，以及本機 Qwen3-ASR 1.7B（文字模型皆 `deepseek-v4-flash`）。完成時：`bench/README.md` 有一節列出六個版本的分數、每塊耗時中位數與花費，並寫明只有一段、不能當成平均。驗證：數字來自本次 `bench/results/` 的評審檔與 litellm 的花費紀錄。

## 5. 第二次辨識改用本系統的引擎

- [x] 5.1 spec「The second recognition can use the app's own engines」三個情境；設計決策「第二次辨識可以改用本系統自己的引擎」：新增 `webapp/chunk_asr.py`（`available()`、`recognize()`），`quality_pass.configured()` 與 `_transcribe()` 依 `TRANSLATE_QUALITY_ASR` 切換，`server.py` 把本機引擎的語言名稱交給 `QualityPass`；`compose.yaml`、`.env.example`、`README.md` 加入該變數。完成時：設為 `local` 時假的 HTTP 服務沒有收到 `/audio/transcriptions`、假的 ASR 連線收到含 `retain: false` 的標頭與整塊音訊，文字模型的 NEW 是它回的文字；設為 `mai` 而 MAI 未設定、或設為 `whisper` 時 `configured()` 為 false。驗證：`test_server.py` 的 `QualityEngineTest`。
- [x] 5.2 spec「The recognizer can be a separate service」；設計決策「辨識模型可以在另一個服務」：`quality_pass._transcribe()` 在 `TRANSLATE_QUALITY_ASR_URL` 有值時改送該位址並只帶 `TRANSLATE_QUALITY_ASR_KEY`；`compose.yaml`、`.env.example`、`README.md` 加入兩個變數。完成時：辨識請求的網址與 Authorization 標頭符合 spec 情境，文字請求不變。驗證：`test_server.py` 的 `QualityRecognizerElsewhereTest`。
- [x] 5.3 spec「A recognizer's repetition loop is kept once」三個情境；設計決策「辨識模型的重複輸出」：`quality_pass.without_loop()` 與 `ASR_EXTRA`，`_transcribe()` 套用；`compose.yaml` 傳入 `TRANSLATE_QUALITY_ASR_EXTRA`，`qwen-asr` 的健康檢查改用 `docker/qwen-asr/healthcheck.py`；`.env.example`、`README.md` 說明。驗證：`test_server.py` 的 `QualityLoopTest`；以 `ja_pivot` 重錄確認該塊不再失敗。
- [x] 5.4 spec「Quality pass is opt-in and hidden until configured」「The privacy notice names the quality pass」「A failed chunk keeps the live result」「The stream closes after the final quality event」的頁面部分：新增 `bench/quality_e2e.mjs`，以真實瀏覽器（假麥克風、假的辨識連線）確認未設定時開關隱藏、設定後顯示且預設不勾、勾選後雲端精修停用且連線標頭為 `quality: true`／`refine: false`、連續三塊失敗時狀態列顯示「精準模式暫時無法使用，已改用即時結果」、停止後等約 35 秒才關閉。驗證：`YUQIAO_SESSION=… node bench/quality_e2e.mjs` 七項全部 ok。
- [x] 5.5 spec「The translation language is named with every chunk」；設計決策「譯文語言要寫在文字旁邊」：`quality_pass.target_name()`，`_refine()` 的使用者訊息最後加 `TRANSLATE INTO`，`SYSTEM` 結尾重申。驗證：`test_server.py` 的 `QualityTargetLanguageTest`；對實際文字模型六個語言方向各三次皆為正確語言。
