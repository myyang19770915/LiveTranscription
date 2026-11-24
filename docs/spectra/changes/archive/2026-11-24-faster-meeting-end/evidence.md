# 實測：按下結束到連線關閉

## 會議

- 2026-11-24 22:10:22 開始的精準模式會議 `6ec5d47e-995a-493f-90a1-bab117838304`，中文、本機辨識引擎，約 70 秒音訊（2,264,960 bytes）。
- 資料來源：app 容器的伺服器紀錄（`docker logs -t asr_confucius4-r2t2-app-1`，時間為台北時間）。
- 使用者回報約 22:11:40 按下停止。紀錄顯示錄音上傳在 22:11:33.49 就完成，而錄音只在按下結束後才上傳，所以實際按下時間在 22:11:33 之前，推估約 22:11:31～33（修改前的會議上傳約需 2.5 秒）。以下以紀錄為準。

## 時間軸（台北時間）

| 時間 | 事件 | 距按下（推估） |
| --- | --- | --- |
| 約 22:11:31～33 | 按下「結束會議」 | 0 秒 |
| 22:11:33.494 | 錄音上傳完成（`PUT …/files/recording`），接著頁面送出結束訊號 | 約 0.5～2.5 秒 |
| 22:11:34.266 | 精準模式最後一段完成（`quality chunk seq=11 audio_ms=3700 … ms=755`） | 約 1.3～3.3 秒 |
| 22:11:40.335 | 回顧修訂完成一批（`quality revision sentences=5 changed=1 … ms=6068`） | 約 7～9 秒 |
| 22:11:49.267 | 回顧修訂收尾到上限：`6 sentences were not revised before the stream closed`（最後一段完成後 15.0 秒） | 約 16～18 秒 |
| 22:11:49.278 | 連線關閉（`connection closed`） | 約 16～18 秒 |
| 22:11:50.16 | 頁面存最後的段落與逐字稿 | |

## 與修改前比較

| 階段 | 修改前（2026-11-19 13:32 那場，proposal） | 修改後（本次） |
| --- | --- | --- |
| 上傳錄音 | 約 2.5 秒 | 約 0.5～2.5 秒 |
| 精準模式開始收尾前的等待 | 約 16 秒（等即時辨識引擎消化排隊音訊） | 0 秒：收到結束訊號就開始，0.8 秒內完成最後一段 |
| 精準模式最後一段 | 約 1.5 秒 | 0.8 秒 |
| 回顧修訂收尾 | 30 秒上限用滿，6 句沒完成 | 15 秒上限用滿，6 句沒完成（維持第一次整理的結果） |
| **按下到關閉** | **約 48 秒** | **約 16～18 秒** |

## 觀察

- 精準模式不再等即時辨識引擎：最後一段在上傳後 0.8 秒就送出（需求「The stream closes after the final quality event」）。
- 剩下的時間幾乎都是回顧修訂的 15 秒上限（需求「Revision ends with the stream」）。這場有 6 句在上限內沒修訂完，和修改前一樣，表示最後幾句的修訂本身就需要超過 15 秒。若要再縮短，下一步是調查修訂的批次大小或速度，不在本變更範圍。
- 這場會議中，即時辨識引擎在結束訊號後 0.02 秒就關閉（asr 容器紀錄 22:11:33.511），沒有落後，回顧修訂拿到的即時文字是完整的。引擎落後時，最後幾句的修訂現在最多等它 5 秒（任務 1.3）。

## 畫面測試（2026-11-24，app 容器重啟後）

`YUQIAO_SESSION=… node bench/meeting_end_e2e.mjs`（假的連線在結束訊號後 2 秒才關閉，不建立會議，會議數前後都是 37）：

```
ok   一般: while closing the button says 結束中… and is disabled ["結束中…",true]
ok   一般: once closed the button is back ["開始會議",false]
ok   精準模式: while closing the button says 結束中… and is disabled ["結束中…",true]
ok   精準模式: the status says the last sentences are being finished "正在完成最後幾句…"
ok   精準模式: once closed the button is back ["開始會議",false]
```

單元測試：`docker exec -w /app asr_confucius4-r2t2-app-1 python -B -m unittest -q test_server` 全部通過。
