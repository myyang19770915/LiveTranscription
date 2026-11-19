## 1. 精準模式不翻譯時改為通順校稿

- [x] 1.1 `quality_pass._without_translation` 把第 1 步換成通順校稿（修正辨識錯誤與錯別字、台灣標準書面用詞、去掉贅詞（那個、就是…）、結巴、說錯重來、讓句子通順），並寫明限制：每個重點保留、不摘要不新增；英文或其他外語照原樣保留不翻譯；直接引語保持直接引語；沒說完的句子不補完、不換句話說、不改變意思；一段一個完整想法。有翻譯的 `SYSTEM` 不變（需求「精準模式 without translation」；「The text model's answer accounts for its input」：有翻譯時仍只准去贅音，長度檢查不變）。驗證：test_server 新測試 `TranscriptPolishTest` 檢查 `system_prompt("zh","none")` 含這些字句、`system_prompt("zh","en")` 與改動前相同（不含「clean, readable transcript」）。
- [x] 1.2 `revise_pass._without_translation` 把第 1 步換成相同的校稿與限制，並保留「已經通順的句子一字不改」；`revise_pass.SYSTEM` 不變（需求「精準模式 without translation」）。驗證：`TranscriptPolishTest` 檢查 `revise_pass.SYSTEM_TRANSCRIPT` 含校稿、外語保留、直接引語、不補完等字句，`revise_pass.SYSTEM` 不含；既有 TranscriptOnlyQualityTest 與全部 test_server 通過。 [after: 1.1]

## 2. 實際效果確認

- [x] 2.1 用改好的指示對 zh_chen 與會議錄音（20261117-192253）各跑一次不翻譯精準模式（engine api），與上次 B 版一起盲評（評分標準 bench/rubric_transcript.md），確認外語翻成中文、直接引語改轉述、補完句子、一段塞太多想法這四類問題減少，且分數不低於上次 B 版（zh_chen 83、會議 85）超過 3 分；回報花費。驗證：盲評 JSON 與花費紀錄。 [after: 1.2]
- [x] 2.2 刪除暫時評測檔 webapp/.eval_polish.py，評分標準 bench/rubric_transcript.md 留在 repo。驗證：`git status` 不再列出 .eval_polish.py。 [after: 2.1]
