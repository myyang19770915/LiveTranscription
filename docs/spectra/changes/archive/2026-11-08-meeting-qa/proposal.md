## Why

全文搜尋只能找「確切講過的字」：問「上次跟客戶談價格的結論是什麼」時，原文可能寫的是「報價先壓在八五折」，關鍵字找不到。roadmap P4 ② 要讓使用者用一句話問，系統從所屬團隊的會議裡找出依據並回答，而且每句都附出處、找不到就直說。

## What Changes

- **基礎設施**：db 映像由 `postgres:17` 換成 `pgvector/pgvector:0.8.7-pg17-trixie`（同為 PostgreSQL 17、同為 Debian trixie，既有資料目錄直接沿用）；新增 `embed` 服務，用 llama.cpp 的 CPU 版 server 跑多語 embedding 模型（`EMBED_MODEL_REPO`／`EMBED_MODEL_FILE` 可換，預設依評測結果決定）。app 不硬性依賴 embed：embed 停掉時問答退回只用關鍵字，並在頁面註明。
- **索引**：新增 migration 011（`vector` extension 與段落向量表）。app 在背景把逐字稿段落（含前後各一段當上下文）與紀要條目（待確認與已確認）轉成向量；內容被校對修改後自動重算，換模型時全部重建。
- **問答 API**：`POST /api/ask` 依問題做混合檢索：關鍵字（問題切成英數詞與中文雙字詞，依命中數排序）＋向量（餘弦距離），以 RRF 合併取前幾筆，交給紀要模型回答；回答每句以 [n] 標示出處，沒有依據時回「找不到」。只會用到使用者所屬團隊的資料，可依團隊、系列、日期篩選。`GET /api/ask/status` 回報索引進度與 embed 是否可用。
- **問答頁**：`/ask`，與 `/search` 之間有切換；回答中的 [n] 連到下方出處清單，出處可直接開到逐字稿那一段（可播放）或紀要那一條；載入狀態、找不到、模型未設定、只用關鍵字等狀態都有清楚提示，並遵守既有的無障礙寫法。
- **評測**：`bench/qa_eval.py` 與一組擬真的會議逐字稿與問題（含換句話說、跨語言、刻意無解的問題），在獨立的評測資料庫量測關鍵字、向量、混合三種檢索的 recall@5／recall@10／MRR，並可選擇實際呼叫模型檢查出處與「找不到」。用它比較候選 embedding 模型並決定預設；評測結果寫入 docs/roadmap.md。Rerank 不在這次範圍，評測顯示排序不足時再加。

## Capabilities

### New Capabilities

- `meeting-qa`: 以自然語言問所屬團隊的會議內容，混合檢索後由模型回答並附出處。

### Modified Capabilities

（無）

## Impact

- Affected specs: meeting-qa（新增）
- Affected code: compose.yaml, .env.example, webapp/migrations/011_qa.sql, webapp/qa.py, webapp/search.py, webapp/server.py, webapp/static/ask.html, webapp/static/ask.js, webapp/static/ask.css, webapp/static/search.html, webapp/static/search.css, webapp/test_server.py, bench/qa_eval.py, bench/qa_eval_data.json, bench/qa_e2e.mjs, bench/README.md, README.md, docs/roadmap.md
- 部署：重建 db 容器（資料保留）、第一次啟動 embed 會下載模型（數百 MB 到約 1 GB）；索引在背景補齊。
