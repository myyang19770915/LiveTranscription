## Why

精準模式修正內容遺漏後，10 段盲評平均 86.2（基準 80.7），離目標 95 仍差約 9 分；評審指出的失分集中在「語意」：第一輪逐塊處理時看不到後文、沒有時間推理，於是出現辨識錯字沒被改掉（「不穩定」聽成「穩定」）、代名詞性別前後不一（女性當事人譯成 he/him）、問句譯成敘述句等錯誤。同一個文字模型開啟推理並看得到前後文時能改掉這些錯誤，但每次要 10–20 秒，無法放在即時的那一輪。

## What Changes

- 精準模式新增「回顧修訂」：句子先照現在的速度顯示（約 2 秒），閘道器在背景把已顯示的句子每 6 句一組，連同前文、後 3 句的原文、即時引擎對同一段音訊的辨識文字與累積的會議筆記（人物、性別、名詞），交給開啟推理的同一個文字模型重新檢查，只把有改動的句子送回頁面取代原句。
- 每個精準模式的句子帶一個編號；新的 `revision` 事件以編號指出被修訂的句子。句子的數量與順序不變（不合併、不拆分）。
- 修訂的回答必須涵蓋原來的每一句且內容長度相近，否則重問一次，仍不合格就保留第一輪的結果。
- 會議結束時，剩下還沒回顧的句子在限定時間內（30 秒）處理，逾時的保留第一輪結果；頁面等待連線關閉的上限由 35 秒延長為 70 秒。
- 會議的段落儲存：尚未人工校對的段落，頁面再次儲存時原文若有變動也一併更新（原始辨識文字 `asr_text` 仍保留第一次儲存的內容）。
- 新設定 `TRANSLATE_QUALITY_REVISE`（`1` 啟用）與 `TRANSLATE_QUALITY_REVISE_EXTRA`（併入請求的 JSON，例如開啟推理）；未設定時行為與現在相同。
- 原型量測（`bench/results/blind_k`，10 段、同輪盲評）：現行精準模式 85.4，加上回顧修訂 88.8，10 段全部高於現行版。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `quality-pass`: 新增回顧修訂（句子編號、`revision` 事件、頁面取代、回答的檢查、結束時的等待、修訂後的儲存、日誌），並修改「The stream closes after the final quality event」的等待時間。

## Impact

- Affected code:
  - New: webapp/revise_pass.py
  - Modified: webapp/quality_pass.py, webapp/review.py, webapp/static/quality-view.js, webapp/static/app.js, webapp/static/index.html, webapp/test_server.py, bench/qualitycheck.js, compose.yaml, .env.example, README.md, bench/README.md
  - Removed: (none)
- 外部服務：回顧修訂把已送過的文字再送一次給同一個文字模型服務（`TRANSLATE_QUALITY_URL`），沒有新的資料去向；隱私標示不變。每 6 句多一次開推理的請求，文字模型的用量約增為 2–3 倍。
- 設定：正式站 `.env` 加 `TRANSLATE_QUALITY_REVISE=1` 與 `TRANSLATE_QUALITY_REVISE_EXTRA`。
