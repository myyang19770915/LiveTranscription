## Context

會議的段落存在 `segments`（`seq`、`start_ms`、`end_ms`、`source` 為校對後原文），會議有 `title`、`team_id`、`started_at`、`source_language`；團隊成員在 `team_members`，顯示名稱在 `users`。模型呼叫目前有兩條路：本機 llama.cpp（compose `translate`，`--ctx-size 3072`，放不下整場會議）與雲端 OpenAI 相容服務（`TRANSLATE_REFINE_URL`／`_MODEL`／`_KEY`，`server.py` 的 `refine_headers`）。使用者 2026-11-05 決定：抽取不分段，整場一次送出；先用雲端模型，之後會換 context window 更大的模型。權限檢查用 `team_access.require_member`。

## Goals / Non-Goals

**Goals:**

- 從校對後的段落產生摘要與四類條目，每條有證據段落
- 負責人只對應團隊成員，到期日換算成實際日期並保留原話
- 人工修改、確認、駁回、手動新增；重新產生不推翻人的決定
- Markdown 匯出

**Non-Goals:**

- 待辦的狀態追蹤、逾期提醒、系列會議、會前帶出未完成事項（roadmap P3；本變更只預留 `status` 與 `external_ref` 欄位）
- 串接議題追蹤平台、寄信
- 說話者辨識（負責人只靠模型從內容判斷）
- 以 bench 盲評量化抽取品質（測試音檔不是會議；本變更以假模型測流程、以真模型做一次人工檢查）

## Decisions

### 紀要資料表

`webapp/migrations/004_minutes.sql`：

| 表 | 欄位 |
| --- | --- |
| `minutes` | `meeting_id`（PK）、`summary`、`summary_edited`、`summary_version`、`status`（`idle`／`running`／`done`／`failed`）、`model`（實際使用的模型名稱）、`message`、`dropped`（因缺證據捨棄的條數）、`started_at`、`finished_at`、`started_by` |
| `minute_items` | `id`、`meeting_id`、`kind`（`decision`／`action`／`question`／`risk`）、`content`、`owner`（團隊成員帳號或 NULL）、`owner_hint`、`due_date`、`due_text`、`evidence`（int[]）、`origin`（`ai`／`manual`）、`state`（`proposed`／`confirmed`／`rejected`）、`status`（`open`，P3 用）、`external_ref`、`version`、`updated_by`、`updated_at`、`confirmed_by`、`confirmed_at` |

### 整場一次送給可設定的紀要模型

`webapp/minutes.py` 把整場會議的 `[seq] source` 行一次送出，不分段（使用者決定，後續模型 context 足夠）。模型由 `MINUTES_URL`、`MINUTES_MODEL`、`MINUTES_KEY` 設定（OpenAI 相容），未設定時沿用 `TRANSLATE_REFINE_*`；兩者都沒有時產生回 400。回傳 JSON `{"summary": str, "items": [{"kind","content","owner","due_text","due_date","evidence":[int]}]}`，以 `response_format: json_object` 要求並在系統提示附上結構；推理型模型（deepseek）的輸出上限另加 4096 tokens 預留推理空間（與雲端精修相同）。同一回應內依（kind，去空白標點後的 content）去重並合併證據。

替代方案：分段抽取再合併（為了本機 3072 tokens）。使用者決定改用大 context 模型，分段會切斷前後文、增加合併誤差，不採用。

提示內容：會議日期（`MEETING_TIMEZONE` 當地日期與星期）、主題、團隊成員清單（帳號與顯示名稱）、原文語言；要求只根據段落、每條引用段落編號、沒把握就不列、負責人只寫成員清單中的名字、到期日依會議日期換算為 YYYY-MM-DD 並附原話；輸出繁體中文。

### 背景工作在程式內執行

`POST /api/meetings/{id}/minutes/generate` 寫入 `status=running` 後以 `asyncio.create_task` 執行，`GET /api/meetings/{id}/minutes` 輪詢進度。以 `UPDATE … WHERE status <> 'running'` 搶佔，第二次啟動回 409。app 重啟時把殘留的 `running` 改為 `failed`（訊息「產生中斷，請重新產生」）。模型請求逾時 300 秒。

替代方案：獨立工作佇列（Celery、RQ）。單一 app 程序、每場會議一個工作，不需要額外服務。

