## Context

- 兩個付費的外部服務已經各自記錄用量：`mai_usage (day, purpose, seconds)`（雲端辨識，每小時 `MAI_USD_PER_HOUR` 美元，預設 0.54）與 `interpret_usage (day, purpose, username, seconds)`（即時口譯，每小時 `INTERPRET_USD_PER_HOUR` 美元，預設 2.04）。金額一律是「秒數 × 單價」的估算，不是帳單。
- 目前只有 `/admin`（團隊管理）上的兩張文字卡，讀 `GET /api/admin/mai-usage` 與 `GET /api/admin/interpret-usage`，只有累計數字。雲端辨識的上限是環境變數 `MAI_BUDGET_USD`（預設 50，對累計金額判斷）；即時口譯沒有上限。
- `app_settings (key, value jsonb, updated_by, updated_at)` 已存在（紀錄保存期限在用）。
- 成效指標頁（`/metrics`）已有同一套視覺元件：數字卡 `.tiles/.tile`、圖表卡 `.viz-card`、長條圖與提示框 `.weekly/.viz-tip`、表格 `.data-table`、圖例 `.legend`、「表格」切換鈕，在 webapp/static/metrics.css。
- plain-wording 規格：頁面上不可出現供應商、模型或技術名稱，所以兩個服務在頁面上叫「雲端辨識」「即時口譯」。
- 實測（2026-11-25）：`mai_usage` 5 列（2026-11-14 到 11-16，共 3.05 小時），`interpret_usage` 6 列（2026-11-17 到 11-23，共 0.14 小時）。資料量很小，每次開頁全表彙總即可。

## Goals / Non-Goals

**Goals:**

- 管理者在一頁看到兩個付費服務本月、上月、累計的時數與估算金額，以及每日、每月、依用途、依使用者的明細。
- 管理者在頁面上設定各服務的金額上限，接近或達到時頁面明顯提示。
- 團隊管理頁只留團隊相關的內容；兩頁用同一列分頁互相切換。

**Non-Goals:**

- 不納入文字服務（翻譯、紀要、問答用的文字模型）的用量：這次點名的是雲端辨識與即時口譯，文字服務目前沒有記錄 token 數，要另開一個 change。
- 達到上限不停用任何功能（沿用 mai-usage「Reaching the budget SHALL NOT disable MAI」）。
- 不在頁面上改單價：單價仍由 `MAI_USD_PER_HOUR`、`INTERPRET_USD_PER_HOUR` 決定。改單價會連過去的金額一起重算，容易誤解，維持由主機設定。
- 不在頁面上補登用量：`python -m mai_usage add`、`python -m interpret_usage add` 照舊。
- 不做每月上限、依人或依團隊的上限、寄信通知。
- 不改 `mai_usage`、`interpret_usage` 的記錄方式與資料表；雲端辨識仍不記使用者。
- 不移除 `GET /api/admin/mai-usage`、`GET /api/admin/interpret-usage`（命令列工具與既有測試在用）。

## Decisions

### 管理區是兩個網址加一列分頁連結

`/admin`（團隊管理）與 `/admin/usage`（用量管理）是兩個獨立的 HTML 頁，各自在 `h1` 上方放同一段 `<nav class="section-tabs" aria-label="管理">`，裡面兩個 `<a>`，目前那頁加 `aria-current="page"`。頂端列連結改名「管理」（`href="/admin"`），在兩個網址都標示為目前頁；頭像選單的規則不變（在管理區內不再提供「管理」）。

- 為什麼不用同一頁內用 JS 切換的分頁：兩頁各有網址才能直接連結、重新整理留在原頁、瀏覽器上一頁正常；團隊管理頁的程式也不必跟圖表程式綁在一起。
- 為什麼連結而不是 `role="tablist"`：它們會換頁，是導覽不是頁內分頁；用 `nav` + `aria-current` 才符合實際行為。

### 用量資料用一支彙總 API

