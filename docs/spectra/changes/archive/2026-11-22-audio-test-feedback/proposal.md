## Problem

2026-11-22 使用者回報：按「測試音源」後，畫面沒有顯示到底有沒有收到聲音。實測（Playwright，假麥克風）：

- 音訊來源選「分頁／系統聲音」時，狀態文字 `#micStatus` 與音量條 `#micTestLevel` 都不可見（寬高 0）。使用者兩支測試影片都用分頁音訊（畫面顯示 Tab audio），正好是這個情況。
- 音訊來源選「麥克風」時看得到，但音量條只有 48×3 像素、狀態字 12px，擠在「麥克風來源」欄位底下，不容易注意到。
- 完全沒有聲音時，狀態一直停在「已連接：…」，不會提示「還沒收到聲音」。

## Root Cause

`webapp/static/index.html` 把狀態與音量條（`.mic-health`）放在「麥克風來源」欄位 `.mic-field` 裡；`webapp/static/app.js` 的 `updateSourceUI` 在來源為「分頁／系統聲音」時替 `.mic-field` 加上 `is-hidden`（`display:none`），連帶藏起測試結果。`toggleMicTest` 只在音量超過門檻時把狀態改成「訊號正常」，沒有「一段時間都沒聲音」的狀態。

同樣受影響的還有 `microphone-access` 規格要求的「需要 https 連線才能使用麥克風」等狀態：它們也寫在 `#micStatus`，選分頁音訊時一樣看不到。

## Proposed Solution

- **測試結果放在「測試音源」按鈕裡**：把 `.mic-health`（保留 `#micStatus`、`#micTestLevel` 的 id）從 `.mic-field` 移進 `#testMic` 按鈕，成為按鈕的第三行：狀態文字＋按鈕全寬的音量條（高 4px）。不論選哪種音訊來源都看得到；`#micStatus` 加 `aria-live="polite"`，讀螢幕軟體會念出變化。
- **沒聲音的提示**：測試開始後 5 秒內音量一直沒超過門檻（現有的 `peak > .08`），狀態改成錯誤色的「還沒收到聲音」，並依來源說明：麥克風「請對麥克風說話，或換一個麥克風來源」；分頁／系統聲音與混合「請確認分享時勾選了分享音訊，且正在播放」。之後一收到聲音就改回「訊號正常：…」。
- 樣式：`refine.css` 調整按鈕內的狀態列（音量條全寬、文字過長以省略號截斷），並在選「分頁／系統聲音」時讓按鈕延伸佔用隱藏的麥克風欄位。`styles.css` 的 `.mic-health` 基本樣式（`.ok`、`.error` 顏色）與 `mobile.css` 既有的 11px 字級沿用，不需要改。
- 判斷有沒有聲音以計時取樣（每 100 ms），不只靠畫面動畫：分享分頁時 Chrome 常把被分享的分頁切到前景，語橋頁面在背景收不到動畫回呼。狀態文字只在改變時寫入（它會被讀螢幕軟體朗讀）。

## Non-Goals

- 不改測試音源的擷取方式（`acquireAudio`）與門檻值。
- 不在「開始會議」後顯示這個音量條（開會時已有上方的即時音量列）。
- 不改「麥克風來源」下拉選單本身。

## Success Criteria

- 選「分頁／系統聲音」按「測試音源」並分享有聲音的分頁：按鈕內看得到「訊號正常：…」與會動的音量條（瀏覽器端對端測試：`#micStatus` 可見、文字以「訊號正常」開頭）。
- 選「麥克風」測試：同樣在按鈕內顯示，且「麥克風來源」欄位底下不再有狀態列。
- 測試 5 秒都沒有聲音：狀態為「還沒收到聲音」加上對應來源的說明。
- `bench/ui_polish_e2e.mjs` 既有的 `#micStatus` 檢查（https、不支援麥克風）仍通過，且在「分頁／系統聲音」時也看得到。
- 桌面 1280、窄螢幕 1000 與手機 390 寬的截圖中，按鈕文字與音量條不溢出、不被截斷。

## Impact

- Affected specs: microphone-access（新增「Audio test result is always visible」）
- Affected code:
  - Modified: webapp/static/index.html, webapp/static/app.js, webapp/static/refine.css, bench/ui_polish_e2e.mjs
  - New: bench/audio_test_e2e.mjs
  - Removed: (none)
