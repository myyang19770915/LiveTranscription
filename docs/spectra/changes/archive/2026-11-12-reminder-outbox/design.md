## Context

`webapp/reminders.py` 的 `run()` 先以 `claim()` 對每則提醒 `INSERT … ON CONFLICT DO NOTHING` 到 `reminder_log`（主鍵 `(item_id, kind, day)`，`sent_at NOT NULL DEFAULT now()`），寄給每位負責人；失敗時以 `release()` 刪除佔位，一般中斷由 `finally` 撤銷尚未寄出者的佔位（既有決定 `review-followups` / 「提醒佔位以 try/finally 撤銷」）。程序被強制結束時 `finally` 不會執行。`worker()` 只在 `run()` 回報 `failed` 時排 30 分鐘後重試。`reminder_log` 只被 `reminders.py` 與測試使用。

## Goals / Non-Goals

**Goals:** 程序被殺掉時留下的佔位，之後會被接手寄出；正常流程與既有測試行為不變。

**Non-Goals:** SMTP 已接受但未記錄 `sent_at` 的極短窗口造成的偶發重寄；提醒規則本身。

## Decisions

### 佔位與寄出分成兩個欄位

Migration `016_reminder_claims.sql`：`sent_at` 去掉 `NOT NULL` 與預設值，新增 `claimed_at timestamptz NOT NULL DEFAULT now()`，既有資料的 `claimed_at` 設為其 `sent_at`（舊資料都已寄出）。

替代方案：另開 outbox 表 → 多一張表與搬移，但只需要一個「是否已寄出」的狀態，不採用。

### 逾時 10 分鐘的佔位可被接手

`claim()` 改為：

```sql
INSERT INTO reminder_log (item_id, kind, day, owner, due_date) VALUES (…)
ON CONFLICT (item_id, kind, day) DO UPDATE SET claimed_at = now(), owner = excluded.owner, due_date = excluded.due_date
WHERE reminder_log.sent_at IS NULL AND reminder_log.claimed_at < now() - interval '10 minutes'
RETURNING item_id
```

有回傳就是這次取得佔位。沒有回傳時，再查一次該鍵：`sent_at` 為空代表別的執行還在處理（未滿 10 分鐘），計入 `pending`；已有 `sent_at` 就是已寄出，略過。10 分鐘遠大於一次寄送的時間（每封 SMTP 逾時 15 秒，負責人數十位內）。這是依目前規模的推估，若負責人很多、寄送超過 10 分鐘，可能有兩次執行重複寄同一位；以 log 中每次執行的耗時確認。

### 排程也接手手動執行留下的佔位

`worker()` 每 5 分鐘檢查時，除了 `due_now`，也查 `stale_claims()`：有 `sent_at` 為空、`claimed_at` 超過 10 分鐘、`day` 為今天或之後的佔位就執行一次（以 `should_run()` 判斷，而且要等當天 `REMIND_AT` 之後，因為這次執行會寄出當天的提醒），涵蓋被殺掉的手動執行（`python -m reminders run`）。`run()` 在取得佔位後刪除仍逾時未寄、沒人接手的佔位（該事項已完成、取消或關閉提醒），避免排程因它們一直重跑。`claim()` 衝突後查不到該列時（另一個執行剛好撤銷）視為 `pending`，不當成已寄出。

### 寄出後才寫入 sent_at，pending 也觸發重試

`mailer.deliver` 成功後，`UPDATE reminder_log SET sent_at = now()` 標記該負責人的所有佔位。`run()` 的結果多一個 `pending` 計數；`worker()` 在 `failed` 或 `pending` 時都排 30 分鐘後重試。`release()` 不變（刪除佔位）。

## Implementation Contract

**行為**
- 寄出成功：佔位的 `sent_at` 寫入時間；同日再次執行不重寄（既有）。
- 寄送失敗或一般中斷：佔位被刪除，下次執行重寄（既有）。
- 程序被殺掉：佔位留著、`sent_at` 為空；10 分鐘內的執行略過並回報 `pending`，30 分鐘後重試時接手寄出。

**介面**
- `run()` 回傳 `{"owners", "items", "failed", "pending"}`；`python -m reminders run` 印出同樣內容。

**驗收**
- `webapp/test_server.py` 的 `ActionReminderTests`：
  - 新增「被殺掉的執行」測試：直接呼叫 `claim()` 留下佔位（模擬被殺），立即執行 → 不寄、`pending` 為 1；把 `claimed_at` 改成 11 分鐘前再執行 → 寄出、`sent_at` 有值。
  - 新增：已寄出（`sent_at` 有值）的佔位即使 `claimed_at` 很舊也不重寄。
  - 規格範例「claims seen by a later run」三列逐列斷言。
  - 既有測試的 `run()` 結果加上 `"pending": 0`，其餘不變。
- `worker` 的重試條件以單元測試涵蓋（`pending` 時設定 `retry_at`）。

**範圍**：`webapp/reminders.py`、migration、測試、README 中 `python -m reminders run` 的輸出說明（若有提到）。範圍外：提醒內容、時機、看板。

## Risks / Trade-offs

- [SMTP 接受後、寫入 `sent_at` 前被殺 → 10 分鐘後重寄一次] → 機率極低，重複一封提醒的代價遠小於漏寄。
- [migration 對既有資料的影響] → 只放寬欄位與新增有預設值的欄位，既有列的 `claimed_at` 以 `sent_at` 回填，不改主鍵。
