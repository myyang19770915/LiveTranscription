## Context

紀要（`meeting-minutes`）的條目逐條確認，沒有「整份定稿」的動作；匯出只有 `GET /api/meetings/{id}/minutes.md`（`minutes.markdown()` 只取已確認條目）。`users` 表只有 `username`、`display_name`；LDAP 登入（`auth.ldap_authenticate`）只讀顯示名稱。團隊設定目前只有名稱與成員，由管理員在 `/admin` 管理。`action-tracking` 把「通知（Email、即時推播）」列為 P5 範圍，本變更是 P5 ②。

使用者決定（2026-11-09）：自動寄送在新增的「定稿」按鈕觸發；團隊寄送設定由團隊任何成員修改；開發測試用 Mailpit。

## Goals / Non-Goals

**Goals:**

- 成員有 Email：LDAP 帶入為主，沒有時自填。
- 團隊可選擇寄到個人信箱或團隊群組信箱、可開自動寄送；紀要可定稿、可手動寄送或再寄一次。
- 寄送結果看得到（成功、失敗原因、未寄到的成員），自動寄送不重複。

**Non-Goals:**

- 待辦提醒信（`action-reminders`）、其他通知管道、附件、範本自訂、與會者名單、外部平台同步。
- 背景重試佇列：寄送失敗直接回報，由使用者按「再寄一次」。

## Decisions

### 寄送用標準函式庫 smtplib，在執行緒中同步寄出

`mailer.send_message(message)` 以 `smtplib.SMTP`／`SMTP_SSL`（依 `SMTP_TLS`）連線、需要時 `starttls()` 與 `login()`，逾時 15 秒，以 `asyncio.to_thread` 呼叫。測試以 patch 取代這個函式。替代方案 aiosmtplib 需要新套件且只省一個執行緒，不採用。請求內同步寄出，使用者立刻知道成功或失敗；不做背景佇列。

### Email 存在 users，記錄來源

`users.email text`、`users.email_source text CHECK (email_source IN ('ldap','self'))`。登入時 LDAP 有值 → 寫入並設 `ldap`；LDAP 沒值而原本來源是 `ldap` → 清空（離職或改設定的人不保留舊值）；原本是 `self` → 保留。`PUT /api/me/email` 只在來源不是 `ldap` 時允許。`ldap_authenticate` 改回傳 `Profile(display_name, email)` 或 `None`，搜尋時同時要求 `LDAP_DISPLAY_ATTR` 與 `LDAP_MAIL_ATTR`。

### 團隊寄送設定放在 teams 表

`teams.mail_target text NOT NULL DEFAULT 'members' CHECK IN ('members','team')`、`teams.mail_address text NOT NULL DEFAULT ''`、`teams.mail_auto boolean NOT NULL DEFAULT false`。設定一個團隊只有一份，不另開表。`PUT /api/teams/{team_id}/mail` 限該團隊成員（管理員不在團隊也可改，與其他團隊資料的管理員權限一致）。

### 定稿記在 minutes，自動寄送以寄送紀錄去重

`minutes.finalized_at timestamptz`、`minutes.finalized_by text`。`POST /api/meetings/{id}/minutes/finalize`：未定稿才寫入；團隊 `mail_auto` 開且這場會議還沒有任何 `trigger='auto'` 的寄送紀錄時寄出。重複按定稿不會再寄（已定稿時回傳目前狀態）。手動寄送 `POST /api/meetings/{id}/minutes/send` 不受定稿限制，但至少要有摘要或一條已確認條目。

### 寄送紀錄表 minutes_mail

`minutes_mail(id bigserial, meeting_id uuid FK CASCADE, trigger text CHECK IN ('auto','manual'), recipients text[], skipped text[], sent_by text, sent_at timestamptz default now(), ok boolean, error text default '')`。`skipped` 是沒有 Email 而沒寄到的成員帳號。紀要 API 帶出最近一筆。

### 收件人規則

`members`：團隊成員中有 Email 的人放在同一封信的 To；沒有 Email 的列入 `skipped`。`team`：只寄 `mail_address`。收件人為空時不連 SMTP，回 422「沒有可寄送的收件人」。

