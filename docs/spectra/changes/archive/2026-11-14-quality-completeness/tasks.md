## 1. 辨識引擎

- [x] 1.1 spec「The second recognition can use the app's own engines」的範例表與「MAI not configured」「Unknown engine name」情境；設計決策「依語言選引擎」：`quality_pass.recognizer(language)` 依 `TRANSLATE_QUALITY_ASR` 與語言回傳 `api`／`mai`／`local`，`configured()` 在 `hybrid` 時要求 MAI 與 `TRANSLATE_QUALITY_ASR_MODEL`。完成時：範例表十列逐一相符；`hybrid` 缺 MAI 或缺辨識模型時 `configured()` 為 false。驗證：`test_server.py` 新增 `QualityRecognizerChoiceTest`。
- [x] 1.2 [after: 1.1] spec 同一條需求的「MAI hears the audio as it arrives」「MAI session drops」情境；設計決策「MAI 改為整場一條連線，即時送音，在切點 commit」：`chunk_asr.MaiLive`（`feed`／`commit`／`close`），`QualityPass` 在引擎為 `mai` 時轉送音訊並為含語音的區塊 commit、`_transcribe()` 等該 commit 的結果，`finish()`／`cancel()` 關閉連線；移除一次送完整塊的 `_mai()`。完成時：三秒語音以 0.2 秒一則送入後，假的 MAI 連線在唯一一次 commit 之前收到十五次 append、內容與送入的音訊相同；連線中斷時等待中的區塊回報失敗，之後的音訊進新連線。驗證：`QualityEngineTest` 的對應測試；`bench/omit_probe.py`（`REALTIME=1`）以 `ja_komuro` 重跑，第 12.0–25.6 秒與第 38.2–50.1 秒兩塊的字數回到每秒語音 5 個字以上。

## 2. 文字模型的回答

- [x] 2.1 spec「The text model's answer accounts for its input」的範例表與三個情境；設計決策「內容完整性以字數比例檢查」：`quality_pass.units()`、`covered()`，`_refine()` 對不合格的回答丟出 `Unusable("coverage")`；`SYSTEM` 第 1 步改為禁止刪減、只允許移除語助詞與重複的起頭。完成時：範例表八列逐一相符；丟掉 carry 的回答會重問一次；連續兩次不合格時該區塊為 failed 且下一塊正常。驗證：`test_server.py` 新增 `QualityCoverageTest`。

## 3. 設定、文件與實測

- [x] 3.1 [after: 1.2, 2.1] `.env.example`、`README.md` 的設定表與「精準模式」一節說明 `hybrid` 與 MAI 即時送音；`bench/README.md` 記錄遺漏原因的調查數字（一次送完 16 字／4 倍速 38 字／實際速度 95 字）。正式環境 `.env` 加 `TRANSLATE_QUALITY_ASR=hybrid` 並重建 app。驗證：`/api/config` 的 `quality` 為 true；全部單元測試與 `node bench/checks.js` 通過。
- [x] 3.2 [after: 3.1] 以正式設定重錄評測中失分最多的 `ja_komuro`（MAI）與 `en_torres`（MAI）及 `zh_chen`（Qwen3-ASR），重播後與 `cloudb` 同輪盲評；結果寫進 `bench/README.md`。驗證：`bench/README.md` 有該節，分數來自本次評審檔；先跑這三段並回報花費，不直接跑十段。
- [x] 2.2 [after: 2.1] spec「A sentence is carried and shown once」兩個情境、「The text model's answer accounts for its input」修訂後的「Both answers drop content」兩個情境；設計決策「第一輪實測後的修正」：`quality_pass.said()`、`joined()`、`CARRY_LIMIT`，`_process()` 在兩次回答都不合格時把文字留給下一塊、去掉重複的句子、不重複接上已在 carry 的句子。驗證：`QualityCoverageTest` 的四個對應測試。
- [x] 1.3 [after: 1.2] spec「The second recognition can use the app's own engines」的「MAI session drops inside a chunk」「MAI answers too late」情境：`_transcribe()` 以 `asyncio.shield` 等 MAI 的文字且不重等，`MaiLive` 記錄斷線前是否已送出有聲音的音訊並讓該塊失敗。驗證：`QualityEngineTest` 的兩個對應測試。
