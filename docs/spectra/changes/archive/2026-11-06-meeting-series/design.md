## Context

- 會議屬於團隊（team-accounts），只有團隊成員看得到；建立會議 `POST /api/meetings`，修改主題 `PATCH /api/meetings/{id}`（meeting-topics）。
- 會議進行中，主頁每 10 秒把定稿段落 `PUT /api/meetings/{id}/segments` 存到伺服器（meeting-review），所以伺服器在會議中就讀得到段落與序號。
- 待辦狀態與歷程由 `action-tracking` 提供；`item_updates` 已預留 `meeting_id` 與 `evidence`，供本變更記錄「在哪場會議、哪些段落提到」。
- 紀要模型 `MINUTES_*`（未設定時沿用 `TRANSLATE_REFINE_*`）是雲端模型；本機翻譯模型在會議中忙於即時翻譯，不能拿來偵測。

## Goals / Non-Goals

**Goals:**

- 開會前看到同系列上次還沒完成的待辦。
- 會議中有人提到待辦進度時，提示並讓人一鍵套用，歷程留下證據。
- 所有模型輸出經伺服器驗證，人確認後才生效。

**Non-Goals:**

- 系列改名、刪除、排程；依主題自動歸類。
- 未選系列的會議做偵測；自動套用；本機模型偵測。

## Decisions

### 系列資料表

`webapp/migrations/006_series.sql`：

- `meeting_series`：`id bigserial`、`team_id bigint REFERENCES teams ON DELETE CASCADE`、`name text`（1–60 字）、`name_key text`（`casefold`，與團隊名稱相同做法）、`created_by`、`created_at`；`UNIQUE (team_id, name_key)`。
- `meetings.series_id bigint NULL REFERENCES meeting_series ON DELETE SET NULL`，索引 `(series_id, started_at)`。
- `progress_suggestions`：`id bigserial`、`meeting_id uuid REFERENCES meetings ON DELETE CASCADE`、`item_id bigint REFERENCES minute_items ON DELETE CASCADE`、`to_status text CHECK (to_status IN ('doing','done','cancelled'))`、`note text`、`evidence integer[]`、`state text DEFAULT 'pending' CHECK (state IN ('pending','accepted','dismissed'))`、`created_at`、`decided_by`、`decided_at`；`UNIQUE (meeting_id, item_id, to_status)`（同一場會議同一待辦同一狀態只提示一次，略過的也不再提示）。

### 系列 API 與會議的系列

- `GET /api/teams/{teamId}/series` → `[{id, name}]`，依名稱排序；非成員 404。
- `POST /api/teams/{teamId}/series` `{name}`（去除前後空白，1–60 字）→ 新建回 201，同名（不分大小寫）已存在回 200 並回傳既有系列；非成員 404。
- `POST /api/meetings` 新增選填 `series_id`；系列不屬於該團隊回 422「系列不屬於這個團隊」。
- `PATCH /api/meetings/{id}` 改為部分更新：`title`、`series_id`（`null` 表示不屬於系列）擇一或皆給；系列不屬於會議的團隊回 422。
- `GET /api/meetings/{id}` 與 `GET /api/meetings` 回傳 `seriesId`、`series`（名稱或 `null`）。

替代方案：依主題自動歸類（使用者未選）。主題打錯字就分散，不採用。

### 會前帶出未完成事項

`GET /api/series/{seriesId}/actions?exclude=<meetingId>` → 這個系列中、`exclude` 以外的會議裡 `kind='action'`、`state='confirmed'`、狀態為未開始或進行中的待辦，欄位同看板（含 `overdueDays`、來源會議），排序同看板（逾期多的在前、到期日早的在前）；非成員 404。

主頁：「系列」選單在「主題」旁（選項：不屬於系列、該團隊的系列、「＋ 新增系列…」；選「新增」時就地出現名稱輸入框）；選定的系列記在瀏覽器（依團隊）。選了系列時，設定區下方出現「這個系列還沒完成的待辦（N）」面板，會議中持續顯示；沒有時顯示「這個系列沒有未完成的待辦」。

### 會中進度偵測

`POST /api/meetings/{meetingId}/progress/check` `{after: int}`：

1. 會議沒有系列、模型未設定（400「紀要模型未設定」）、或同系列沒有未完成待辦時，不呼叫模型。
2. 讀取這場會議 `seq > after` 的段落（最多最近 40 段），另附前 2 段作為上下文；沒有新段落時不呼叫模型。
3. 同一場會議同時只會有一個偵測在進行（行程內鎖）；正在進行時直接回傳目前的提示，`busy: true`。
4. 以紀要模型（逾時 60 秒）送出：系統提示（只根據段落、每則必須引用新段落的編號、沒把握就不列、輸出繁體中文 JSON）、待辦清單（`[#id] 內容（負責人、到期、目前狀態）`）、段落（`[seq] 原文`）。要求 `{"updates":[{"item":id,"status":"doing|done|cancelled","note":"一句話","evidence":[seq]}]}`。
5. 驗證：`item` 必須在清單中；`status` 必須是三者之一且不同於目前狀態；`evidence` 只保留這次送出的新段落，空了就捨棄；`cancelled` 沒有說明就捨棄；`note` 截到 200 字；已有同（會議、待辦、狀態）的提示就略過。
6. 回應 `{suggestions:[待處理的提示], checkedThrough: 這次讀到的最大 seq, busy}`；提示含 `id`、`itemId`、`content`（待辦內容）、`fromStatus`、`toStatus`、`note`、`evidence:[{seq, startMs, source}]`。

