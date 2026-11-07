## Why

會中進度提示（meeting-series）上線時只用假模型與攔截回應測過，真正的雲端模型從頭到尾沒跑過。使用者選擇「用真的模型實測會中進度提示」。2026-11-07 以實際模型（`deepseek-v4-flash`，經本機閘道）跑了 10 種情境、共 56 次呼叫：該提的 60 項中提出 58 項（漏掉的 2 項來自同一次呼叫，同一題重跑 6 次都正確），誤報 0，延遲中位數約 2 秒，因此提示詞與門檻不需調整。為了之後換模型或改提示詞時能重跑同一套檢查，把這個評估做成正式工具。

## What Changes

- 新增 `bench/progress_model_eval.py`：以合成的 5 條待辦與 10 種逐字稿情境（明確完成、開始進行、取消、只是討論或計畫、問句與否定、日文、辨識錯字、句子被切開、長段落中的一句、無關閒聊），經由正式程式的 `series.build_messages`、`minutes.call_model`、`series.clean_updates` 呼叫目前設定的紀要模型，逐題比對預期，最後輸出命中、漏報、誤報與延遲。不寫入資料庫。
- `bench/README.md` 說明用法（複製進 app 容器執行，`N` 為每題重跑次數）；`docs/roadmap.md` 記錄這次實測結果。

## Non-Goals

- 修改提示詞、門檻或偵測流程（實測結果不需要）。
- 自動排程執行或 CI（會呼叫付費模型，只在需要時手動跑）。

## Impact

- Affected specs: none
- Affected code:
  - New: bench/progress_model_eval.py
  - Modified: bench/README.md, docs/roadmap.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
