## Context

`minutes-mail` 已提供 SMTP 寄送（`mailer.send_message`／`deliver`）、`users.email` 與 `PUBLIC_BASE_URL`。待辦是 `minute_items` 中 `kind='action' AND state='confirmed'` 的列，`owner` 是帳號，`due_date` 是日期，逾期以 `MEETING_TIMEZONE` 的今天判斷（`minutes.local_today()`）。看板以 `/actions?item=<id>` 開啟事項詳細面板。app 的背景工作（問答索引、說話者辨識）都在 `server.lifespan` 以 `asyncio.create_task` 啟動。

使用者決定（2026-11-09）：到期前 3 日、到期當天、每日逾期寄給負責人；可個別取消事項的提醒，只有負責人與管理員可以取消。

## Goals / Non-Goals

**Goals:**

- 負責人在需要的時候收到提醒，不重複、不漏寄（服務重啟或寄送失敗後會補）。
- 不想收的事項可以關掉。

**Non-Goals:**

- 收件人擴大到負責人以外、可自訂天數或時間、其他通知管道。

## Decisions

### 提醒種類與去重鍵

`reminder_log(item_id FK CASCADE, kind, day, owner, due_date, sent_at)`，主鍵 `(item_id, kind, day)`：

| kind | 條件（today＝`MEETING_TIMEZONE` 的今天） | day |
| --- | --- | --- |
| `soon` | `1 ≤ due_date − today ≤ 3` | `due_date` |
| `due` | `due_date = today` | `due_date` |
| `overdue` | `due_date < today` | `today` |

`soon` 與 `due` 以到期日為鍵：同一個到期日只提醒一次，改了到期日會重新提醒；`overdue` 以今天為鍵：每天一次。「到期前 3 天」用 1–3 天的區間而非剛好第 3 天，這樣到期日設得較近（例如 2 天後）或服務那天沒跑時仍會收到一次。

### 先佔位再寄，失敗撤銷

每次執行先以 `INSERT … ON CONFLICT DO NOTHING RETURNING` 佔住這次要寄的 (item, kind, day)；只有佔到的列會寄出，所以兩個同時執行的 run 不會重複寄。寄給某位負責人失敗時刪除他這次佔的列並記錄警告，下次執行（隔天或重啟）會重試。

### 一位負責人一封

同一次執行中同一位負責人的事項合併為一封：主旨「[語橋 Live] 待辦提醒：逾期 N 件、今天到期 N 件、3 天內到期 N 件」（只列非零），內文依逾期（逾期天數多的在前）、今天到期、即將到期分組，每件寫內容、團隊與來源會議、到期日、狀態與看板連結 `PUBLIC_BASE_URL/actions?item=<id>`。純文字與 HTML 兩部分，HTML 文字一律跳脫。

### 排程在 lifespan，啟動時補做

`reminders.worker()`：啟動時若現在已過今天的 `REMIND_AT` 就立刻執行一次，之後睡到下一個 `REMIND_AT` 再執行。`next_run(now)` 是純函式，便於測試。`REMIND_AT` 格式錯誤時記錄錯誤並使用 09:00。SMTP 未設定時 run 直接回傳不寄。

### 關閉提醒存在 minute_items.remind

`minute_items.remind boolean NOT NULL DEFAULT true`。`POST /api/actions/{id}/remind {"on": bool}`：事項須是使用者團隊的已確認待辦（否則 404），且使用者是負責人或系統管理員（否則 403「只有負責人或系統管理員可以切換提醒」）。看板與紀要頁變更負責人時設回 `true`：關閉是前一位負責人的選擇。

## Implementation Contract

**行為**

- 每天 `REMIND_AT` 後，符合條件的負責人收到一封合併提醒；同一天再跑（重啟、CLI）不會再寄同一事項的同一種提醒。
- 看板事項詳細面板有「Email 提醒」欄：顯示「開啟（到期前 3 天、到期當天、逾期每天寄給負責人）」或「已關閉」，負責人與管理員看到「關閉提醒」／「開啟提醒」按鈕，其他人只看到狀態。沒有負責人或到期日時註明「需要負責人與到期日才會提醒」。卡片上關閉提醒的事項顯示 🔕（title「已關閉 Email 提醒」）。

**介面**

- `GET /api/actions` 每個事項增加 `remind`（bool）。
- `POST /api/actions/{id}/remind` body `{"on": true|false}` → 200 事項（看板格式）；403、404 如上。
- `reminders.run(today: date | None = None) -> dict` 回傳 `{"owners": n, "items": n, "failed": n}`；CLI `python -m reminders run [--today YYYY-MM-DD]` 印出這個結果。
- `reminders.next_run(now: datetime) -> datetime`、`reminders.reminder_kind(due: date, today: date) -> tuple[str, date] | None`。
- 設定 `REMIND_AT`（`HH:MM`，預設 `09:00`）。

**失敗模式**：寄送失敗只寫 app log（`logger.warning`，不含密碼），並撤銷佔位；worker 內任何例外都記錄後繼續下一天，不讓背景工作停止。

**驗收**：`webapp/test_server.py` 的 `ActionReminderTests` 涵蓋 spec 的每個 Scenario 與 Example；`bench/reminders_e2e.mjs` 以 CLI 指定日期執行，在 Mailpit 收到正確主旨與內容，並在看板切換提醒；全部單元測試通過。

**範圍**：只做上述；不改紀要寄送。

## Risks / Trade-offs

- [服務整天沒開] → `soon` 用 1–3 天區間、`due` 在當天任何時間重啟都會補；但那天的 `overdue` 提醒不會補寄（隔天照常寄）。
- [逾期很久的事項每天一封，可能被當成垃圾信] → 負責人可以關閉該事項提醒，或把狀態改成已完成／已取消。
- [多個 app 行程] → 佔位機制保證不重複寄。
