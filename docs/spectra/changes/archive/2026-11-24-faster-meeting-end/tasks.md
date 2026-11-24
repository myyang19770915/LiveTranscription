## 1. 伺服器收尾

- [x] 1.1 `/ws/transcribe` 本機引擎的連線收到瀏覽器的 EOS 時，立即開始精準模式收尾（`quality.finish()`），不必等即時辨識引擎關閉；兩邊都完成後才關閉連線。MAI 的連線不變（需求「The stream closes after the final quality event」）。驗證：test_server 新增測試，假的辨識引擎在 EOS 後延遲 1 秒才關閉，確認 `final: true` 的品質事件比辨識引擎關閉先送出，連線在辨識引擎關閉後才關閉。
- [x] 1.2 `revise_pass.FINISH_TIMEOUT` 從 30 秒改成 15 秒（需求「Revision ends with the stream」）。驗證：既有的 Reviser 收尾測試全部通過，並新增一個斷言確認上限是 15 秒。

- [x] 1.3 回顧修訂收尾時，若即時辨識引擎還沒送完文字，最後幾個修訂請求最多等 5 秒（`revise_pass.LIVE_WAIT`，算在 15 秒上限內），讓 ALT 帶到最後幾秒的即時文字；`server.py` 在引擎送完時設定 `live_done`，瀏覽器先離開時取消提早開始的收尾；結束訊號字串改用 `mai_asr.EOS`（需求「Revision ends with the stream」）。驗證：test_server 新增 `test_the_last_windows_wait_for_the_live_text`、`test_the_wait_for_the_live_text_is_short`，整套 test_server 通過。 [after: 1.2]

## 2. 頁面提示

- [x] 2.1 按下「結束會議」後，按鈕顯示「結束中…」並停用，直到會議結束；精準模式開啟時，狀態列顯示「正在完成最後幾句…」。驗證：用瀏覽器測試假的連線在 EOS 後 2 秒才關閉，確認這段期間按鈕文字與停用狀態、狀態列文字，以及連線關閉後按鈕恢復。 [after: 1.1]

## 3. 實測

- [x] 3.1 實際開一場短的精準模式會議並按下結束，從伺服器紀錄記錄按下到關閉的秒數，與修改前的 48 秒比較，寫入 evidence.md。驗證：evidence.md 有時間軸。 [after: 1.1, 1.2, 2.1]
