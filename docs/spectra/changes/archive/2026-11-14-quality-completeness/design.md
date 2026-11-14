## Context

精準模式（quality-pass）把會議音訊依停頓切成 5–18 秒的區塊，每塊由第二個辨識模型重聽，再由文字模型修字、斷句、翻譯。2026-11-14 的 10 段盲評後，以 `bench/omit_probe.py`（離線把片段跑過 `QualityPass`，記錄每塊的辨識文字與文字模型回答）查遺漏的來源。

- `ja_komuro`（MAI）：32 塊中有 2 塊的辨識文字遠少於語音長度（10.3 秒語音 19 個字、8.9 秒語音 8 個字），正好是評審指出遺漏的兩段。直接對 MAI 重現：同一塊音訊一次送完 16 字、4 倍速 38 字、實際速度 95 字。
- 三段影片的文字模型整體保留了 95–100% 的辨識文字；但評測那次 `en_torres` 掉了一整個案例，重跑沒有發生，是文字模型偶發地沒有把前一塊留下的句子帶進回答。

參考的外部做法（調查結果）：AssemblyAI 的校正提示明寫「不可改寫、摘要、縮短」；開源的逐字稿校正腳本以長度變化與相似度門檻決定是否退回原文；RLLM-CF 論文指出不加限制的校正提示會讓錯字率大幅上升；Deepgram 文件提醒串流結果要把多個定稿片段接起來才完整。

## Goals / Non-Goals

**Goals:**

- MAI 做第二次辨識時不再因送音速度而漏字。
- 文字模型丟掉或憑空增加大段內容時能被擋下，退回即時結果而不是靜靜少一段。
- 依語言選辨識引擎：中文用辨識服務（Qwen3-ASR），其他用 MAI。

**Non-Goals:**

- 區塊重疊與文字接合、日文專有名詞、合併兩條 MAI 連線，見 proposal。

## Decisions

### MAI 改為整場一條連線，即時送音，在切點 commit

`chunk_asr.MaiLive`：`feed(pcm)` 把音訊放進佇列，由寫入工作照到達順序送 `input_audio_buffer.append`；`QualityPass.feed()` 在 `Chunker` 切出含語音的區塊時呼叫 `commit()`，取得一個 future，該 commit 對應的 `transcription.completed` 到達時完成。commit 與 completed 依序配對（與 `mai_asr.MaiBridge` 相同）。`_transcribe()` 只等這個 future（最多 15 秒）。

- 切點與 commit 的位置不完全相同：`Chunker` 在停頓中間切，commit 發生在偵測到停頓之後（晚約 0.2 秒的靜音）；沒有停頓而強制切開時，切點可往回最多 6 秒，這段話的文字會算在前一塊。文字的順序與完整性不受影響，只有句子的估計時間與「已被取代的即時文字」範圍會差到幾秒；強制切開本來就少見，接受這個誤差。
- 靜音的區塊不 commit，它的音訊留在 MAI 的緩衝裡併入下一次 commit。
- 連線中斷（MAI 的 session 約一小時會結束）：等待中的 future 全部以錯誤結束（該區塊失敗、保留即時結果），背景工作在 1 秒後自動重新連線，之後的音訊進新連線。開不了連線時同樣處理，不讓串流中斷。
- 英文在 commit 處會被 MAI 補上句點（`mai_asr.py` 的說明），文字模型本來就把辨識的句末標點當成猜測，不另外處理。
- 替代方案「照實際速度把整塊補送一次」會讓每塊多等 5–18 秒，不採用。

### 內容完整性以字數比例檢查

`quality_pass.in_words(text)` 判斷文字中拉丁字母是否佔多數；`quality_pass.units(text, words)` 以 NFKC 正規化後，`words` 為真時數單字，否則數字母與數字（中日文一字一個）。`_refine()` 取得回答後比較輸入（carry＋new）與輸出（各句 src＋carry）：輸入至少 12 個單位且輸出少於 70%，或輸出多於 150%＋10，就丟出 `Unusable("coverage")`，由既有的 `_twice()` 重試一次，再失敗則該區塊失敗。

