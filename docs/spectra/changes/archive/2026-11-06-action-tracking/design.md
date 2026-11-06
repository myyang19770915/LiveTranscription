## Context

`meeting-minutes` 的 `minute_items` 已有 `status text DEFAULT 'open'` 與 `external_ref`，並註明供 P3 使用（meeting-minutes / 紀要資料表）。條目的修改、確認、駁回都帶 `version`，舊版本回 409（meeting-minutes 的「Human confirmation」）。權限沿用 team-accounts：只有會議所屬團隊的成員能讀寫，其他人 404；團隊成員都可以修改（使用者決定）。日期一律以 `MEETING_TIMEZONE`（預設 Asia/Taipei）計算，與會議列表篩選一致。

## Goals / Non-Goals

**Goals:**

- 已確認的待辦可以追蹤狀態，每次變更都有紀錄。
- 一個頁面看到所屬團隊所有待辦，逾期一眼可見。
- 下一個變更（會中進度偵測）可以直接寫入同一份歷程。

**Non-Goals:**

- 決議、問題、風險的狀態；拖曳換欄；通知；外部平台同步；Markdown 格式變更。
- 系列會議與會前帶出未完成事項（`meeting-series`）。

## Decisions

### 待辦狀態與歷程資料表

`webapp/migrations/005_actions.sql`：

- `minute_items.status` 既有的 `open` 改為 `todo`，預設值改為 `todo`，加上 `CHECK (status IN ('todo', 'doing', 'done', 'cancelled'))`；新增 `status_note text NOT NULL DEFAULT ''`、`status_by text`、`status_at timestamptz`。
- 新表 `item_updates`：`id bigserial`、`item_id bigint REFERENCES minute_items ON DELETE CASCADE`、`from_status`、`to_status`、`note text NOT NULL DEFAULT ''`、`meeting_id uuid NULL REFERENCES meetings ON DELETE SET NULL`（在哪場會議提到這次進度，本變更一律 NULL，`meeting-series` 使用）、`evidence integer[] NOT NULL DEFAULT '{}'`、`changed_by text NOT NULL`、`changed_at timestamptz NOT NULL DEFAULT now()`；索引 `(item_id, id)`。
- 看板查詢用索引 `minute_items (kind, state, status)`。

狀態顯示名稱：`todo` 未開始、`doing` 進行中、`done` 已完成、`cancelled` 已取消。

替代方案：另開 `actions` 表、確認時複製過去。資料會分成兩份，紀要頁與看板要同步，不採用；狀態直接放在條目上。

### 狀態變更 API

`POST /api/meetings/{meetingId}/minutes/items/{itemId}/status`，body `{version, status, note}`（`note` 最多 500 字，去除前後空白）：

| 情況 | 回應 |
| --- | --- |
| 非團隊成員、會議或條目不存在 | 404 |
| `version` 不是目前版本 | 409，附目前的條目（與其他條目修改相同） |
| 條目不是已確認的待辦 | 409「只有已確認的待辦可以更新狀態」 |
| `status` 與目前相同 | 422「狀態沒有改變」 |
| `status` 為 `cancelled` 而 `note` 為空 | 422「取消待辦請填寫原因」 |
| 其他 | 200，條目 `status`、`status_note`、`status_by`、`status_at` 更新，`version` 加一，`item_updates` 新增一筆，回傳條目 |

`GET /api/meetings/{meetingId}/minutes/items/{itemId}/updates` 回傳歷程，新的在前：`[{from, to, note, by（顯示名稱）, at, meetingId, evidence}]`。

駁回或改回其他類型的條目保留其狀態，但不出現在看板。

### 逾期在伺服器端判斷

`overdueDays`：狀態為 `todo` 或 `doing`、有到期日、且到期日早於 `MEETING_TIMEZONE` 的今天時，為今天減到期日的天數；否則為 0。條目的回傳（紀要頁與看板）都附上 `status`、`statusNote`、`overdueDays`。以伺服器的今天為準，避免使用者電腦時區不同造成結果不同。

### 待辦看板

頁面 `/actions`（`actions.html`、`actions.js`、`actions.css`，沿用 `tokens.css`、`admin.css`、`review.css` 的頂部列、卡片、按鈕）。

`GET /api/actions` 參數：

