## 1. 後端

- [x] 1.1 webapp/search.py：查詢切詞超過 `MAX_TERMS`（5）時回 422「搜尋詞最多 5 個（目前 N 個），請刪減後再搜尋」，不再截斷；100 字檢查不變。驗證：webapp/test_server.py `SearchTests.test_matching` 新增 5 詞可查、6 詞 422 與訊息、全形空白分隔算 2 詞。（Full-text search；設計：超過上限：前端擋下、後端 422）

## 2. 搜尋頁

- [x] 2.1 webapp/static/search.js、search.css、search.html：送出與切換篩選時進入載入狀態（結果區 `aria-busy`、`is-loading` 變淡不可點、200 ms 後摘要顯示「正在搜尋「…」…」），只有最新查詢能解除；送出前檢查 100 字與 5 詞上限，超過時不送出、清除舊結果、提示與後端同一句訊息並設 `aria-invalid`；初始說明寫明最多 5 個詞；更新資源版本號 [after: 1.1]。驗證：bench/search_e2e.mjs 新增「慢查詢的載入狀態」「較新的查詢優先」「超過 5 詞不送出且可修正」檢查，原有檢查（清除篩選、網址還原、400 px、`/` 鍵）全部通過。（Search page feedback；設計：載入狀態：立即標記、延遲宣告）

## 3. 文件

- [x] 3.1 README 搜尋段落寫明超過 5 個詞會提示、不會截斷，以及載入提示；bench/README 的 search_e2e 說明補上新檢查 [after: 2.1]。驗證：內容檢查。
