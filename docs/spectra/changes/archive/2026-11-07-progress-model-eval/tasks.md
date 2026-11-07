## 1. 評估工具

- [x] 1.1 新增 bench/progress_model_eval.py：10 種情境的合成待辦與逐字稿，經 `series.build_messages`、`minutes.call_model`、`series.clean_updates` 呼叫目前設定的模型並逐題比對預期（`?` 表示可提可不提），輸出每題結果與命中／漏報／誤報／延遲彙總，不寫入資料庫。驗證：在 app 容器內執行 `python /tmp/progress_model_eval.py 1`，10 題皆印出結果並輸出彙總 JSON。

## 2. 文件

- [x] 2.1 bench/README.md 加入 progress_model_eval.py 的用途與執行方式；docs/roadmap.md 記錄 2026-11-07 實測結果（56 次呼叫、60 項中命中 58、誤報 0、延遲中位數約 2 秒）[after: 1.1]。驗證：內容檢查。
