## Context

- 首頁（`webapp/static/index.html`、`webapp/static/app.js`）有「開會／即時翻譯」兩個模式（`setLiveMode()`、`translateOnly()`）。即時翻譯時，瀏覽器把 16 kHz 音訊送 `/ws/transcribe`（`mode: "translate"`），原文由辨識事件的 `displayText` 而來，譯文由瀏覽器分段後呼叫 `/api/translate/stream` 取得；錄音用瀏覽器的 MediaRecorder 存在記憶體，供「會議錄音」下載；伺服器不存任何東西（live-translation「Translate-only sessions」）。
- 浮動字幕與畫面＋字幕都從 `subtitleParts()` 取文字（`window.Subtitles.update`、`window.Overlay.update`）。
- 即時口譯（`webapp/interpret.py`、`webapp/static/interpret.js`）目前只給系統管理員，`/interpret` 頁同時負責口譯操作與「我的紀錄」。紀錄存在 `output/interpret/<username>/<id>/`，邊收邊寫（interpret-long-sessions）。
- 用量表 `interpret_usage (day, purpose, seconds)` 沒有使用者欄位。
- `/ws/transcribe` 的 `quality_pass.TeeReceiver` 可以在不改兩個辨識引擎的情況下取得每段送出的音訊。

## Goals / Non-Goals

**Goals:**

- 首頁第三個模式「即時口譯」，畫面、字幕工具都用口譯的文字。
- 管理員逐一開放口譯權限；沒有權限的人看得到但不能用。
- 即時翻譯與即時口譯都存成本人紀錄；`/interpret` 改成「我的紀錄」頁。
- 口譯用量依使用者記錄。

**Non-Goals:**

- 依人或依團隊的保存期限、用量上限、依團隊開放。
- 開會模式加口譯。
- 改動 `lab/realtime-translate`。

## Decisions

### 權限：逐一開放帳號

新表 `interpret_access (username PRIMARY KEY, granted_by, granted_at)`（`webapp/migrations/020_interpret_access.sql`）。`interpret.allowed(user)`：系統管理員或在表內。
- `GET /api/admin/interpret-access`（列表）、`POST /api/admin/interpret-access {"username"}`、`DELETE /api/admin/interpret-access/<username>`，只限系統管理員；帳號比照團隊成員：轉小寫、`^[a-z0-9_][a-z0-9._-]{0,63}$`，不合格回 422。
- `/ws/interpret` 對沒有權限的人以 4403 關閉（訊息「即時口譯需要申請權限，請聯絡系統管理員」），在連外部服務之前；途中的定時重新檢查改用 `allowed()`，被移除權限時以 4403 停止並存檔。
- `/api/interpret/config` 對每位登入者回傳 `configured`、`allowed`、`usdPerHour`、`targets`；其他 `/api/interpret/*` 只要登入（紀錄 API 只碰本人的資料）。

替代方案「依團隊開放」：使用者選擇逐一開放，捨棄。

### 用量依使用者

migration 020 一併為 `interpret_usage` 加 `username text NOT NULL DEFAULT ''`，主鍵改為 `(day, purpose, username)`；舊資料 username 為空字串，在畫面上顯示為「（未記名）」。口譯結束時以本人帳號記錄。`GET /api/admin/interpret-usage` 多回 `byUser`（`{username: seconds}`），團隊管理頁卡片列出每人小時與金額。

### 首頁的即時口譯模式

- `#modeRow` 加 `#modeInterpret`。頁面讀 `/api/interpret/config`：`allowed` 為假時按鈕停用，模式說明為「需要申請權限，請聯絡系統管理員」；`configured` 為假時停用並說明「即時口譯尚未設定，請聯絡系統管理員」。記住的模式是 interpret 但現在不能用時，回到即時翻譯。
- 口譯模式的版面沿用即時翻譯（隱藏團隊、主題、系列），另外：隱藏雲端精修、精準模式；語言列「中日雙向」不可選、交換方向停用；翻譯目標選單換成 `/api/interpret/config` 的 58 種語言（顯示中文名稱）；加「同步播放譯音」勾選（沿用 `yq-interpret-play` 記憶）。開始按鈕為「開始口譯」。
- 口譯的連線、播放與文字處理放在新檔 `webapp/static/interpret-mode.js`（`window.InterpretMode`），`app.js` 只在模式切換、開始、結束、送音訊與字幕取文字時呼叫它，避免 `app.js` 再變大。
- 音訊：首頁既有的擷取流程照舊（麥克風／分頁／混合），每塊音訊除了轉成 16 kHz 送 `/ws/transcribe`（`mode: "interpret"`），也轉成 24 kHz 送 `/ws/interpret`。
- 文字：口譯模式不呼叫 `/api/translate/stream`。原始逐字稿欄照舊顯示辨識原文；翻譯欄顯示 `/ws/interpret` 的 `out` 文字。原文的變動以 `{"type":"source","keep","text"}` 交給 `/ws/interpret`。
- 字幕：`subtitleParts()` 在口譯模式回傳：`translation` 為口譯文字的最後兩句（`Subtitles.sentences`），`draft` 為最後一句之後還沒結束的部分，`done`／`pending` 仍是辨識原文。浮動字幕與畫面＋字幕因此不必改。
- 結束：照 `/ws/interpret` 的收尾流程；伺服器回報 `saved` 時，頁面顯示「已存檔」與「在我的紀錄開啟」連結（`/interpret?id=<id>`）。匯出逐字稿匯出原文與譯文。