模型失敗（逾時、格式錯）時回 200 與目前的提示、`error` 訊息，`checkedThrough` 不前進，下次重試同一批。

主頁：面板中有「會中提示待辦進度」勾選框，註明「會議內容會傳送到外部模型服務」，預設關閉、記在瀏覽器；模型未設定時不顯示。開啟且會議進行中時，每次段落存檔後，若距上次偵測已有 3 段以上新的定稿段落且至少 45 秒，就呼叫一次（同時只有一個請求）；會議結束時再對剩下的段落呼叫一次。提示顯示在對應待辦下方：「可能已完成：說明」、證據原文與時間、「套用」「略過」。

替代方案：會後整場比對（使用者選了即時）。即時偵測增加雲端呼叫次數，以門檻（3 段、45 秒）控制；這兩個數字是估計，以實際會議的呼叫次數與提示準確度調整。

### 套用與略過提示

- `POST /api/meetings/{meetingId}/progress/{suggestionId}/accept`：提示必須是待處理（否則 409「這則提示已處理」）；待辦必須仍是已確認的待辦（否則 409，沿用 action-tracking 訊息）；待辦目前狀態已等於提示狀態時，提示標為已套用、不再寫歷程；否則以 `action-tracking` 的狀態變更邏輯更新（`version` 加一），歷程寫入 `meeting_id`=這場會議、`evidence`、`note`=提示說明。回傳提示與更新後的待辦。
- `POST …/dismiss`：待處理的提示標為已略過。
- 權限：使用者必須是這場會議團隊的成員（404）。待辦來自同系列（同團隊）的其他會議，因此同團隊成員都能更新。
- `GET /api/meetings/{meetingId}/progress` → 這場會議所有提示（含狀態），供紀要頁使用。

`webapp/actions.py` 抽出 `apply_status(conn, row, status, note, user, meeting_id=None, evidence=())`，狀態 API 與套用提示共用。

### 紀要頁處理剩下的提示

紀要頁摘要下方，有待處理提示時顯示「會中進度提示（N）」區塊，每則顯示待辦內容、建議狀態、說明、證據時間（點開證據側欄）、「套用」「略過」；全部處理完就不顯示。

### 顯示系列

- 會議列表每列在團隊標籤旁顯示系列名稱。
- 會議頁標頭（meeting-nav）的團隊標籤顯示為「團隊 · 系列」，資訊列仍為五段。
- 校對頁「修改主題」表單加上系列選單（同團隊的系列與「不屬於系列」）。

## Implementation Contract

**Behavior**

- 主頁選系列（可當場新增）後開會，會議屬於該系列；面板列出同系列之前未完成的待辦。
- 開啟會中提示時，會議中提到進度的待辦旁出現提示，套用後狀態更新、歷程記錄這場會議與證據段落。
- 會後紀要頁列出剩下的提示。

**Interface**

- `GET|POST /api/teams/{teamId}/series`；`GET /api/series/{seriesId}/actions?exclude=`；`POST /api/meetings`、`PATCH /api/meetings/{id}` 的 `series_id`；會議回傳 `seriesId`、`series`。
- `POST /api/meetings/{id}/progress/check`、`GET /api/meetings/{id}/progress`、`POST /api/meetings/{id}/progress/{sid}/accept|dismiss`。
- `actions.apply_status(...)`；`minutes.call_model(messages, timeout=...)`。

**Failure modes**

- 非成員 404；系列不屬於團隊 422；名稱空白或超過 60 字 422；模型未設定 400；提示已處理 409；待辦不再是已確認待辦 409。
- 模型失敗：回 200、帶 `error`，不前進 `checkedThrough`；主頁顯示一行「進度偵測暫時失敗，稍後重試」，不打斷會議。

**Acceptance criteria**

- `webapp/test_server.py`：系列建立（同名回既有）、團隊隔離、會議建立／修改系列與 422、未完成待辦清單（排除本場、只含未完成）、偵測的驗證規則（範例表）、不呼叫模型的情況、套用寫入歷程（含 meeting_id 與 evidence）、略過後不再提示、已處理 409。
- `bench/series_e2e.mjs`（假模型以 `page.route` 攔截偵測回應，不呼叫外部服務）：主頁新增系列、面板列出未完成待辦、提示出現並套用後看板狀態改變、紀要頁的剩餘提示、校對頁改系列、列表顯示系列、400px 無水平捲動。
- 既有單元測試與 `bench/*check.js`、`bench/actions_e2e.mjs`、`bench/minutes_e2e.mjs` 維持通過。

**Scope**

- 範圍內：上列遷移、API、主頁、校對頁、紀要頁、列表、文件。
- 範圍外：Non-Goals 所列。

## Risks / Trade-offs

- [即時偵測把會議內容送到外部模型] → 預設關閉、需勾選，並註明會傳送到外部服務（與雲端精修相同做法）。
- [誤報干擾會議] → 只提示不自動套用；略過的不再提示；門檻控制頻率。
- [行程內鎖只在單一 app 行程有效] → 目前部署為單一行程；若改成多行程，改用資料庫鎖。
- [提示依附在會議中存檔的段落序號] → 會後換語言重譯不會改寫已存段落（meeting-review 既有保護），序號不變。
