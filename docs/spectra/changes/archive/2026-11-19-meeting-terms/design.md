## Context

每場會議的名詞存在 `meetings.glossary` 裡：
- 開會時由「會議情境」欄送出，格式是 `正確=錯誤1/錯誤2、名詞`。
- 由 `translation_quality.glossary_entries` 解析，最多 30 個。
- 這個格式已經被即時逐字稿（`apply_aliases`）、語音辨識提示（`asr_context`，只給正確寫法）、翻譯與精準模式（TERMS）使用。

段落修改走 `review.record()`：更新 `segments`，並寫一筆 `segment_history`。`segment_history` 的 kind 只能是 edit、retranslate 或 confirm。

## Goals / Non-Goals

**Goals:**
- 會後一次更正整場的名詞，並留下紀錄。
- 更正存成這場會議的名詞。
- 開會前從同系列或同主題的會議帶入名詞，讓使用者確認。

**Non-Goals:** 自動重譯、改紀要、全團隊名詞庫、單字替換（理由見 proposal）。

## Decisions

### 一次更正走一個交易，每段記成 edit

API 是 `POST /api/meetings/{id}/terms`，body 為 `{"fixes": [{"wrong": "阿祖", "right": "阿總"}]}`，可以有 1–20 列。

**每列的限制：**
- `wrong` 2–40 字；拉丁字母寫法至少要有 2 個字母。
- `right` 1–40 字。
- 兩者不能相同。
- 兩者都不能含名詞格式的分隔符號（= , ， 、 ; ； / ／ | ｜）或換行。

**權限：** 只有團隊成員可以用（`team_access.require_member`）。

**處理流程：**
1. 在同一個交易裡，用 `SELECT … FOR UPDATE` 鎖住這場會議的所有段落。
2. 對每段的 source 與 target，依序套用每一列替換。拉丁字母寫法整字比對、不分大小寫（和 `apply_aliases` 相同）；其他寫法直接比對字串。
3. 有變動的段落用 `review.record(kind="edit")` 記錄，狀態設為 edited。修改紀錄會顯示「原本 → 更正後」。
4. 回傳 `{"changed": N, "segments": [...], "glossary": "..."}`。

**替代方案：** 讓頁面逐段呼叫既有的 edit API。缺點是要送很多請求，中途失敗會只改一半，版本衝突也要逐段處理，所以不採用。

替換規則抽成 `translation_quality.replace_term(text, wrong, right)`，`apply_aliases` 也改用它，兩邊的行為才會一致。

### 更正存成會議名詞

`translation_quality.merge_glossary(glossary, fixes)` 把每列加成 `right=wrong`：
- `right` 已經是名詞時，把 `wrong` 加進它的錯誤寫法。
- `wrong` 原本是某個名詞的正確寫法時，拿掉那個名詞，因為它已經被證明是錯的。
- 結果最多 30 個名詞、1000 字，超過時先丟最舊的。

最後寫回 `meetings.glossary`。

### 會前帶入：同系列優先，其次同主題

API 是 `GET /api/teams/{team_id}/terms?series_id=&title=`，只限團隊成員。

**名詞來源：** 同團隊、已結束（`ended_at` 不是空的）的會議，最多取最近 5 場。
- 有 `series_id` 時，取同系列的會議。
- 沒有系列但 `title` 不是空的時，取主題完全相同（去掉前後空白後比對）的會議。

**合併方式：** `suggested_glossary` 把這些會議的 `glossary` 由新到舊合併，同一個正確寫法的錯誤寫法放在一起，最多 30 個名詞、1000 字。

**回傳：** `{"glossary": "...", "count": N}`。沒有來源時，`count` 為 0。

**設定頁的行為：**
- 系列或主題改變時查詢一次；主題要停止輸入 600 ms 後才查。
- `count > 0` 時，在「會議情境」欄下方顯示按鈕「帶入上次的名詞（N 個）」。
- 按下按鈕後，把結果和欄位裡已經有的內容合併，欄位原有的內容優先。不會自動覆蓋。
- 開會中隱藏這個按鈕。

### 「會議情境」放寬到 1000 字

**要改的地方：**
- `index.html` 的 `maxlength` 改成 1000。
- `server.TranslationRequest.glossary` 的 `max_length` 改成 1000。

**原本就夠、不用改的地方：**
- 存檔時 `review.SegmentsIn.glossary` 已經允許 4000 字。
- WebSocket 的 `system_prompt` 已經截在 4000 字。

名詞數量上限維持 30 個，所以語音辨識提示的長度不變。

## Implementation Contract

- `replace_term`、`merge_glossary`、`suggested_glossary` 都是純函式，各有單元測試。
- 修正 API 在一個交易內完成：
  - 不是成員回 404，和其他會議 API 一致。
  - 輸入不合法回 422。
  - 沒有任何段落符合時回 200，`changed` 為 0，不寫紀錄。
- 頁面上每列找到幾處由前端計算，規則和伺服器相同。

## Risks / Trade-offs

- **風險：** 替換可能改到本來就對的地方。
  **對策：** 對話框先顯示每列找到幾處，使用者確認後才套用；每段都留紀錄，可以從修改紀錄看出改了什麼。
- **風險：** 帶入的名詞可能已經過時。
  **對策：** 只帶最近 5 場，而且要使用者按下按鈕才填入，填入後還可以修改。