### `/ws/transcribe` 的 `mode: "interpret"`

跟 `translate` 一樣不需要 `meeting_id`、不建立會議；不存任何檔案（口譯紀錄由 `/ws/interpret` 存）。MAI 用量照舊記為 `live`。

### 即時翻譯也存成紀錄

這是使用者明確要求的改變：live-translation 原本規定即時翻譯「不在伺服器存任何東西」，改為存成本人紀錄。
- `/ws/transcribe` 的 `mode: "translate"`：用 `TeeReceiver` 把送出的 16 kHz 音訊邊收邊寫到 `output/interpret/<username>/.recording-…/input.wav`，並記住最後一次送給瀏覽器的 `displayText` 當原文。連線結束時，若有音訊，寫 `session.json`（`kind: "translate"`、`sourceLang`、`target`、`engine`、`inputSeconds`、`sourceText`、`translation: ""`、`usd: 0`）、`bars.json`（只有 `input`）、`transcript.txt`，改名成紀錄編號，並在關閉前送 `{"saved": <id>}` 給瀏覽器。
- 譯文是瀏覽器產生的，進行中每 30 秒送一次（使用者決定，避免分頁中途關閉時譯文全部遺失）：
  - 連線開始、第一段音訊寫入暫存資料夾時，伺服器送 `{"record": <token>}`（隨機 16 位十六進位，只在這條連線有效）。
  - 頁面每 30 秒、譯文有變動時送 `PUT /api/interpret/live/<token>/translation {"text"}`（只限本人、最多 200000 字），伺服器把它記在進行中的紀錄；token 不存在或不屬於本人回 404。
  - 連線結束存檔時，紀錄的 `translation` 是最後收到的譯文。
  - 頁面收到 `saved` 後再送一次 `PUT /api/interpret/sessions/<id>/translation {"text"}`（只限本人、只限 `kind: "translate"`）補上最後 30 秒；送不出去時提示「譯文沒有存到紀錄，可以先匯出」。
- 頁面上的「不存到伺服器」說明改為「存成你的紀錄，只有你看得到」。瀏覽器端錄音與匯出照舊。
- 口譯紀錄的 `session.json` 加 `kind: "interpret"`；舊紀錄沒有 `kind` 時視為 interpret。

替代方案「結束時由瀏覽器上傳整份錄音與文字」：分頁關閉或斷線就全部遺失，捨棄。

### `/interpret` 改成「我的紀錄」頁

- 每位登入者都能開，標題「我的紀錄」；移除口譯操作（連線、設定、即時波形），保留紀錄列表、載入、波形重播（三種模式、拖曳）、下載、刪除。
- 列表多一欄「類型」（即時翻譯／即時口譯）。即時翻譯紀錄沒有譯音：只聽譯音與播放整段停用、只能只聽原音，「譯音」下載不顯示；`bars` 只回 `input`。
- `?id=<id>` 開啟時直接載入該筆。
- 首頁頂端列加「我的紀錄」連結；團隊管理頁原本指向 `/interpret` 的「即時口譯」連結移除，改由「即時口譯權限」區塊說明口譯在首頁使用。

### 保存期限

