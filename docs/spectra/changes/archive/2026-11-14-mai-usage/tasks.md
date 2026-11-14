## 1. 記錄

- [x] 1.1 spec「Audio sent to MAI is recorded」四個情境與「Usage outside the app is entered by hand」兩個情境：新增 `webapp/migrations/018_mai_usage.sql`（表 `mai_usage(day, purpose, seconds)`，主鍵日期＋用途）與 `webapp/mai_usage.py`：`add(purpose, seconds)` 累加當天該用途、寫入失敗時記警告不拋出；`Meter(purpose)` 的 `count(byte 數)` 每累積 300 秒寫入一次、`finish()` 寫入剩餘；`python -m mai_usage` 的 `add` 與列印。完成時：加 5400 秒到 `bench` 後該列增加 5400；`-5` 與含大寫或空白的用途被拒絕且不寫入；`Meter` 計 301 秒後資料庫已有至少 300 秒。驗證：`test_server.py` 新增 `MaiUsageTests`。
- [x] 1.2 [after: 1.1] spec 同一條需求的「A live MAI stream ends」「The quality pass listens with MAI」情境：`mai_asr.MaiBridge` 對送出的每則音訊呼叫 `Meter("live").count()`、`run()` 結束時等 `finish()` 寫完（以 `asyncio.shield` 保護，串流被取消時也會寫入）；`chunk_asr.MaiLive` 對實際送出的音訊計入 `Meter("quality")`，`QualityPass.finish()` 等寫入完成、`cancel()` 排入寫入。完成時：MAI 引擎的串流送 2 秒音訊後 `live` 增加 2 秒；精準模式用 MAI 的串流送 3 秒後 `quality` 增加 3 秒。驗證：`MaiUsageTests` 的兩個串流測試。

## 2. 顯示與提醒

- [x] 2.1 [after: 1.1] spec「Administrators see the accumulated cost against the budget」的範例表與兩個情境：`mai_usage.summary()` 與 `GET /api/admin/mai-usage`（僅管理員），`MAI_USD_PER_HOUR`、`MAI_BUDGET_USD` 由環境變數讀取；寫入後金額第一次達八成與達上限時各記一次警告。完成時：範例表五列的 `usd` 與 `state` 相符；非管理員得到 403；達上限後 MAI 串流照常辨識。驗證：`MaiUsageTests`。
- [x] 2.2 [after: 2.1] `webapp/static/admin.html` 在團隊列表上方顯示 MAI 用量（小時、金額、上限），`near` 與 `over` 時以警示樣式顯示提示文字；`compose.yaml` 傳入兩個變數，`.env.example` 與 `README.md` 說明用量紀錄、手動登記指令與上限的意義。驗證：`bench/mai_usage_e2e.mjs`（真實瀏覽器，管理員 API 由測試回答）確認未達、接近、超過上限與非管理員四種顯示；`docker compose config` 成功。

## 3. 上線

- [x] 3.1 [after: 1.2, 2.2] 全部單元測試與 `node bench/checks.js` 通過；重啟 app 套用 migration；以 `python -m mai_usage add` 登記 2026-11-14 評測期間直接或在紀錄功能上線前送給 MAI 的估計用量（用途 `bench`），並在 `bench/README.md` 註明這是估計值與估算方式。驗證：`/api/admin/mai-usage` 回傳的 `seconds` 等於登記的秒數加上線後的用量。
