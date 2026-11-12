## Why

自動檢查必須在失敗時讓程式回傳非 0 的結束代碼，否則腳本、排程或 CI 會把失敗當成成功：
- `bench/catalogcheck.js`、`bench/contextcheck.js`、`bench/guardcheck.js` 遇到不符時只印出 `FAIL`，結束代碼仍是 0；
- 前端檢查散落在 `bench/` 下各自執行，沒有一個指令能一次跑完並回報總結果；
- `webapp/test_server.py` 在**匯入時**就連線資料庫並建立 `yuqiao_test`，所以就算只想跑不需要資料庫的純規則測試（例如 LDAP 加密設定、紀要規則），資料庫沒開也會在匯入階段失敗。

## What Changes

- 三支前端檢查遇到 `FAIL` 時設定 `process.exitCode = 1`。
- 新增 `bench/checks.js`：依序執行 `bench/` 下所有 `*check.js`，列出每支的通過與失敗數，任何一支失敗（或結束代碼非 0）就以 1 結束。
- `webapp/test_server.py`：匯入時只計算測試資料庫網址，不連線；建立 `yuqiao_test` 移到 `setUpModule()`，需要資料庫的測試才會在執行前碰到它。
- README「驗證與日常維護」寫出全部測試的指令與各自需要哪些服務。

## Non-Goals

- 不把 `test_server.py` 拆成多個檔案（3,000 多行，另案處理）。
- 不建立 CI 設定（目前沒有 CI 平台）。
- `bench/` 下的端對端測試（`*_e2e.mjs`）與品質評測不在此範圍。

## Impact

- Affected specs: none
- Affected code:
  - New: bench/checks.js
  - Modified: bench/catalogcheck.js, bench/contextcheck.js, bench/guardcheck.js, webapp/test_server.py, README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
