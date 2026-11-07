## Context

需要的資料大多已存在：`minute_items`（`origin`、`state`、`status`、`status_at`、`due_date`、`confirmed_at`、`team_id`）、`meetings`（`started_at`、`ended_at`、`engine`、`language`、`team_id`）、`segments`（`asr_text` 為辨識原文且不再變動、`source` 為校對後文字）。缺的只有「AI 條目是否被人工改過」：`version` 在確認與改狀態時也會增加，無法分辨。

## Goals / Non-Goals

**Goals:**

- 一頁看到 roadmap 列的效益指標，可依團隊與期間切換，數字都能追溯到件數。

**Non-Goals:**

- 排行、匯出、寄送、歷史快照。

## Decisions

### 即時計算，不存快照

資料量小（每團隊每年數百場會議、數千條目，估計值；以 `SELECT count(*)` 確認），每次請求以 SQL 彙總即可；轉錄編輯距離在 Python 計算，只取期間內會議的段落。若之後變慢再加快取。

### 指標定義（期間 = 最近 N 天，以 MEETING_TIMEZONE 的日期計）

- 待辦完成率 = 期間內建立（`confirmed_at`）的已確認待辦中，目前為已完成的比例；分母不含已取消。
- 目前逾期率 = 現在未完成（未開始、進行中）且有到期日的待辦中，已逾期的比例（不受期間影響，是目前狀況）。
- 準時完成率 = 期間內完成（`status='done'` 且 `status_at` 在期間內）且有到期日的待辦中，完成日 ≤ 到期日的比例。
- 會後確認紀要時間 = 期間內結束（`ended_at`）且至少有一條已確認條目的會議，從結束到第一條條目確認（`confirmed_at` 最早者）的時間中位數。
- AI 抽取 = 期間內開始的會議中 `origin='ai'` 的條目：已確認且未修改（直接採用）、已確認且修改過（修改後採用）、駁回、尚未處理（proposed）。
- 轉錄修改率 = 期間內開始的會議的段落，依 `engine`、`language` 分組：修改過的段落比例（`asr_text <> source`），每百字修改字數 = Σ編輯距離(`asr_text`, `source`) ÷ Σ`asr_text` 字數 × 100。
- 每週趨勢 = 最近 12 週（週一起算），每週建立與完成的待辦件數。

### 「人工修改過」標記

`minute_items.edited boolean NOT NULL DEFAULT false`。紀要頁 `change_item` 與看板 `change_action` 在類型、內容、負責人、到期日、到期原話任一實際改變時設為 true。只看「確認時是否改過」需要更多歷史，這裡取「曾被人工改過」即可，既有資料一律視為未改並在頁面註明「自此版本起統計」。

### 圖表不用外部套件

依 dataviz 指引：指標卡（label、value、件數說明），AI 分段長條（高 28px、各段印比例、圖例、表格），每週分組長條圖（SVG、兩個系列：新增＝類別色 1、完成＝類別色 2，經 validate_palette 驗證淺色 `#fffefb`、深色 `#121715` 底色皆通過；4px 圓角、2px 間隔、滑過顯示當週數字、可切換表格）。第三色（駁回用的 aqua）在淺色對比 2.79 低於 3:1，依指引以表格檢視作為補充：每段放得下（占比 ≥ 12%）就印比例，表格與滑過提示一定有全部數字。

## Implementation Contract

**API**：`GET /api/metrics?team=&days=`（已登入；`days` ∈ {30, 90, 365}，預設 30，其他值 422；`team` 為使用者所屬團隊之一，否則 404；未給則為使用者所有團隊）→

```
{days, from, to, teams:[{id,name}],
 actions:{created, done, cancelled, completionRate, open, openWithDue, overdue, overdueRate, finishedWithDue, onTime, onTimeRate},
 minutesLag:{meetings, medianHours},
 ai:{adopted, edited, rejected, pending},
 weekly:[{week:"YYYY-MM-DD", created, done}] (12 筆，由舊到新),
 transcript:[{engine, language, meetings, segments, editedSegments, chars, editedChars, per100}],
 editedSince}
```

比例為 0–1 的小數，分母為 0 時為 `null`（頁面顯示「—」與「資料不足」）。`editedSince` 為 migration 009 套用的時間。

**頁面**：`/metrics`；篩選寫入網址（`?team=&days=`）；空資料時各區塊顯示說明而不是 0%。頁首「成效指標」連結在 `/metrics` 以外的頁面出現，640px 以下隱藏；即時會議頁（index.html）頁首按鈕較多，900px 以下就隱藏。

**驗收**

- 單元測試 `MetricsTests`：以固定今天與建立的資料驗證每個指標的數值（含分母為 0 為 null、已取消不計入完成率分母、逾期與準時的邊界、編輯距離、週別分組）；非成員團隊 404；`days` 非法 422；修改條目後 `edited` 為 true，只改狀態不會。
- bench/metrics_e2e.mjs：頁面載入四張指標卡、AI 分段長條與表格、每週長條圖（滑過出現提示、切換表格）、轉錄表格；切換期間網址更新；400px 無橫向捲動。

**範圍**：只讀取既有資料與新增 `edited`；不改既有頁面行為（只加頁首連結）。

## Risks / Trade-offs

- 「修改後採用」只從此版本起準確 → 頁面註明統計起點。
- 編輯距離為純 Python 計算，放在 `asyncio.to_thread` 執行，且只讀取有修改的段落文字，避免長期間的請求卡住同一程序內的即時轉錄。
- 編輯距離以字元計，對中日文合理、對英文偏高 → 依語言分組呈現，不跨語言比較。