### 驗證與對應在伺服器端

模型輸出一律視為不可信：kind 不在四類內捨棄；evidence 只保留這場會議實際存在的 seq，空了就捨棄並計入 `dropped`；owner 以小寫比對成員帳號與顯示名稱（完全相同），對不到存為 `owner_hint`；due_date 以 `date.fromisoformat` 驗證，失敗只留 `due_text`；content 去除前後空白、截到 500 字。

### 重新產生只動待確認的 AI 條目

產生完成時於同一交易內：刪除 `origin='ai' AND state='proposed'` 的條目，再插入新條目，但跳過與保留條目同 kind、同正規化內容者；`summary_edited` 為 false 時才覆寫摘要。

### 紀要 API

- `GET /api/meetings/{id}/minutes` → `{status, model, message, dropped, summary, summaryVersion, items:[…], members:[{username, displayName}], modelAvailable}`
- `POST …/minutes/generate` → 202；409 執行中；400 紀要模型未設定；422 沒有段落
- `PATCH …/minutes/summary {version, summary}`
- `POST …/minutes/items {kind, content, owner, dueDate, dueText, evidence}` → 手動新增（confirmed）
- `PATCH …/minutes/items/{itemId} {version, kind?, content?, owner?, dueDate?}`；`POST …/items/{itemId}/confirm {version}`、`…/reject {version}`
- `GET …/minutes.md` → `text/markdown` 附件
- 全部經 `require_member`；條目必須屬於該會議，否則 404；owner 不是團隊成員 422；版本不符 409 並回傳目前值

### 紀要頁

`/meetings/{id}/minutes`（`minutes.html`、`minutes.js`、`minutes.css`，沿用 `tokens.css` 與 `admin.css`）：頂部「返回」與「逐字稿校對」連結、會議主題與資訊；「產生紀要」按鈕（註明會議內容會傳送到外部模型服務；執行中顯示「產生中」）；摘要（可編輯）；四類條目分區，每條顯示內容、狀態（待確認／已確認／已駁回）、負責人選單（團隊成員＋未指派，對不到時顯示「模型提到「小王」，不是團隊成員」）、到期日欄位與原話、證據時間點（連到校對頁 `#seg-N`）、修改／確認／駁回；「新增條目」；「下載 Markdown」。校對頁支援 `#seg-N`：載入後捲到並展開該段（不自動播放）。

## Implementation Contract

**可觀察的行為：** 見上方 API 與頁面；錯誤訊息：「這場會議沒有段落，無法產生紀要」「紀要正在產生中」「紀要模型未設定」「產生中斷，請重新產生」「這個條目已被其他人修改，已重新載入」「負責人必須是團隊成員」。

**驗收：**

- `webapp/test_server.py` 以假模型（替換 `minutes.call_model`）涵蓋 spec 每個 scenario 與三張範例表，包含一次送出整場段落、409、失敗保留條目、模型未設定 400、重新產生保留人工決定、Markdown 內容、跨團隊 404。
- 真實模型：以目前設定的紀要模型（雲端 deepseek）對一場已存在的會議產生一次，確認產生完成、條目都有證據；耗時、條目數、捨棄數與觀察寫入任務完成說明。
- 以 Playwright 在紀要頁：產生、修改負責人並確認、駁回一條、新增一條、下載 Markdown、點證據跳到校對頁對應段落，桌面與 400px 截圖。

**範圍內：** 上述資料表、模組、API、頁面、入口連結、測試、文件。
**範圍外：** 見 Non-Goals。

## Risks / Trade-offs

- [模型抽出空泛或錯誤條目] → 全部條目需人工確認；強制證據讓錯誤容易被發現。
- [超長會議超過模型 context] → 1 小時會議約 18,000 字（估計值，依中文語速 300 字／分），在目前雲端模型的 context 內；超過時模型呼叫失敗、狀態為 failed 並保留既有條目，頁面顯示錯誤訊息。換更大 context 的模型只需改 `MINUTES_*`。
- [模型服務會收到會議內容] → 頁面註明「會議內容會傳送到外部模型服務」；要完全本機時，把 `MINUTES_URL` 指向本機的大 context 模型。

## Migration Plan

app 啟動時套用 `004_minutes.sql`；舊會議沒有紀要，進入頁面即可產生。回滾時舊版程式不讀新表。
