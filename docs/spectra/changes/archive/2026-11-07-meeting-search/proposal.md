## Why

roadmap P4「查詢」的第一步。現在只能在會議列表依主題篩選，要找「上次誰說過報價單的事」「哪場會議決定了交貨方式」只能一場場打開逐字稿翻。使用者決定 P4 先做全文搜尋與條件篩選，再做語意問答。roadmap 原寫 SQLite 的 FTS5，但系統已改用 Postgres，因此改用 Postgres 內建的 `pg_trgm` 為中日文子字串搜尋建索引（不需換資料庫映像，也不需中文斷詞套件）。

## What Changes

- 新增「搜尋」頁（`/search`），頁首每頁都有放大鏡按鈕連過去，任何頁面按 `/` 也能開啟。
- 一次搜尋所屬團隊的逐字稿原文、譯文、紀要條目（決議、待辦、問題、風險，含看板新增的待辦）與會議主題；多個詞以空白分隔時須同時出現。
- 條件篩選：團隊、系列、日期範圍、類型（全部／逐字稿／紀要／會議主題）；條件寫在網址，可分享。
- 結果依會議分組（新的在前），每筆標出符合的字、時間點與類型；逐字稿結果連到校對頁那一段（可直接播放），紀要結果連到紀要頁那一條，看板待辦連到看板。
- 新增 migration 啟用 `pg_trgm` 並為段落原文、譯文、紀要內容、會議主題建立 trigram 索引。

## Non-Goals

- 語意問答與 embedding（P4 第二步）。
- 模糊或同音字搜尋、拼音、中文斷詞。
- 搜尋結果的排序學習或相關度評分（依時間排序）。

## Capabilities

### New Capabilities

- `meeting-search`: 全文搜尋與條件篩選：搜尋範圍、權限、詞的比對規則、篩選、結果分組與連結、筆數上限。

### Modified Capabilities

（無）

## Impact

- 資料庫：新增 webapp/migrations/010_search.sql（`pg_trgm` 與 4 個 GIN 索引）。
- 後端：新增 webapp/search.py（`/search` 頁、`GET /api/search`），webapp/server.py 註冊。
- 前端：新增 webapp/static/search.html、search.js、search.css；webapp/static/account.js 頁首放大鏡與 `/` 快捷鍵；admin.css、accounts.css 樣式；各 html 版本號。
- 測試：webapp/test_server.py、新增 bench/search_e2e.mjs。
