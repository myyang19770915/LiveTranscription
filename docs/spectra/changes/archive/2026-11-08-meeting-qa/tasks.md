## 1. 基礎設施

- [x] 1.1 備份資料庫（`pg_dump` 到 output/backups/，不進版控），compose.yaml 的 db 改用 `pgvector/pgvector:0.8.7-pg17-trixie` 並重建 db 容器；新增 `embed` 服務（llama.cpp CPU server、`--embeddings`、模型 volume、healthcheck）與 app 的 `EMBED_URL`／`EMBED_MODEL_FILE` 環境變數；.env.example 補 `EMBED_*` 說明。驗證：db 重建後既有會議數與段落數不變、`CREATE EXTENSION vector` 可用；`curl http://localhost:<port>/v1/embeddings` 在 embed 容器內回傳向量。（設計：db 映像固定為 pgvector 0.8.7、Debian trixie；Embedding 跑在獨立的 llama.cpp CPU 服務）

## 2. 索引

- [x] 2.1 新增 webapp/migrations/011_qa.sql（`vector` extension、`passage_vectors` 表與唯一索引）與 webapp/qa.py 的文件文字組法（SQL 視窗函式）、待算查詢、`embed()` 呼叫、`index_pending()` 與背景迴圈；webapp/server.py lifespan 啟動背景迴圈；`GET /api/ask/status` [after: 1.1]。驗證：webapp/test_server.py `QaIndexTests`（以假 embed）驗證首次全部建立、修改段落 5 只重算 4–6、刪除會議連動刪除、換模型後重算且 status 數字正確、被駁回條目不建立、embed 失敗不影響其他功能。（Passage index；設計：向量表與背景索引）

## 3. 問答 API

- [x] 3.1 webapp/search.py 抽出 `scope()`（所屬團隊、團隊、系列、日期條件），搜尋改用它且行為不變；webapp/qa.py 新增關鍵字詞切分、關鍵字與向量檢索、RRF 合併、送模型的訊息、回覆解析與引用檢查、`POST /api/ask` [after: 2.1]。驗證：`SearchTests` 全部仍通過；`QaAskTests` 驗證 spec 範例「Citations checked」每一列、他隊資料不進候選、embed 失敗時 degraded、問題長度 422、未設定模型 503、看不到的團隊 404、切詞（英數詞、中文雙字詞、去虛字）。（Asking a question；設計：混合檢索：關鍵字＋向量，以 RRF 合併；回答：只根據編號資料，句句附出處）

## 4. 問答頁

- [x] 4.1 新增 webapp/static/ask.html、ask.js、ask.css 與 `/ask` 路由；search.html／search.css 加「全文搜尋｜問答」切換並帶篩選；回答中的 [n] 連到出處、載入狀態、找不到（連到全文搜尋）、degraded、未設定、索引進度；問題與篩選寫入網址但不自動送出 [after: 3.1]。驗證：bench/qa_e2e.mjs（以 route 攔截 `/api/ask` 回應固定內容）檢查回答與出處連結、[1] 移到出處、載入中 aria-busy 與提示、較新問題優先、找不到連到全文搜尋、degraded 提示、網址不自動送出、搜尋頁與問答頁互相切換帶著篩選、400px 不左右捲動；bench/search_e2e.mjs 仍全部通過。（Question page；設計：頁面）

## 5. 評測與選定模型

- [x] 5.1 新增 bench/qa_eval_data.json（擬真會議逐字稿與紀要條目、問題與正確出處，含換句話說、關鍵字、跨語言、無解問題）與 bench/qa_eval.py（建立獨立評測資料庫、載入、以運作中的 embed 建索引、輸出三種檢索的 recall@5／recall@10／MRR、`--answer` 實際呼叫模型、結束時刪除評測資料庫）[after: 3.1]。驗證：對三個候選模型各跑一次，數字寫進 design.md「評測結果」，選定的模型設為 compose 預設。（Retrieval evaluation；設計：Embedding 跑在獨立的 llama.cpp CPU 服務）

## 6. 文件

- [x] 6.1 README 新增「問答」段落（使用方式、embed 服務與模型設定、索引、找不到與 degraded 的意思、API 表）、bench/README 補 qa_eval 與 qa_e2e、docs/roadmap.md P4 ② 標示完成並附評測數字 [after: 4.1, 5.1]。驗證：內容檢查。

## 7. 第二輪：出處側欄與檢索調整

- [x] 7.1 檢索調整：webapp/qa.py 的段落向量文字改為只有本段（含譯文）、關鍵字加門檻（至少兩個詞或一個英數詞，單詞問題一個即可）；bench/qa_eval_data.json 加 25 題 holdout（`"set": "holdout"`），bench/qa_eval.py 分組報告並加 `--detail`。實測 rerank（Qwen3-Reranker、bge-reranker-v2-m3）無改善、不採用。驗證：`QaIndexTests` 更新為只重算被修改的那段、關鍵字門檻與稀有詞排序；qa_eval 兩組混合 MRR 都 ≥ 0.9，`--answer` 結果寫進 design.md「第二輪」。（Passage index、Asking a question；設計：第二輪：把混合排序 MRR 提高到 0.9 以上（2026-11-07））
- [x] 7.2 出處側欄：新增 webapp/static/evidence-panel.js、evidence-panel.css（由 minutes.js、minutes.css 抽出，加上焦點還原與空白鍵播放），紀要頁改用它；問答頁點 [n] 或出處在側欄開啟（逐字稿前後各一段、條目附證據段落、可播放），API 的 item 出處多回 `evidence`；寬螢幕回答區讓出側欄空間 [after: 7.1]。驗證：bench/qa_e2e.mjs 新增側欄開啟不換頁、前後段、條目證據、Esc 關閉與焦點還原、有錄音會議的播放／暫停／空白鍵繼續、關閉停止播放；紀要頁證據側欄以唯讀檢查確認行為不變；`QaAskTests` 驗證 item 出處的 `evidence`。（Question page；設計：出處在右側側欄開啟）
- [x] 7.3 README 問答段落與 docs/roadmap.md 更新為側欄與第二輪評測數字 [after: 7.2]。驗證：內容檢查。