- 門檻的依據：三段影片共約 100 個區塊的回答中，正常回答的比例都在 85% 以上（刪語助詞後）；丟掉一句通常少三成以上。70% 留了餘裕，避免把刪贅詞誤判為遺漏。這些門檻是估計值，上線後以日誌中 `failed:Unusable` 的次數檢驗。
- 不用另一個模型判斷是否遺漏：調查到的論文顯示這類判斷接近亂猜，而且會多一次呼叫。
- 提示第 1 步改為明確禁止刪減，只允許移除語助詞與重複的起頭。

### 依語言選引擎

`quality_pass.recognizer(language)` 回傳 `api`、`mai` 或 `local`：`hybrid` 時 `zh`、`yue` 用 `api`，其餘（含 `auto`、`zh_ja`）用 `mai`。使用者的指示是「只有中文用 Qwen3-ASR」，所以混合語言的模式歸 MAI。`configured()` 在 `hybrid` 時要求 MAI 與 `TRANSLATE_QUALITY_ASR_MODEL` 都已設定。

### 第一輪實測後的修正（2026-11-14）

修正後重錄三段與基準同輪盲評：`ja_komuro` 71→82（基準 85），`en_torres` 85→76（基準 87），`zh_chen` 88→85（基準 77）。`en_torres` 變差的原因與處理：

- **保留的句子被接了兩次。** 停頓不長時閘道器把回答的最後一句退回 carry；文字模型常常同時把同一句寫在 `carry` 欄，結果 carry 變成同一句兩次（既有的問題）。輸入因此變成兩倍，完整性檢查把正常的回答判成丟字。處理：模型的 carry 已經以該句開頭時不再重複接上；回答中與前一句或上一個已顯示的句子相同的句子不再顯示。
- **檢查不過就退回即時結果，會在接縫留下重複與缺口。** 105 塊中有 3 塊被擋下，評審指出的重複句與漏句都在這些位置。處理：兩次回答都不合格時不顯示任何句子，把 carry 與新文字整個留給下一塊重問；只有最後一塊、或留下的文字超過 800 個字元時才算失敗。
- 程式碼審查另外指出：等 MAI 的文字逾時會取消那個 future，重試時整個工作被取消，該場之後不再有精準模式的結果（改為 `asyncio.shield`，且不對同一個 commit 重等）；MAI 連線在一塊的中途斷掉時，新連線只聽到後半段卻被當成整塊的文字（改為該塊失敗、丟棄那次 commit 的文字；斷線前已送出的音訊只有靜音時不算）。

## Implementation Contract

- `chunk_asr.MaiLive(language)`：`feed(pcm: bytes) -> None`、`commit() -> asyncio.Future[str]`、`close() -> None`（可重複呼叫）。不記錄任何文字。原本的 `chunk_asr._mai()` 與 `recognize("mai", …)` 移除。
- `quality_pass.recognizer(language) -> str`、`quality_pass.in_words(text) -> bool`、`quality_pass.units(text, words: bool) -> int`、`quality_pass.covered(given: int, back: int) -> bool`。輸入與回答必須用同一種算法，所以由呼叫端以輸入的文字決定數單字還是數字元，再用同一個結果去數兩邊。
- `QualityPass`：引擎為 `mai` 時建立 `MaiLive`；`feed()` 轉送音訊並為每個含語音的區塊 commit（`Chunk.heard` 存 future）；`finish()` 對最後一塊同樣處理；`finish()`／`cancel()` 關閉 `MaiLive`。
- `quality_pass.said(text) -> str`、`quality_pass.joined(first, second) -> str`、`quality_pass.CARRY_LIMIT`；`chunk_asr.audible(pcm) -> bool`。
- 驗證：`webapp/test_server.py` 的 `QualityEngineTest`（MAI 即時送音、連線中斷、中途中斷、回答太晚）、`QualityCoverageTest`（範例表與三個情境）、`QualityRecognizerChoiceTest`（範例表）；以 `ja_komuro` 重跑 `bench/omit_probe.py`，原本只有 19 字與 8 字的兩塊要回到接近中位數的字數。

## Risks / Trade-offs

- 靜音也送到 MAI，計費分鐘數略增；即時引擎也選 MAI 時費用加倍。
- 完整性門檻可能把大量口吃、重複的區塊誤判為遺漏而退回即時結果；退回的結果仍然完整，只是沒有修字。
- 強制切開時估計時間有幾秒誤差。
