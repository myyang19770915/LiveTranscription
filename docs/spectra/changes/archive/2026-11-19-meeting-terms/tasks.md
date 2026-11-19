## 1. 名詞的純函式

- [x] 1.1 實作 `translation_quality` 的名詞函式，並以 test_server `MeetingTermsTest` 驗證。
  - `replace_term`：拉丁字母寫法整字比對、不分大小寫；其他寫法直接比對字串。`apply_aliases` 改用它。
  - `merge_glossary(glossary, fixes)`：把更正存成會議名詞。
  - `suggested_glossary(glossaries)`：由新到舊合併錯誤寫法，最多 30 個名詞、1000 字。
  - 驗證項目：規格範例表（替換四列、合併兩列），以及 `LINE=耐、阿祖` 修正後為 `LINE=耐、阿總=阿祖`。

## 2. 伺服器 API

- [x] 2.1 實作 `POST /api/meetings/{id}/terms`（Fixing terms across a meeting；Fixed terms become the meeting's terms）。 [after: 1.1]
  - 驗證 1–20 列：長度、兩側不同、不含分隔符號。
  - 在單一交易內替換所有段落的原文與譯文；每段以 `review.record(kind="edit")` 記錄，狀態設為 edited；更新 `meetings.glossary`。
  - 非成員回 404，輸入不合法回 422；沒有符合的段落時 `changed` 為 0，不寫紀錄。
  - 依設計「一次更正走一個交易，每段記成 edit」；需求「Fixing terms across a meeting」「Fixed terms become the meeting's terms」。
  - 驗證：`MeetingTermsTest` 的 API 測試，涵蓋規格情境「A misheard name and a homophone」、「Invalid pairs」與非成員 404。
- [x] 2.2 實作 `GET /api/teams/{team_id}/terms?series_id=&title=`（Terms of earlier meetings are offered before a meeting），並把 `server.TranslationRequest.glossary` 放寬到 1000 字。 [after: 1.1]
  - 需求「Terms of earlier meetings are offered before a meeting」。
  - 來源：同團隊已結束的會議，同系列優先，否則同主題，合併最近 5 場。
  - 驗證：`MeetingTermsTest` 涵蓋規格情境「A weekly meeting in a series」、合併範例，以及非成員 404。

## 3. 頁面

- [x] 3.1 會議頁新增「修正名詞」按鈕與對話框，沿用現有對話框樣式，手機寬度也能用。 [after: 2.1]
  - 對話框可以輸入多列，每列即時顯示找到幾處。
  - 按「全部更正」後更新段落，並提示更正了幾段。
  - 驗證：`bench/meeting_terms_e2e.mjs` 在測試會議上修正一個名詞，段落與修改紀錄都更新；另存 400px 截圖。
- [x] 3.2 開會設定頁帶入以前的名詞。 [after: 2.2]
  - 「會議情境」的 maxlength 改成 1000。
  - 選了系列，或主題停止輸入 600 ms 後查詢；有名詞時顯示「帶入上次的名詞（N 個）」，按下後合併填入；開會中隱藏。
  - 驗證：`bench/meeting_terms_e2e.mjs` 選了系列後出現按鈕並能填入；另存 400px 截圖。

## 4. 收尾

- [x] 4.1 更新靜態檔版本號；全部 test_server、meeting_terms_e2e、ui_consistency_e2e 都通過。 [after: 3.1, 3.2]
