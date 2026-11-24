## Context

- 段落（`segments`）的 `start_ms`／`end_ms` 由會議頁在會議中存入：
  - 精準模式：`quality_pass.allocate()` 依字數比例分配，誤差量到 1.3～3.8 秒，方向多半偏早。
  - 一般模式：文字出現的時間，比說話晚約 1 秒。
- 會議頁之後的儲存（`PUT /api/meetings/{id}/segments`）不會改已存段落的 `start_ms`；`end_ms` 只在文字有變、段落尚未校對時取較大值。
- 說話者辨識（`diarize.py`）會後自動執行，結果存在 `diarizations.turns`：`[start_ms, end_ms, label, text]`。`store_result()` 用 `speaker_of()` 把段落文字和前 12 秒到後 3 秒內的發言文字做 `SequenceMatcher` 比對來標說話者。
- 播放：
  - 校對頁點段落：`MeetingTimeline.playWindow(start, end, total)`，固定往前 3,000 ms、往後 500 ms（`timeline.js`）。會議紀要的出處面板（`evidence-panel.js`）用同一個函式。
  - 時間軸播放：`speakers.js` 的 `segmentAt(ms)` 以「段落開始前 3,000 ms 到段落結束」判斷目前段落。
- 段落給頁面的格式由 `team_access.py` 的段落轉換函式產生（`startMs`、`endMs`…）。

## Goals / Non-Goals

**Goals:**

- 說話者辨識完成後，文字比對得到的段落，時間改成錄音裡實際說話的時間。
- 校正過的段落，播放範圍和「目前段落」的判斷不再用 3 秒的補償。
- 比對不到的段落和沒有說話者辨識的會議，行為完全不變。

**Non-Goals:**

- 對齊模型、字級時間、會議中的時間估算（見 proposal）。

## Decisions

### 用整場的發言文字做一條「字 → 時間」對照，逐段比對

- 把每次發言的文字正規化（`normalize()`：繁體、小寫、只留字母數字），每個字的時間在該次發言內依位置線性內插：第 k 個字（共 n 個）的開始是 `start + (end-start)*k/n`，結束是 `start + (end-start)*(k+1)/n`。
- 每個段落：取開始前 12 秒到結束後 3 秒內的發言（和 `speaker_of()` 同一個範圍）串成比對池，用 `SequenceMatcher(None, text, pool, autojunk=False)` 取相符區塊。
- 相符字數少於段落字數的 50%，或少於 2 個字：不校正。
- 開始時間 = 第一個長度 ≥ 2 的相符區塊的第一個字的開始；結束時間 = 最後一個長度 ≥ 2 的相符區塊的最後一個字的結束。段落只有 1 個字相符區塊都是長度 1 時，用全部區塊。只取長度 ≥ 2 的區塊，是為了不讓零星對到的單一個字把範圍拉到別句去。
- 段落第一個相符區塊前面還有沒對到的字時（發言文字漏字），開始時間不往前推：寧可晚一點，播放本來就會往前多放 0.3 秒。
- 依 seq 順序處理，並記住前一個校正成功的段落用到的最後一個字在整場發言文字中的位置；之後的段落只比對這個位置以後的字。這樣同一句話說兩次（「好的好的」）時，第二個段落不會又對到第一次（實作時加入，2026-11-24；一開始用時間加 0.5 秒容許值，測試發現前一次發言的尾巴仍會被對到，改成以字的位置為準）。代價：兩人同時說話、後存的段落其實說得比較早時，那個段落會比對不到，維持原本的時間。
- 相符區塊只取「連在一起」的那一群：從最長的區塊往兩邊延伸，下一個區塊在發言文字中跳過的字數，比段落文字在同一處跳過的字數多出超過 4 個字（或段落長度的四分之一，取大者）就停止。兩個辨識引擎的用字常不同（句尾「討論」對「再談」），而下一句又剛好有同樣的字時，不這樣限制會把段落拉長蓋過下一句，下一句的字也被記成用過而無法校正（review 提出，2026-11-24 加入）。50% 的門檻也只算這一群。
- **捨棄的做法**：
  - 直接把段落對到「一次發言」並採用它的起訖。一個段落常跨兩次發言，或一次發言含兩個段落（實測第 3 次發言含兩個段落）。
  - 用音量找停頓。只能找到開口點，分不出哪一句。

### 校正後的時間寫回 start_ms／end_ms，另加 timed 欄位

- `segments` 加 `timed boolean NOT NULL DEFAULT false`。校正成功的段落：更新 `start_ms`、`end_ms`，`timed = true`。不動 `version`（時間不是校對內容，不該讓校對頁的版本檢查失敗）。
- 寫回原欄位，搜尋、紀要出處、問答引用的時間都一起變準，不必每個地方各自挑欄位。
- 順序保護：依 seq 由小到大處理，校正後的開始時間不得早於前一個已校正段落的開始時間，否則這段不校正；`end_ms` 至少比 `start_ms` 晚 200 ms，且不超過錄音長度（有的話）。
- 每次說話者辨識完成（含「重新辨識」）先把這場會議所有段落重新比對。上次校正過、這次比對不到的段落保留上次的時間與 `timed`。
- 會議頁晚到的儲存可能把 `end_ms` 取成較大值（文字有變且尚未校對時）。這只會讓播放尾巴多一點，不影響開始時間；下次「重新辨識」會修正。接受。

