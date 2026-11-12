## 1. 前端檢查

- [x] 1.1 `bench/catalogcheck.js`、`bench/contextcheck.js`、`bench/guardcheck.js` 遇到 FAIL 時設 `process.exitCode = 1`，並新增 `bench/checks.js` 執行所有 `bench/*check.js`、彙總每支的 ok／FAIL 數，任一失敗以 1 結束。驗證：`node bench/checks.js` 全部通過並以 0 結束；把一支檢查的期望值暫時改錯（在 scratchpad 的副本上），該支與 `checks.js` 都以 1 結束。

## 2. 後端測試

- [x] 2.1 `webapp/test_server.py` 匯入時不再連線資料庫，建立 `yuqiao_test` 移到 `setUpModule()`。驗證：在 app 容器以無法連線的 `DATABASE_URL` 執行 `python -m unittest test_server.LdapEncryptionTests test_server.MinutesRulesTests` 仍全部通過；正常環境下完整 `test_server` 全部通過。
- [x] 2.2 [after: 1.1, 2.1] README「驗證與日常維護」列出所有自動測試的指令（`test_server`、`test_asr_session`、`node bench/checks.js`）與各自需要的服務。驗證：照 README 執行三個指令都以 0 結束。