`GET /api/admin/usage` 一次回傳頁面需要的全部數字（見 Implementation Contract）。伺服器回秒數，並為「累計、本月、上月」算好金額；每日、每月、依用途、依使用者只回秒數，頁面用該服務的 `usdPerHour` 換算。日期以 `MEETING_TIMEZONE` 的今天為準。

- 為什麼不沿用兩支舊 API 再加參數：頁面要把兩個服務放在同一張圖、同一張月表，一支回傳才能保證兩邊是同一個「今天」。

### 上限存在 app_settings，對累計金額判斷

`app_settings` 的 `usage_budgets` 存 `{"mai": 數字或 null, "interpret": 數字或 null}`。沒有這一列時：`mai` 用 `MAI_BUDGET_USD`（預設 50），`interpret` 為 null（不設上限）。狀態沿用 mai-usage 的規則：累計金額 ≥ 上限為 `over`，≥ 上限的 80% 為 `near`，否則 `ok`；上限為 null 時一律 `ok`。

- 上限仍對「累計」金額判斷，不改成每月：使用者既有的約定是雲端辨識累計超過 50 美元要先知道；每月數字另外用月表與數字卡呈現。累計接近上限時，管理者可以在頁面上調高，這就是「管理」。
- `mai_usage.add()` 記錄檔的 80%／達到上限警告改讀這個設定（null 時不警告）。即時口譯不加記錄檔警告，只在頁面提示。「已警告過」以（狀態、上限）為準：管理者調高上限後，再達到新上限的八成與新上限時各再警告一次（review 提出後加入）。
- `usage_budgets` 裡不是正數的值（有人手動改壞）一律當成不設上限，不讓辨識或頁面出錯。

### 視覺沿用成效指標頁的元件

用量管理頁載入 tokens.css、admin.css、metrics.css、新的 usage.css、topbar.css。數字卡、圖表卡、表格、圖例、提示框、「表格」切換鈕直接用 metrics.css 的類別；usage.css 只放這頁獨有的：分頁列（團隊管理頁也要，所以分頁列樣式放 admin.css）、上限卡與進度條、堆疊長條。

- 每日圖：近 30 天，一天一根堆疊長條，下段雲端辨識（`--series-1`）、上段即時口譯（`--series-2`），單位都是美元所以共用一條 y 軸；兩段之間留 2px 底色間隔，頂端 4px 圓角；圖例兩項；滑鼠停留或鍵盤聚焦某一天顯示日期與兩個服務的金額；「表格」鈕切換成同資料的表格（只列有用量的日子）。全部為 0 時顯示一句「近 30 天沒有用量」，不畫空圖。
- 兩個系列色要用 dataviz 的 `validate_palette.js` 對目前的卡片底色（深色 `#17181b`、淺色 `#ffffff`）檢查，未通過就換成通過的色階。
- 狀態不只靠顏色：上限卡的狀態是「圖示 + 文字」（正常／接近上限／已達上限），進度條另有 `role="meter"` 與文字「1.65 / 50 美元（3%）」。
- 金額一律寫「美元」、兩位小數；時數兩位小數；數字用 `font-variant-numeric: tabular-nums`。

## Implementation Contract

**行為**

- 系統管理員在頂端列看到「管理」；點進去是團隊管理，標題上方有「團隊管理｜用量管理」兩個連結。團隊管理頁不再有兩張用量卡。
- `/admin/usage`：非管理員得到 403 的「沒有權限」頁（與 `/admin` 相同做法，文字改成「管理頁面只開放給系統管理員。」，兩頁共用）。
- 用量管理頁內容由上到下：分頁列、標題與一句說明（金額是估算、不是帳單）、接近或達到上限的提示、四張數字卡、兩張上限卡、每日圖、每月表、依用途表、即時口譯依使用者表。

**介面**

`GET /api/admin/usage`（系統管理員；其他人 403）回傳：

