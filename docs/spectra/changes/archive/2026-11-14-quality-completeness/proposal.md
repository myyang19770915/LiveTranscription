## Why

2026-11-14 的 10 段盲評中，精準模式最大的失分是整句、整段內容遺漏（`ja_komuro` 的 MAI 版 70 分、`en_torres` 的 Qwen 版 75 分）。逐塊記錄辨識結果與文字模型的回答後，找到兩個原因：

- Azure MAI 是串流模型。精準模式把一整塊音訊一次送完再 commit 時，它只辨識開頭一小段：`ja_komuro` 第 12.0–25.6 秒那塊，一次送完得到 16 個字，以 4 倍速送得到 38 個字，照實際速度送才得到完整的 95 個字。
- 文字模型（關掉推理的 `deepseek-v4-flash`）偶爾只回新的一塊、丟掉前一塊留下來的句子。同一段影片重跑沒有發生，屬於隨機性，目前沒有任何檢查。

另外同一輪評測顯示本機 Qwen3-ASR 在中文最好（84.7，基準 77.0）、在日文比基準差（77.8 對 83.5），MAI 在其他語言較好；使用者決定中文用 Qwen3-ASR、其他語言用 MAI，並固定這個組合做後續開發。

## What Changes

- 精準模式用 MAI 做第二次辨識時，改為在串流期間另開一條 MAI 連線，音訊照收到的速度即時送出，在每個區塊的切點 commit，該區塊的文字就是那次 commit 的結果。不再把整塊音訊一次送完。
- 文字模型的回答必須交代它拿到的內容：回答中的原文（句子加上保留到下一塊的部分）明顯少於或多於輸入（上一塊保留的部分加上新辨識的文字）時，視為不可用並重試一次；仍不合格時該區塊算失敗，保留即時結果（實測後改為整段留給下一塊重問，只有最後一塊或累積過長時才失敗，見 design.md「第一輪實測後的修正」）。
- 新增 `TRANSLATE_QUALITY_ASR=hybrid`：中文（`zh`、`yue`）的串流用 `TRANSLATE_QUALITY_ASR_URL`／`TRANSLATE_QUALITY_ASR_MODEL` 指定的辨識服務，其他語言用 MAI。
- 文字模型的提示明確寫出不可刪減內容，贅詞只限語助詞與重複的起頭。
- 正式環境 `.env` 設為 `hybrid`；`README.md`、`.env.example`、`bench/README.md` 說明。

## Non-Goals (optional)

- 不換辨識模型或文字模型（使用者已固定組合）。
- 不做區塊之間的音訊重疊與文字接合：這次查到的遺漏不是切點掉字造成的。
- 不處理日文專有名詞的辨識錯誤（詞彙表加讀音等）：另一個變更。
- 即時引擎選 MAI 時，精準模式會再開第二條 MAI 連線，音訊費用加倍；合併成一條連線不在這次範圍。
- `TRANSLATE_QUALITY_ASR=local`（本機 Confucius 逐塊辨識）維持原樣。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `quality-pass`: MAI 的第二次辨識改為即時串流；新增依語言選辨識引擎的 `hybrid`；文字模型的回答要通過內容完整性檢查

## Impact

- 修改 webapp/chunk_asr.py、webapp/quality_pass.py、webapp/test_server.py
- 修改 .env.example、README.md、bench/README.md
- 正式環境 .env 新增一行 TRANSLATE_QUALITY_ASR=hybrid（只動 TRANSLATE_* 行）
- 精準模式用 MAI 時，靜音的區塊也會送到 Azure（原本不送），計費的音訊分鐘數略增
