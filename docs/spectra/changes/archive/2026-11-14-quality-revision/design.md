## Context

精準模式（`webapp/quality_pass.py`）把音訊在停頓處切塊，每塊重新辨識後交給文字模型分句、翻譯，約 2 秒後以 `quality` 事件送回頁面取代即時結果。為了跟上語音，文字模型關閉推理（開啟時每次中位數 7–8 秒、最慢 26–34 秒，2026-11-14 量測），而且每塊只看得到前文。10 段盲評（`bench/results/blind_j`）平均 86.2；失分以語意錯誤為主：同音字沒被改掉、代名詞性別前後不一、問句成了敘述句。

原型（把錄好的精準模式結果離線交給開推理的同一個模型，每 6 句一組、帶前後文與即時引擎的文字）在 `bench/results/blind_k` 同輪盲評中由 85.4 升到 88.8，10 段全部進步；每組回答的中位數 7–20 秒、最慢 88 秒。

## Goals / Non-Goals

**Goals:**

- 不影響即時顯示的速度，讓已顯示的句子在約一分鐘內被修訂成較正確的版本，並成為會議留存的內容。
- 修訂失敗、逾時或回答不合格時，畫面與留存內容維持第一輪的結果。
- 不新增模型或資料去向（[[fixed-model-lineup]]：同一個 `deepseek-v4-flash`）。

**Non-Goals:**

- 不合併或拆分句子。會議段落以順序編號儲存（`PUT /api/meetings/{id}/segments` 依 `seq` 更新），句數改變會讓已儲存的段落位移；原型中的合併只占少數改動。
- 不把修訂後的筆記回饋給第一輪的請求（尚未量測對未開推理的模型的影響）。
- 不在會議結束後由伺服器繼續修訂並回寫資料庫；修訂只在連線期間進行。
- 不更換第二次辨識的引擎，也不改第一輪的提示。

## Decisions

### 回顧修訂是精準模式之後的獨立一層

修訂由 `webapp/revise_pass.py` 的 `Reviser` 負責，`QualityPass` 每送出一個 `quality` 事件就把句子交給它；`Reviser` 有自己的工作迴圈，與分塊處理互不等待。它不直接認識服務位址：`QualityPass` 給它一個送請求的函式，測試可以換成假的。替代方案是把第一輪直接改成開推理，已量測延遲不可行。

### 以句子編號取代，不改句數

每個句子在 `QualityPass` 送出時取得遞增的 `id`。`revision` 事件只帶有改動的句子的 `id`、`source`、`target`；頁面依 `id` 找到保留的段落並換掉文字，位置、時間與語言不變。這樣「保留的段落只會在尾端增加」仍然成立，儲存的順序編號不會位移。

### 視窗 6 句、後文 3 句、筆記延續

與原型相同：每 6 句一組，等後面 3 句也送出後才修訂（會議結束時不等）。請求帶上一組回傳的筆記（人物與性別、名詞與其譯法、主題，上限 900 字元）、前 6 句（已修訂的版本）、即時引擎在該時間範圍的文字（`_Live.between()`；啟用修訂時即使 `TRANSLATE_QUALITY_ALT` 關閉也保留即時文字）。第二次辨識與即時引擎是兩個不同的模型，兩者不一致處正是推理能判斷的地方。

### 回答要對得上每一句

回答必須依序給出視窗的每一句、原文與譯文都不空，且全部原文的單位數在視窗原文的 80% 到 125%＋5 之間（單位的算法沿用 `quality_pass.units()`）。不合格、請求失敗或 60 秒沒回答時重問一次，再失敗就放棄該視窗。等待中的句子超過 30 句時放棄最舊的視窗，避免落後越來越多。

### 結束時最多再等 30 秒

最後一個 `quality` 事件送出後，剩下的句子（至多 9 句併成一組）在 30 秒內修訂，逾時就關閉連線。頁面等待關閉的上限由 35 秒改為 70 秒（最後一塊 25 秒＋修訂 30 秒＋餘裕）。量測到的單次回答最慢 88 秒，因此結束時的最後幾句有時不會被修訂；這是刻意的取捨，使用者按下結束後不該等超過一分鐘。

### 儲存時原文也跟著更新

