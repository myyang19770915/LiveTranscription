## Context

`action-tracking` 的看板（`/actions`）以三欄列出已確認待辦，每張卡片攤開狀態選單、歷程與來源連結；篩選列是四個下拉選單。使用者要求參考 Jira 看板。參考資料：Jira 卡片固定顯示編號、類型、摘要、優先級、負責人，其餘欄位最多再加三個（Atlassian「Customizing cards」）；Jira 常以「依負責人分泳道」觀察每人負擔（Atlassian Community）。狀態 API、負責人與到期日修改 API（`PATCH /api/meetings/{id}/minutes/items/{itemId}`，帶 `version`）都已存在。

## Goals / Non-Goals

**Goals:**

- 卡片一眼看出：做什麼、誰、何時到期、是否逾期。
- 改狀態像 Jira：拖曳換欄；細節在面板裡改。
- 快速縮小範圍：快速篩選鈕、頭像篩選、泳道。

**Non-Goals:**

- 優先級、故事點、標籤、子任務、衝刺、WIP 上限、自訂卡片欄位、手機拖曳、欄內手動排序。

## Decisions

### 精簡卡片

卡片（`article.action-card`，`tabindex=0`）：第一行內容（最多三行，超過以省略號截斷）；底列左側編號 `#id`（等寬字）與到期標籤（`11/13`；逾期紅底「逾期 N 天」；今天起 2 天內到期為橘色）；右側負責人頭像（24px 圓形、顯示名稱首字、背景色依帳號雜湊選自 6 色；`title` 為顯示名稱；未指派為虛線圓）。卡片頂部小字為來源會議（`團隊 · 會議主題`，沒有主題時為開始時間）；依來源會議分組時，泳道標題再加上會議日期與系列名稱，同主題的例行會議也能分辨。「2 天內到期」與「近 14 天完成」以 API 回傳的伺服器今天（`today`，`MEETING_TIMEZONE`）判斷。逾期卡片左側 3px 紅色色條。已完成、已取消的卡片內容為次要色，已取消加刪除線。

替代方案：保留卡片上的狀態選單。資訊太密，與 Jira 精神不符，不採用。

### 拖曳換欄

HTML5 drag and drop：卡片 `draggable`，欄位為放置區，拖曳時目標欄外框高亮。放到不同狀態的欄：`todo`／`doing`／`done` 直接呼叫狀態 API；`cancelled` 開啟該卡的詳細面板並聚焦取消原因。409 時以提示訊息說明並重新載入看板。觸控裝置不支援 HTML5 拖曳，改在面板中改狀態。

### 詳細面板

右側 `aside#detail`（寬 `min(480px, 100vw)`，在頂部列下方；寬螢幕 ≥ 1200px 時看板讓出空間）。內容：編號與狀態選單（沿用 `ActionStatus.control`，含取消原因與歷程）、內容全文、負責人選單（限該待辦團隊的成員，`people[].teams` 過濾）、到期日、團隊與來源會議連結（`/meetings/{id}/minutes#item-{id}`）、原話到期描述。負責人與到期日以既有 `PATCH …/items/{itemId}`（`version`）修改，409 時以回傳的條目更新面板並提示。開啟時網址加上 `item=<id>`（`history.replaceState`），載入時若有就開啟該卡；Esc 或關閉鈕關閉並移除參數。歷程每筆若有 `meetingId`，顯示「於會議中提到」連結到那場會議逐字稿的第一個證據段落（`/meetings/{id}#seg-N`），比連到紀要更能直接看到原話。面板的錯誤（409、422）顯示在面板內；待辦沒有變更時，看板重新載入不重建面板（保留展開的歷程與輸入中的取消原因）。

### 快速篩選、頭像列與泳道

篩選列：搜尋框、團隊選單、「分組」選單（不分組／依負責人／依來源會議），下一列為快速篩選鈕與頭像列：

| 鈕 | 網址參數 |
| --- | --- |
| 只看我的 | `owner=me` |
| 未指派 | `owner=none` |
| 逾期 | `due=overdue` |
| 7 天內到期 | `due=week` |
| 沒有到期日 | `due=none` |

同一參數的鈕互斥（按下另一個會取代，再按一次取消）。頭像列列出 `people`（最多 12 人，其餘收進「+N」下拉選單）；點頭像設 `owner=<帳號>`，再點取消。「顯示已取消」為切換鈕 `cancelled=1`。分組寫入 `group=owner|meeting`。

泳道：依分組把待辦分成數列，每列標題（頭像或會議名稱、件數、收合鈕），列內同樣分欄；泳道依名稱排序，「未指派」與「沒有來源」排最後。收合狀態存在瀏覽器。

### 已完成欄只顯示近 14 天

`statusAt` 為最後一次狀態變更時間（`minute_items.status_at`，未變更過為 NULL）。已完成欄預設只顯示 `statusAt` 在 14 天內的待辦（`statusAt` 為 NULL 的已完成待辦視為較早），欄底「另有 N 件較早完成」按鈕展開全部。這是前端呈現，API 不變（仍回傳全部，上限 500）。

### API 補充欄位

`actions.action_rows` 回傳加上 `statusAt`（ISO 或 null）與 `series`（系列名稱或 null）；`GET /api/actions` 的 `people` 每人加上 `teams`（所屬團隊 id 陣列，只含使用者自己也在的團隊）。

## Implementation Contract

**Behavior**

- 卡片精簡；拖曳換欄改狀態；拖到已取消要求原因；點卡片開面板，可改狀態、負責人、到期日並看歷程；網址可分享開啟的卡。
- 快速篩選、頭像列、分組泳道，條件都在網址。
- 已完成欄預設只顯示近 14 天。

**Interface**

- `GET /api/actions` 項目新增 `statusAt`、`series`；`people[].teams`。
- 網址參數：`q`、`team`、`owner`、`due`、`cancelled`、`group`、`item`。

**Failure modes**

- 拖曳或面板操作遇到 409：提示並以伺服器資料更新。
- 負責人不是團隊成員：422「負責人必須是團隊成員」顯示於面板。
- 網址 `item` 不在目前結果中：不開面板。

**Acceptance criteria**

- `webapp/test_server.py`：`statusAt`、`series`、`people[].teams` 的內容（含他團隊成員不出現在 `teams`）。
- `bench/actions_e2e.mjs`：精簡卡片（無狀態選單、有頭像與編號）、拖曳到進行中與已完成、拖到已取消開面板要求原因、面板改負責人與到期日、`?item=` 重新整理後仍開啟、快速篩選互斥、頭像篩選、依負責人分組有泳道、已完成欄隱藏較早完成並可展開、400px 無水平捲動。
- 既有 `bench/minutes_e2e.mjs`、`bench/series_e2e.mjs`、單元測試維持通過。

**Scope**

- 範圍內：看板頁、`action_rows` 欄位、測試與 README。
- 範圍外：紀要頁的待辦卡片樣式（維持現狀）、Non-Goals 所列。

## Risks / Trade-offs

- [拖曳只在桌面可用] → 面板的狀態選單在所有裝置都可用。
- [已完成 14 天的界線在前端，API 仍回傳全部] → 看板上限 500 筆的風險不變；若實際資料量接近上限，再把條件移到 API。14 天是估計值，依使用回饋調整。
- [頭像色依帳號雜湊] → 不同人可能同色；以首字與 `title` 區分。