- `team`：團隊 id，不是成員回 404。
- `owner`：帳號、`me`（自己）或 `none`（未指派）。
- `status`：逗號分隔，預設 `todo,doing,done`。
- `due`：`overdue`、`week`（今天起 7 天內到期且未完成）、`none`（沒有到期日）。
- `q`：內容關鍵字，跳脫方式同會議列表。

只回傳使用者所屬團隊、`kind = 'action'`、`state = 'confirmed'` 的條目，排序為逾期天數多的在前、到期日早的在前（沒有到期日排最後）、id。最多 500 筆。回傳 `{items, teams, people}`：`items` 每筆含條目欄位與來源會議（`meetingId`、`meetingTitle`、`startedAt`、`team`）；`teams` 與 `people`（所屬團隊的成員，含顯示名稱）供篩選選單使用。

畫面：篩選列（團隊、負責人、到期、關鍵字、「顯示已取消」）寫入網址；三欄未開始、進行中、已完成，勾「顯示已取消」時加第四欄；欄位標題附數量。卡片：內容、負責人（未指派以灰字）、到期日與「逾期 N 天」（紅色）、來源會議（連到 `/meetings/{id}/minutes`）、狀態選單、「歷程」。選「已取消」時就地要求填原因後才送出。手機寬度各欄改為上下排列。

替代方案：在會議列表加待辦分頁。待辦跨會議，放在會議底下難以總覽，不採用。

### 紀要頁顯示與更改狀態

紀要頁已確認的待辦卡片加上狀態選單、逾期標示與「歷程」，行為同看板；未確認或駁回的待辦不顯示狀態。409 時以回傳的條目取代畫面上的條目（沿用紀要頁既有做法）。

### 導覽連結

`account.js` 在不是看板的頁面加上「待辦看板」連結（`/actions`），與「會議紀錄」並列。

## Implementation Contract

**Behavior**

- 已確認的待辦預設「未開始」；團隊成員可改為進行中、已完成、已取消（需原因）或改回；每次變更寫入歷程。
- 看板只顯示所屬團隊已確認的待辦，依篩選條件分欄；逾期以紅字顯示天數。
- 紀要頁的已確認待辦可改狀態、看歷程。

**Interface**

- `POST /api/meetings/{meetingId}/minutes/items/{itemId}/status` `{version:int, status:'todo'|'doing'|'done'|'cancelled', note:str}`。
- `GET /api/meetings/{meetingId}/minutes/items/{itemId}/updates`。
- `GET /api/actions?team=&owner=&status=&due=&q=` → `{items:[…], teams:[{id,name}], people:[{username,displayName}]}`。
- 條目回傳新增 `status`、`statusNote`、`overdueDays`。
- 頁面 `/actions`（未登入導向登入頁）。

**Failure modes**

- 見「狀態變更 API」表；未知的 `status` 或 `due` 值回 422（FastAPI 驗證）。
- 看板 `team` 不是自己的團隊回 404；`owner` 是不存在的帳號時回傳空清單。

**Acceptance criteria**

- `webapp/test_server.py`：遷移後既有 `open` 變成 `todo`；狀態變更的每一列（表）；歷程內容與順序；逾期範例；看板篩選、團隊隔離、排序。
- `bench/actions_e2e.mjs`：在真實頁面改狀態、取消需原因、逾期紅字、篩選寫入網址、從卡片連到紀要頁、紀要頁改狀態；400px 無水平捲動。
- 既有 131 個單元測試與 `bench/*check.js`、`bench/minutes_e2e.mjs` 維持通過。

**Scope**

- 範圍內：上列遷移、API、頁面、導覽、文件。
- 範圍外：系列會議、會中偵測、通知、外部同步、Markdown 格式。

## Risks / Trade-offs

- [看板一次最多 500 筆，已完成的待辦會越積越多] → 預設排序把未完成與逾期排前面；若實際使用超過上限，再加「只顯示近 30 天完成」的條件。這是估計，以實際資料量確認。
- [狀態與內容修改共用 `version`] → 兩人同時一個改內容、一個改狀態時，後送出的人會收到 409 並看到最新條目，需要再操作一次；換得不會互相覆蓋。
- [逾期以伺服器時區判斷] → 跨時區團隊看到的「今天」以 `MEETING_TIMEZONE` 為準，與會議列表一致。
