## 1. 修正與檢查

- [x] 1.1 新增 `bench/reviewcheck.js`：從 `webapp/static/review.js` 取出實際的 `retranslate` 函式，以可控制完成時機的假 `TranslationContext.translateStream` 與假 `call` 執行，逐列斷言 Concurrent edits are detected 規格的「what a finished retranslation does」範例；任何一項不符時以非 0 結束。驗證：修正前執行 `node bench/reviewcheck.js` 至少「changed」一列失敗（重現競態）。
- [x] 1.2 [after: 1.1] 修改 `webapp/static/review.js` 的 `retranslate()`：開始時記下 `version` 與原文，完成時原文不同就捨棄並顯示「原文已再次修改，略過這次重譯」，否則以開始時的 `version` 送出儲存。驗證：`node bench/reviewcheck.js` 全部 ok 並以 0 結束；其他 `bench/*check.js` 仍全部 ok；`test_server` 全部通過。