```json
{
  "today": "2026-11-25",
  "month": "2026-11",
  "services": [
    {"key": "mai", "usdPerHour": 0.54, "budgetUsd": 50, "state": "ok",
     "total": {"seconds": 10984.9, "usd": 1.65},
     "month": {"seconds": 0, "usd": 0},
     "previousMonth": {"seconds": 0, "usd": 0},
     "byPurpose": [{"purpose": "quality", "seconds": 5550, "monthSeconds": 0}],
     "byUser": []},
    {"key": "interpret", "usdPerHour": 2.04, "budgetUsd": null, "state": "ok",
     "total": {"seconds": 503.8, "usd": 0.29},
     "month": {"seconds": 503.8, "usd": 0.29},
     "previousMonth": {"seconds": 0, "usd": 0},
     "byPurpose": [{"purpose": "live", "seconds": 374.8, "monthSeconds": 374.8}],
     "byUser": [{"username": "t05313", "seconds": 374.8, "monthSeconds": 374.8}]}
  ],
  "daily": [{"day": "2026-10-27", "mai": 0, "interpret": 0}],
  "months": [{"month": "2026-06", "mai": 0, "interpret": 0}]
}
```

- `services` 固定兩項、順序 `mai`、`interpret`。`usd` = 秒數 / 3600 × 單價，四捨五入到 2 位。秒數四捨五入到 1 位。
- `daily`：30 項，從今天往前 29 天到今天，依日期遞增，值是當天秒數。`months`：6 項，到本月為止，遞增，值是當月秒數。
- `byPurpose`、`byUser`：累計秒數由大到小，同值依名稱；`monthSeconds` 是本月的秒數。`mai` 的 `byUser` 為空陣列。

`PUT /api/admin/usage/budgets`（系統管理員；其他人 403），內容 `{"mai": 數字或 null, "interpret": 數字或 null}`，兩個鍵都要有。數字必須有限、大於 0、不超過 1000000；否則 422，`detail` 為「上限要是大於 0 的金額，留空表示不設上限」。成功回傳存下的 `{"mai": …, "interpret": …}`。

`GET /api/admin/mai-usage` 的 `budgetUsd`、`state` 跟著設定走（`budgetUsd` 可為 null）。

**失敗時**

- 用量 API 讀不到：頁面在提示區顯示「用量暫時讀不到，請稍後再試。」，其餘區塊留空，不顯示 0。
- 儲存上限失敗：在該張上限卡下方顯示伺服器的 `detail`，輸入框保留使用者輸入的值。

**驗收**

- `test_server`：新 API 的數字、權限、上限的預設／儲存／驗證、`mai-usage` 跟著設定走、`/admin/usage` 的 403；plain-wording 的既有測試仍通過。
- `bench/usage_admin_e2e.mjs`（Playwright，攔截 API 回應）：數字卡、上限提示、圖表與表格切換、鍵盤可到每一天、儲存上限送出的內容、兩頁分頁列與頂端列標示、團隊管理頁沒有用量卡、390px 不橫向捲動。
- 改過連結文字的既有瀏覽器測試（ui_review_e2e、ui_consistency_e2e）結果與修改前相同（已知原本就失敗的項目除外）。

**範圍**

- 範圍內：上述兩支 API、用量管理頁、分頁列、頂端列改名、團隊管理頁移除兩張卡、上限設定。
- 範圍外：見 Non-Goals。

## Risks / Trade-offs

- [「團隊管理」改名「管理」後，使用者找不到原本的連結] → 位置不變，點進去第一頁就是團隊管理。
- [累計上限會隨時間必然達到] → 頁面可直接調高；每月金額另外呈現，判斷花費速度不靠上限。
- [改單價（主機設定）會讓過去的金額一起變] → 頁面說明寫明「依目前單價估算」，並顯示單價。
- [金額四捨五入後各列加總與合計差 0.01] → 畫面上的合計一律由畫面上顯示的兩個金額相加（實作時改定，2026-11-25：先前由秒數算，月表合計 1.93 與數字卡 1.94 對不上）；伺服器每個服務的金額仍由秒數算。頁面註明是估算。
