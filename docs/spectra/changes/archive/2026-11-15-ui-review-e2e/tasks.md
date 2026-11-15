## 1. 檢查腳本

- [x] 1.1 新增 `bench/ui_review_e2e.mjs`（用法 `YUQIAO_SESSION=<管理員> [YUQIAO_MEMBER_SESSION=<一般成員>] node bench/ui_review_e2e.mjs <有譯文段落的會議 id> <截圖目錄>`），斷言校對頁改字版面（1280px 譯文寬度不變、500px 整列）與 404 頁兩種來源（從 `/meetings` 點進顯示「返回上一頁」並能返回；新分頁直接開不顯示）。驗證：對目前容器執行通過，且暫時把 `review.css` 的 `.edit-form` 改回 `grid-column: 2 / 4` 時，譯文寬度那項印出 FAIL、exit code 為 1（確認測試真的抓得到退化），之後改回。
- [x] 1.2 [after: 1.1] 同一支腳本加入 `/admin` 成員按鈕檢查（「移出團隊」為 `danger` 且顏色不同於「移除照片」、按一次顯示「確定把〈名稱〉移出〈團隊〉？」並約 4 秒後恢復、不按第二次）與頭像選單 7 列範例表檢查（無 `YUQIAO_MEMBER_SESSION` 時該列印 skip）。驗證：以管理員與一般成員兩個 token 執行全部 ok；暫時把 `account.js` 的成效指標選單項目拿掉時，對應列印出 FAIL、exit code 為 1，之後改回；執行前後 `/api/admin/teams` 成員清單相同。

## 2. 文件

- [x] 2.1 [after: 1.2] `bench/README.md` 的 e2e 清單加入 `ui_review_e2e.mjs`：檢查哪些項目、兩個 token 怎麼取得（`python -m auth issue-session <帳號>`）、不會修改資料。驗證：內容與腳本開頭的註解、實際參數一致（人工比對）。
