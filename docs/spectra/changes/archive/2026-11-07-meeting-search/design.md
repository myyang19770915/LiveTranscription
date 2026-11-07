## Context

可搜尋的資料：`segments.source`（校對後原文）、`segments.target`（譯文）、`minute_items.content`（含 `meeting_id` 為空的看板待辦，見 board-created-actions）、`meetings.title`。權限一律以 `team_members` 判斷（會議看 `meetings.team_id`，條目看 `minute_items.team_id`）。既有的 `team_access.like_pattern` 會把使用者輸入中的 `%`、`_`、`\` 轉成字面比對。深連結已存在：校對頁 `/meetings/{id}#seg-N`、紀要頁 `/meetings/{id}/minutes#item-N`、看板 `/actions?item=N`。

## Goals / Non-Goals

**Goals:**

- 中日英文的子字串搜尋，結果可追溯到原段落與錄音時間。
- 條件篩選與結果都能用網址分享。

**Non-Goals:**

- 語意搜尋、模糊／同音、相關度排序。

## Decisions

### 用 pg_trgm 的 ILIKE，不用 tsvector

Postgres 內建全文搜尋（tsvector）以空白切詞，對中日文無效；中文斷詞套件（zhparser、pg_jieba）要換資料庫映像。`pg_trgm` 已隨官方映像提供，GIN `gin_trgm_ops` 索引可以加速 `ILIKE '%詞%'`，對任何語言都是子字串比對。少於 3 個字的詞無法用 trigram 索引，會退回循序掃描；以目前資料量（數十場會議，估計值）沒有影響，資料量大時再評估 `pg_bigm`。

### 多詞 = 同一段文字中全部出現

查詢以空白切成最多 5 個詞，每個詞各自 `ILIKE`，同一筆資料必須全部符合（AND）。逐字稿段落的原文或譯文任一符合即可，但同一個詞必須在同一欄位裡（避免原文一半、譯文一半）。

### 依會議分組，新的在前，總數上限 300 筆

每類各查最多 300 筆，合併後依會議開始時間新到舊、會議內依段落序號與條目編號排序，再截到 300 筆並回傳 `truncated`。看板待辦（沒有會議）同一團隊合併為一個「看板待辦」群組，位置依其中最新的一筆。

### 頁首放大鏡與 `/` 快捷鍵

頁首已有多個文字按鈕，搜尋用圖示按鈕（`aria-label`「搜尋」），在手機寬度也顯示。`/` 在焦點不在輸入框時開啟 `/search`（已在搜尋頁則聚焦搜尋框）。

## Implementation Contract

**API**：`GET /api/search?q=&team=&series=&from=&to=&kind=`（已登入）

- `q`：去頭尾空白後 1–100 字；空白 422「請輸入要搜尋的字」，超過 422「搜尋字最多 100 個字」。以空白切詞，最多取前 5 個。
- `team`：須為所屬團隊，否則 404；`series`：須屬於所屬團隊的系列（有給 `team` 時須屬於該團隊），否則 404；`from`／`to`：日期（MEETING_TIMEZONE）；`kind` ∈ `all`（預設）、`segments`、`items`、`meetings`，其他 422。
- 回應：

```
{query, terms, total, truncated,
 groups: [{meetingId|null, title|null, startedAt|null, team, series|null,
           hits: [{type:"segment", seq, startMs, source, target}
                  |{type:"item", id, kind, content, state, status|null}
                  |{type:"title"}]}]}
```

- 逐字稿：段落原文或譯文含所有詞。紀要：`state` 為 proposed 或 confirmed（駁回的不列）且內容含所有詞；看板待辦的 `meetingId` 為 null，日期依建立時間（`confirmed_at`）。會議主題：主題含所有詞。系列篩選：會議的系列，或看板待辦本身的系列。

**頁面**：`/search`，搜尋框＋篩選列（團隊、系列〔依團隊載入〕、起訖日期、類型），條件寫入網址（`?q=&team=&series=&from=&to=&kind=`）並在載入時還原。結果每組顯示會議主題（或「未命名會議」＋時間）、團隊、系列、日期與筆數；每筆以 `<mark>` 標出所有詞（大小寫不分），逐字稿顯示時間點並連到 `/meetings/{id}#seg-N`，紀要連到 `/meetings/{id}/minutes#item-N`，看板待辦連到 `/actions?item=N`，主題連到校對頁。沒有結果時顯示建議（換個詞、放寬篩選）。

**驗收**

- 單元測試 `SearchTests`：原文、譯文、紀要、看板待辦、主題各自可搜到；多詞 AND 且同欄位；大小寫不分；`%`／`_` 字面比對；駁回條目不列；非成員團隊的資料搜不到、指定其團隊 404；系列與日期與類型篩選；`q` 空白 422、`kind` 非法 422；超過上限時 `truncated`；migration 建立了 `pg_trgm` 與索引。
- bench/search_e2e.mjs：頁首放大鏡與 `/` 開啟搜尋；搜尋樣本會議的詞，結果分組、`<mark>` 標示、連結到校對頁段落並可播放；類型篩選與網址還原；400px 無橫向捲動。

**範圍**：只新增搜尋；既有會議列表的主題篩選不變。

## Risks / Trade-offs

- 少於 3 字的詞不走索引 → 目前資料量無感；記錄於此，量大時再改 `pg_bigm`。
- 子字串比對無法處理同義詞或錯字 → 由 P4 第二步的語意問答補足。
