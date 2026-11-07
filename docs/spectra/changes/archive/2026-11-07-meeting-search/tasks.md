## 1. 資料與 API

- [x] 1.1 新增 webapp/migrations/010_search.sql（`CREATE EXTENSION IF NOT EXISTS pg_trgm`，`segments.source`、`segments.target`、`minute_items.content`、`meetings.title` 的 GIN `gin_trgm_ops` 索引）；新增 webapp/search.py 的 `GET /api/search` 依設計的比對、權限、篩選、分組、上限規則回傳，webapp/server.py 註冊。驗證：webapp/test_server.py `SearchTests` 涵蓋 spec 的 Matching 範例、他團隊不可見與 404、系列／日期／類型篩選、422、`truncated`、索引存在。（Full-text search；設計：用 pg_trgm 的 ILIKE，不用 tsvector；多詞 = 同一段文字中全部出現；依會議分組，新的在前，總數上限 300 筆）

## 2. 頁面

- [x] 2.1 新增 webapp/static/search.html、search.js、search.css：搜尋框與篩選列（條件寫入網址並還原）、依會議分組的結果、`<mark>` 標示、各類型連結、沒有結果與截斷提示；`GET /search` 頁面路由 [after: 1.1]。驗證：bench/search_e2e.mjs 搜尋、分組、標示、連到校對頁段落、類型篩選與網址還原、400px。
- [x] 2.2 webapp/static/account.js 頁首放大鏡按鈕與 `/` 快捷鍵（焦點不在輸入框時；在搜尋頁則聚焦搜尋框），admin.css、accounts.css 樣式，各 html 版本號 [after: 2.1]。驗證：bench/search_e2e.mjs 從看板點放大鏡與按 `/` 都開啟搜尋頁。（設計：頁首放大鏡與 `/` 快捷鍵）

## 3. 文件

- [x] 3.1 README 新增「搜尋」段落與 API 表、bench/README 補 search_e2e、docs/roadmap.md P4 狀態更新為「① 搜尋完成」 [after: 2.2]。驗證：內容檢查。
