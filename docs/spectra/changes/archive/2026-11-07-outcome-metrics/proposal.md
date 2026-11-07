## Why

roadmap 定了閉環會議紀錄的效益指標（待辦關閉率、逾期率、會議結束到確認紀錄的時間、AI 抽取被人工修改或刪除的比例、轉錄修改率），但系統裡沒有地方看得到，團隊無法知道導入後是否真的改善。使用者在檢視 P3 成果後選擇補上這一塊。

## What Changes

- 新增「成效指標」頁（`/metrics`），頁首加連結（手機寬度隱藏）。篩選列：團隊（全部或其一）、期間（近 30 天、近 90 天、近一年）。
- 四個指標卡：待辦完成率、目前逾期率、準時完成率、會後確認紀要時間（中位數），各附計算依據的件數。
- AI 抽取結果：直接採用／修改後採用／駁回／尚未處理的分段長條與表格。
- 每週待辦趨勢：最近 12 週每週新增與完成件數的長條圖（滑過顯示數字、可切換表格）。
- 轉錄修改率：依辨識引擎與語言列出會議數、段落數、修改過的段落比例、每百字修改字數（ASR 原文與校對後文字的編輯距離）。
- 為了分辨「直接採用」與「修改後採用」，紀要條目新增「人工修改過」標記：之後在紀要頁或看板改了內容、類型、負責人、到期日就記下；既有資料視為未修改。

## Non-Goals

- 跨團隊比較排行、個人績效排名。
- 匯出報表、排程寄送。
- 指標的歷史快照（每次都即時計算）。

## Capabilities

### New Capabilities

- `outcome-metrics`: 成效指標頁與 API：各指標的定義、期間與團隊範圍、權限、空資料的呈現。

### Modified Capabilities

（無）

## Impact

- 資料庫：新增 webapp/migrations/009_item_edited.sql（`minute_items.edited`）。
- 後端：新增 webapp/metrics.py（`/metrics` 頁與 `GET /api/metrics`）、webapp/server.py 註冊路由、webapp/minutes.py 與 webapp/actions.py 在修改條目時設定 `edited`。
- 前端：新增 webapp/static/metrics.html、metrics.js、metrics.css；webapp/static/account.js 頁首連結與各 html 版本號；webapp/static/admin.css 手機隱藏。
- 測試：webapp/test_server.py、新增 bench/metrics_e2e.mjs。
