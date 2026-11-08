## Why

全文搜尋（meeting-search）在送出或切換篩選後沒有任何載入提示，慢的查詢期間舊結果仍完整顯示，容易被誤認為新查詢的結果，螢幕閱讀器也不知道正在搜尋。另外後端會把第 6 個以後的搜尋詞靜默丟掉，使用者以為 6 個詞都有比對，結果卻比預期多。

## What Changes

- 搜尋頁送出查詢（含切換類型、團隊、系列、日期與清除篩選）後進入載入狀態：結果區 `aria-busy="true"`、舊結果變淡且不能點，查詢稍久時摘要（`aria-live`）顯示「正在搜尋「…」…」；完成、失敗或被較新的查詢取代時解除。保留既有的較新查詢優先（舊回應不覆蓋）、鍵盤操作與網址篩選狀態。
- 搜尋詞上限 5 個改為前後端一致的驗證：超過 5 個詞時前端不送出查詢，清掉舊結果並顯示「搜尋詞最多 5 個（目前 N 個），請刪減後再搜尋」，搜尋框標 `aria-invalid`；後端回 422 同一句訊息，不再靜默截斷。100 字上限不變，前端也先檢查。
- 搜尋頁的初始說明、README 與規格寫明最多 5 個詞。
- 回歸測試：單元測試（5 詞可、6 詞 422、全形空白也算分隔）；bench/search_e2e.mjs 新增載入狀態、較新查詢優先、超過 5 詞不送出等檢查。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `meeting-search`: 查詢超過 5 個詞改為 422（原為截斷）；搜尋頁加入載入狀態與超過上限的提示。

## Impact

- Affected specs: meeting-search
- Affected code: webapp/search.py, webapp/static/search.js, webapp/static/search.css, webapp/static/search.html, webapp/test_server.py, bench/search_e2e.mjs, bench/README.md, README.md