### 播放範圍依 timed 分兩種

- `MeetingTimeline.playWindow(startMs, endMs, totalMs, timed)`：`timed` 為真時往前 300 ms、往後 300 ms；否則維持 3,000／500。
- `speakers.js` 的 `segmentAt(ms)`：`timed` 的段落用 `startMs-300 <= ms <= endMs`，其餘維持 3,000。兩個段落都符合時取後面那個（現有行為）。
- 校對頁的「往前 2 秒／往後 2 秒」不變。

### 舊會議用指令補做

`python -m diarize retime [meeting_id]`：沒給 id 時處理所有說話者辨識已完成的會議，印出每場校正了幾段。只改 `start_ms`、`end_ms`、`timed`。部署後由管理者執行一次，不自動跑。每場會議各用一個資料庫連線與交易：某一場失敗只還原那一場並印出失敗，不影響已完成的，也不會整批鎖住段落（review 提出後加入）。

## Implementation Contract

**Behavior（使用者看到的結果）：**

- 說話者辨識完成後重新整理校對頁：段落左邊的時間變成實際說話的時間；點段落播放，從該段開口前 0.3 秒開始。
- 時間軸播放時，被標示並捲到畫面中的段落，是文字相符的那一段。
- 比對不到的段落：時間、播放範圍都和現在一樣。

**Interface（介面）：**

- `diarize.retime(segments, turns, duration_ms=None) -> dict[int, tuple[int, int]]`：純函式，輸入段落（`seq, start_ms, end_ms, source`）和發言，回傳要更新的 `{seq: (start_ms, end_ms)}`。
- `diarize.retime_segments(conn, meeting_id, turns)` 讀段落、呼叫 `retime()`、寫回，回傳校正的段數。`diarize.store_result()` 在存完說話者後呼叫它（包在自己的 savepoint，失敗只記警告）；`python -m diarize retime [meeting_id]`（`retime_stored()`）走同一段程式。
- 段落的 API 輸出多一個 `timed`（布林）。
- `MeetingTimeline.playWindow(startMs, endMs, totalMs=Infinity, timed=false)`。

**Failure modes（出錯時）：**

- 段落文字為空、附近沒有發言、相符不足：不更新，`timed` 維持原值。
- 校正會讓開始時間早於前一個已校正段落：這段不更新。
- 比對在執行緒中跑（`asyncio.to_thread`，和 `assign()` 一樣），失敗只記一行警告，不影響說話者辨識的結果儲存。

**Acceptance（驗收）：**

- `test_server` 新增：
  - 以會議 `6ec5d47e…` 的 12 次發言時間與 11 個段落文字（測試內用等長的替代文字，不放真實內容）驗證 `retime()`：第 2、4、8、10 段的開始時間分別在 7,380、21,330、45,750、59,660 ms 的 ±300 ms 內。
  - 一次發言含兩個段落：第二個段落的開始時間落在該次發言中間，依字數比例。
  - 相符不足 50% 的段落不在回傳內。
  - 順序保護：會倒退的段落不在回傳內。
  - `store_result()` 之後，資料庫中段落的 `start_ms`／`end_ms`／`timed` 已更新，`version` 不變。
- `bench/timelinecheck.js`：`playWindow(4200, 9100, 60000, true)` 為 `{start: 3900, end: 9400}`；不帶 `timed` 的既有檢查不變。
- 實測：對會議 `6ec5d47e…` 執行 `python -m diarize retime <id>`，把校正前後的時間與量到的開口時間並列寫入 evidence.md；在校對頁點第 4 段播放，確認從「思考強度…」開始。
- 既有 `test_server` 全部通過。

**Scope（範圍）：**

- 範圍內：`diarize.py`（校正、指令）、migration、段落 API 輸出、`timeline.js`、`review.js`、`speakers.js`、`evidence-panel.js`、相關頁面的 `?v=`、測試。
- 範圍外：`quality_pass.py`、會議頁、對齊模型、字級高亮。

## Risks / Trade-offs

- [發言文字和段落文字差很多（辨識結果不同、使用者大幅改寫）] → 相符不足就不校正，維持原樣。
- [一次發言很長（例如 30 秒獨白），發言內線性內插不準] → 誤差上限是語速不均造成的幾秒內，仍比字數比例跨區塊分配好；且比對不到時不動。實測發言多在 1～8 秒。
- [校正改了已存的時間，紀要出處顯示的時間跟著變] → 這是想要的結果（更準）。
- [舊會議一次補做會改動大量資料] → 指令只改三個欄位、可重跑；先在單一會議驗證，再由使用者決定是否全部補做。

## Migration Plan

1. 套用 `021_segment_timed.sql`（加欄位，預設 false；既有資料不受影響）。
2. 重啟 app 容器。之後完成的說話者辨識會自動校正。
3. 舊會議：對單一會議執行 `python -m diarize retime <id>` 驗證；全部補做由使用者決定。

## Open Questions

無。

## 已知、這次不處理

- 標說話者時，文字比對不到才用的「時間重疊」判斷仍把段落往前移 1 秒（`LAG_MS`）。對已校正的段落這個位移不再需要（review 的建議）。影響範圍小：只在重新辨識、且已校正段落的文字這次比對不到 30% 時才會用到；要改需要修改「Labelling segments with speakers」需求，留待之後。