- 新表 `app_settings (key PRIMARY KEY, value jsonb, updated_by, updated_at)`（同一個 migration 020），鍵 `records_retention_days`，沒有設定時為 90。
- `GET /api/admin/records-retention` 回 `{"days"}`；`PUT` 以 `{"days"}` 修改，只限系統管理員，`days` 必須是 1 到 3650 的整數，否則 422；記下修改者。
- 新模組 `webapp/records_retention.py`：`sweep()` 刪除 `output/interpret/*/` 底下編號日期（`YYYYMMDD`，`MEETING_TIMEZONE`）早於「今天 − 天數」的紀錄資料夾，以及超過 1 天的 `.recording-*` 暫存資料夾（伺服器中途停止留下的）。伺服器啟動時執行一次，之後每 6 小時一次（`lifespan` 的背景工作）；改天數後立即執行一次。刪除寫一行日誌（筆數），不記內容。
- 團隊管理頁加「紀錄保存期限」：顯示天數、可修改、說明「即時翻譯與即時口譯紀錄超過天數會自動刪除」。「我的紀錄」頁說明「紀錄保存 N 天，到期自動刪除」（`/api/interpret/config` 多回 `retentionDays`）。

替代方案「每次列紀錄時順便刪」：沒人打開頁面就不會刪，捨棄。

### 隱私標示

即時口譯模式時標示為「雲端口譯」與「音訊會傳送到外部服務」，不受辨識引擎與雲端精修影響。

## Implementation Contract

- **行為：**
  - 有權限的人在首頁切到即時口譯、按開始口譯：原文出現在原始逐字稿欄、譯文出現在翻譯欄並可聽到譯音；浮動字幕、畫面＋字幕顯示譯文；中斷後存成紀錄，首頁出現「已存檔」與開啟連結。
  - 沒有權限的人看得到停用的按鈕與說明；直接連 `/ws/interpret` 得到 4403。
  - 即時翻譯結束後出現在本人的「我的紀錄」，含原音、原文、譯文。
- **介面：**
  - 新增 `/api/admin/interpret-access`（GET、POST、DELETE）。
  - 新增 `PUT /api/interpret/sessions/<id>/translation`、`PUT /api/interpret/live/<token>/translation`。
  - 新增 `GET`／`PUT /api/admin/records-retention`；`/api/interpret/config` 多 `retentionDays`。
  - `/ws/transcribe` 的 `mode: "translate"` 開始寫入時送 `{"record": <token>}`。
  - `/api/interpret/config` 多了 `allowed`，並開放給所有登入者。
  - `/api/admin/interpret-usage` 多了 `byUser`。
  - `/ws/transcribe` 多了 `mode: "interpret"`；`mode: "translate"` 結束時送 `{"saved": <id>}`。
  - `session.json` 多了 `kind`。
- **失敗情況：**
  - 沒有權限或未設定時不連外部服務。
  - 存檔失敗時告知「存檔失敗」，用量照記。
  - 譯文 PUT 失敗時提示可以先匯出；進行中的 PUT 失敗只在下一次重試，不打斷翻譯。
  - 保存天數不合格回 422；清理時個別資料夾刪除失敗只記日誌，不影響其他資料夾。
  - 權限被收回時，口譯在下一次重新檢查時停止並存檔。
- **驗收：**
  - `test_server` 新增：權限 API 與 4403、途中收回權限、`config.allowed`、每人用量、translate 模式存檔與 `record`／`saved` 事件、進行中與結束後譯文 PUT 的權限與限制、保存天數 API 與清理（範例表）、interpret 模式不存檔、紀錄頁對一般成員開放且只看本人的。
  - `bench/interpret_e2e.mjs` 改為從首頁操作口譯模式（含停用狀態、字幕顯示口譯文字、已存檔連結）與紀錄頁重播。
  - `bench/translate_e2e.mjs` 改期望（即時翻譯存檔、`saved` 後送出譯文）。
  - `bench/privacy_e2e.mjs` 加口譯模式。
  - `PlainWordingTests` 通過。
- **範圍：** 見 proposal 的 Affected code；`lab/` 與開會模式不改。

## Risks / Trade-offs

- 每位使用者的即時翻譯都存原音：16 kHz 單聲道每小時約 115 MB（計算值：16000 × 2 × 3600 位元組）。保存 90 天時，每位常用的人最多約 90 × 每日小時數 × 115 MB（估計，依實際使用時數而定；可用 `du -sh output/interpret` 每週觀察）。
- 口譯模式同時開兩條連線（辨識與口譯）並做兩次重新取樣，舊電腦的 CPU 負擔較高（估計，未量測；可在口譯模式下看瀏覽器工作管理員的 CPU 確認）。
- 即時翻譯的譯文每 30 秒送一次：分頁中途關閉時，紀錄最多少最後 30 秒的譯文。