`save_segments` 目前在段落已存在時只更新譯文。會議進行中每 10 秒儲存一次，修訂通常在第一次儲存之後才到，所以要讓未校對、沒有歷程的段落在原文或譯文不同時一併更新 `source` 與 `target`；`asr_text` 與 `live_target` 保留第一次儲存的內容，校對頁仍看得到當時的辨識文字（會議結束前最後幾句若在第一次儲存前就修訂完，第一次儲存的就是修訂後的文字）。已被校對者處理的段落不動，條件與現在相同。

### 設定

`TRANSLATE_QUALITY_REVISE=1` 啟用；`TRANSLATE_QUALITY_REVISE_EXTRA` 是併入修訂請求的 JSON（正式站：`{"thinking":{"type":"enabled"},"reasoning_effort":"low"}`），取代 `TRANSLATE_QUALITY_EXTRA`。兩者都以 `TRANSLATE_` 開頭，可由我寫入 `.env`。

## Implementation Contract

- 行為：開啟精準模式且 `TRANSLATE_QUALITY_REVISE=1` 時，頁面上的句子在顯示後約 30–60 秒可能被較正確的版本取代；會議留存的段落是修訂後的版本。未啟用時沒有任何差異（除了句子多一個 `id` 欄位）。
- 事件：`quality` 事件的每個句子多 `id`（整數，自 1 遞增）。新事件 `{"revision": {"seq": <自 1 遞增>, "sentences": [{"id": int, "source": str, "target": str}]}, "audioMs": int}`。
- `revise_pass.Reviser(ask, send, target_name, alt, convert, units, glossary="")`：`ask(messages, timeout) -> dict`（已解析的 JSON 回答）、`send(payload)`、`alt(start_ms, end_ms) -> str`、`convert(text) -> str`、`units(text) -> int`（內容的單位數，由 `QualityPass` 以 `quality_pass.units()` 提供）。方法：`add(sentences)`（句子含 `id, source, target, lang, startMs, endMs`）、`async finish()`（至多 `FINISH_TIMEOUT` 30 秒）、`cancel()`。常數 `WINDOW = 6`、`AFTER = 3`、`BEFORE = 6`、`ASK_TIMEOUT = 60`、`FINISH_TIMEOUT = 30`、`MAX_WAITING = 30`。
- `quality_pass.REVISE`（布林）、`quality_pass.REVISE_EXTRA`（dict）；`QualityPass.finish()` 在最後一塊之後等待 `Reviser.finish()`，`cancel()` 同時取消修訂。
- `QualityView.revise(state, event)`（`webapp/static/quality-view.js`）：依 `id` 換掉 `records` 中的 `source`、`target`；`app.js` 收到 `data.revision` 時呼叫並重畫、排入儲存。
- `save_segments`：衝突時 `SET source, target, version + 1`，條件為原文或譯文不同、`state = 'unreviewed'`、沒有 `segment_history`。
- 失敗時：不送事件、記一行不含內容的警告日誌；串流與精準模式照常。
- 驗收：`webapp/test_server.py` 新增 `ReviserTest`（視窗時機、只送改動、筆記延續、回答檢查表、重問、落後時放棄、結束時的處理與逾時、取消、日誌不含內容）、`QualityPassTest` 的編號與啟用／未啟用、`SegmentSaveTests` 的原文更新與已校對不動；`bench/qualitycheck.js` 的 `revise` 案例；`bench/quality_e2e.mjs` 在真實瀏覽器確認修訂後的文字顯示在兩個窗格。之後以正式站設定重錄 10 段並盲評。
- 範圍外：見 Non-Goals。

## Risks / Trade-offs

- 文字模型的用量增加：每 6 句多一次開推理的請求（輸出含推理約數千 tokens）。`deepseek-v4-flash` 單價低，10 段原型共 68 次請求。
- 畫面上的句子會在顯示後改變。只換有改動的句子、位置不動，以降低閱讀時的跳動。
- 修訂可能把對的改錯。以「已正確的譯文逐字保留」的提示與內容長度檢查限制；原型 10 段沒有任何一段分數下降。
- 結束時最後幾句可能來不及修訂（見上）。
- 修訂落後時放棄舊視窗，那些句子維持第一輪結果。
