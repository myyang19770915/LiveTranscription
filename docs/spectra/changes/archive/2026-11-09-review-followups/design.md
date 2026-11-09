## Context

回溯 verify／review 的發現（minutes-mail W1–W3、S1；action-reminders W1、S2、S3；UI 變更的 Medium 與 Low 項）。程式位置：`auth.valid_email`、`mailer.send_message`／`deliver`／`recipients`、`reminders.run`／`worker`、`overlay.css`、`actions.js` 的 `reminderField`、`app.js` 的 `subtitleParts`。

## Goals / Non-Goals

**Goals:** 一個成員或一個收件人的問題不影響其他人收信、也不被當成成功；提醒在重啟、失敗、休眠後仍會在當天補寄；字幕框在任何視窗高度都在框內；介面與文件一致。

**Non-Goals:** 改寫既有 spec 的 @trace；並行定稿測試。

## Decisions

### Email 規則採 ASCII 一般地址

`^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$`，長度 ≤ 254。排除引號、逗號、分號、角括號、空白與非 ASCII（公司 SMTP 多半不支援 SMTPUTF8）。`recipients()` 只採用通過 `valid_email` 的已存地址，其餘視為沒有 Email（列入未寄到）。提醒信（`reminders.run`）與團隊群組信箱同樣只採用通過的地址：不合格的負責人不寄提醒，不合格的團隊信箱視為沒有收件人（422）。

### 部分被拒記為失敗

`send_message` 回傳 smtplib 的被拒 dict；`deliver` 在非空時回傳「部分收件人被拒收：addr（code）…」。記錄 `ok=false`，手動寄送回 502「寄送失敗：…」。理由：頁面顯示失敗，主持人才會發現；再寄一次對其他人只是多一封。

### SMTP_TLS 未知值改用 starttls

未知值時 `logger.error` 並採 `starttls`：伺服器不支援時寄送失敗並顯示原因，不會靜默以明文送出帳密。

### deliver 攔所有例外

`except Exception` 記錄 `type(exc).__name__`（非 SMTP／OS 例外只記類別，避免訊息帶出設定值）。

### 提醒佔位以 try/finally 撤銷

`run()` 逐一寄送時以 `finally` 撤銷所有尚未寄出（含當前）負責人的佔位再讓例外往上拋；成功寄出的才保留。

### 排程改為輪詢

`worker()` 每 5 分鐘檢查 `due_now(now, ran_on, retry_at)`：今天已過 `REMIND_AT` 且今天還沒跑過，或有失敗且已到 `retry_at`（失敗後 30 分鐘、僅限同一天）。佔位去重保證重複執行不重寄。不再依賴跨時區相減與長時間 sleep。

### 字級上限 5.5vh

`.overlay-subs[data-size=N]` 改為 `font-size: min(<原值>px, 5.5vh)`，並加 `overflow: hidden`。估算：5 行 × 1.35em ≈ 37vh，加工具列與 padding 約 50px，視窗高 ≥ 385px 時框高 ≤ 50vh；1440×900 下 5.5vh = 49.5px，各段字級不變。

## Implementation Contract

**行為**：如 proposal。**介面**：`mailer.send_message(message) -> dict`（被拒的收件人）；`reminders.due_now(now, ran_on, retry_at) -> bool`；其餘 API 不變。**失敗模式**：部分被拒 → 502 與失敗紀錄；未預期例外 → 失敗紀錄、定稿照常；提醒中斷 → 佔位撤銷、當天或下次補寄。**驗收**：`webapp/test_server.py` 新增測試（地址規則範例表、部分被拒、未知 SMTP_TLS、未預期例外、提醒中斷撤銷、`due_now`）與全套通過；`bench/translate_e2e.mjs`（矮視窗字幕框在半個視窗內、浮動字幕最新段可見）、`bench/reminders_e2e.mjs`、`bench/mail_e2e.mjs` 通過。**範圍**：只做上述。

## Risks / Trade-offs

- [少數合法但罕見的地址（含引號的 local part、IDN 網域）會被拒] → 公司地址不使用這些形式；需要時再放寬。
- [部分被拒時再寄一次，其他人會收到第二封] → 可接受，比沒人知道某人沒收到好。