### 信件內容

主旨 `[語橋 Live] 會議紀要：<會議標題>`（標題去掉換行）。純文字部分沿用 `minutes.markdown()` 再加連結；HTML 部分由同樣資料組成，所有文字以 `html.escape` 處理。連結 `PUBLIC_BASE_URL + /meetings/<id>/minutes`；沒設定 `PUBLIC_BASE_URL` 時不放連結。寄件人 `SMTP_FROM`（未設時用 `SMTP_USER`）。

### Mailpit 只在 dev-mail profile

`dev-mail` 服務 `axllent/mailpit:v1.27.0`，SMTP 1025 只在 Compose 網路內，網頁信箱綁 `127.0.0.1:18025`。開發 `.env` 設 `SMTP_HOST=dev-mail`、`SMTP_PORT=1025`、`SMTP_TLS=none`。

## Implementation Contract

**行為**

- 帳號選單出現「我的 Email」：顯示目前 Email 與來源；來源為 LDAP 時唯讀並註明「由公司目錄提供」；否則可填寫、儲存、清除。
- 紀要頁標題列旁新增寄送區塊：「定稿」按鈕（已定稿時改為顯示「已定稿 · 時間 · 人」）、「寄送紀要」／「再寄一次」按鈕、最近一次寄送摘要、「寄送設定」展開表單（收件對象單選、團隊信箱輸入、自動寄送勾選、儲存）。SMTP 未設定時兩個寄送相關按鈕停用並顯示「尚未設定寄信伺服器（SMTP_HOST）」，定稿仍可用。

**介面**

- `GET /api/me` 增加 `email`（字串或 null）、`emailSource`（`ldap`／`self`／null）。
- `PUT /api/me/email` body `{"email": "a@b.c" | ""}` → 200 `{"email","emailSource"}`；LDAP 來源 → 409「Email 由公司目錄提供，無法修改」；格式不符 → 422「Email 格式不正確」。格式：去空白後長度 ≤ 254，符合 `^[^@\s]+@[^@\s]+\.[^@\s]+$`。
- `GET /api/meetings/{id}/minutes` 增加 `finalizedAt`、`finalizedBy`（顯示名稱）、`mail`：`{"configured": bool, "teamId", "target", "address", "auto", "recipients": n, "missing": [顯示名稱], "last": {"trigger","sentAt","sentBy","recipients": n,"skipped": [顯示名稱],"ok","error"} | null}`。
- `PUT /api/teams/{team_id}/mail` body `{"target":"members"|"team","address":"","auto":bool}` → 200 設定；非成員且非管理員 → 403；`target=team` 而地址空白或格式不符 → 422。
- `POST /api/meetings/{id}/minutes/finalize` → 200 紀要 payload（含 `mail.last`）；自動寄送失敗時仍定稿，`mail.last.ok=false` 並附錯誤。
- `POST /api/meetings/{id}/minutes/send` → 200 `{"last": …}`；SMTP 未設定 → 503「尚未設定寄信伺服器」；沒有內容 → 422「紀要還沒有內容可寄送」；無收件人 → 422「沒有可寄送的收件人」；SMTP 失敗 → 502「寄送失敗：<例外類別與訊息>」並寫入失敗紀錄。

**失敗模式**：SMTP 錯誤訊息不含密碼（`smtplib` 例外本身不含；記錄時只存 `type(exc).__name__: str(exc)`，截斷 300 字）。

**驗收**：`webapp/test_server.py` 新增 `MinutesMailTests` 與 LDAP Email 測試全部通過；`bench/mail_e2e.mjs` 在 Mailpit 收到正確主旨、收件人與內容；現有測試不退步。

**範圍**：只做上述；不改看板、不寄提醒。

## Risks / Trade-offs

- [寄送在請求內同步進行，SMTP 慢時按鈕等待最長 15 秒] → 按鈕顯示「寄送中…」並停用；逾時記為失敗。
- [「成員個人信箱」把整個團隊放在 To，成員看得到彼此地址] → 同公司團隊可接受；需要隱藏時改用團隊群組信箱。
- [自填 Email 未驗證] → 只能填自己的；錯誤地址的後果是自己收不到。
