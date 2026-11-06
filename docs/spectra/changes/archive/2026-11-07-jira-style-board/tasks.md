## 1. API

- [x] 1.1 API 補充欄位：`actions.action_rows` 回傳 `statusAt`、`series`，`GET /api/actions` 的 `people[].teams` 只含使用者也在的團隊。驗證：`test_server` 新增測試：改狀態後 `statusAt` 有值、未改過為 null；會議在系列中時 `series` 為名稱；bob 同在兩個團隊時 `teams` 含兩者，他團隊成員不出現

## 2. 看板

- [x] 2.1 精簡卡片與已完成欄只顯示近 14 天：依「精簡卡片」重寫卡片（內容、編號、到期標籤、頭像、來源會議、逾期色條），欄位標題顯示件數；已完成欄依 `statusAt` 只顯示近 14 天並可展開。驗證：`bench/actions_e2e.mjs` 卡片無狀態選單、有 `#id` 與頭像；Action board 範例表「done column on 2026-11-20」以 node 檢查（抽出可在 node 執行的判斷函式）[after: 1.1]
- [x] 2.2 拖曳換欄：依「拖曳換欄」，拖到未開始／進行中／已完成直接改狀態，拖到已取消開面板要求原因，409 時提示並重新載入。驗證：`bench/actions_e2e.mjs`「Dragging a card」「Dropping on 已取消」[after: 2.1]
- [x] 2.3 詳細面板：依「詳細面板」，狀態（含取消原因與歷程，歷程中有會議的顯示連結）、負責人與到期日修改、來源連結、`?item=` 寫入網址並在載入時開啟、Esc 關閉。驗證：`bench/actions_e2e.mjs` 面板改負責人與到期日後卡片更新、「Shared card address」重新整理後仍開啟 [after: 2.1]
- [x] 2.4 快速篩選、頭像列與泳道：依「快速篩選、頭像列與泳道」，快速篩選鈕互斥、頭像篩選、顯示已取消、分組（負責人／來源會議）泳道可收合，全部寫入網址。驗證：`bench/actions_e2e.mjs` 互斥（按「7 天內到期」取代「逾期」）、頭像篩選後只剩該負責人、依負責人分組出現泳道、重新整理保留條件；400px 無水平捲動；既有 `test_server` 看板篩選測試維持通過 [after: 2.1]

## 3. 文件與回歸

- [x] 3.1 README.md「待辦追蹤」更新看板操作說明（拖曳、面板、快速篩選、頭像、分組、已完成 14 天）。驗證：內容檢查；`python -m unittest test_server`、`bench/*check.js`、`bench/minutes_e2e.mjs`、`bench/series_e2e.mjs` 全數通過 [after: 2.2, 2.3, 2.4]
