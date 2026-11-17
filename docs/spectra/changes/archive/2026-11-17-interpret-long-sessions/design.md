## Context

- `webapp/interpret.py` 的 `Recording` 以 `self.input`（`bytearray`）累積送出的 24 kHz 原音、以 `self.pieces`（到達時間與 PCM）累積譯音，`save()` 才寫出 `input.wav`、`output.wav`（`output_track()` 把每段放在到達時間、不與前一段重疊、中間補靜音）。上限由 `stream_limits.max_stream_bytes()` 換算，預設 4 小時：原音約 690 MB，譯音最多同量級，全在伺服器記憶體。
- `webapp/static/interpret.js` 在 `tap.port.onmessage` 把每 0.1 秒的 Float32 原音推進 `inChunks`，`playChunk()` 把譯音推進 `outChunks`；`replay()` 用這些片段排程 Web Audio。`loadSession()` 下載整個 WAV 再用 `toChunks()` 轉回片段。4 小時原音的 Float32 約 1.4 GB。
- 原文：`asr.onmessage` 在 `displayText` 改變時送 `{"type":"source","text":srcFinal}`（整段）；伺服器 `upstream()` 存 `event["text"][:200000]`。
- Starlette 0.47.3 的 `FileResponse` 會回應 Range 請求（`webapp/server.py` 有註記），所以 `<audio>` 播放 `/api/interpret/sessions/<id>/input.wav` 時可從任意位置開始，不必整檔下載。

## Goals / Non-Goals

**Goals:**

- 伺服器與頁面在口譯中都不保留整段音訊；記憶體用量不隨口譯時間成長（波形高度與文字除外：每 0.1 秒一個數字）。
- 原文只送變動的部分。
- 存檔格式、API 權限、重播操作（三種模式、拖曳波形、播放線）不變。

**Non-Goals:**

- `/ws/transcribe` 的 `displayText` 格式不改。
- 不改上限、費用、`interpret_usage`。
- 沒存成功的那次口譯不提供重播。

## Decisions

### 伺服器邊收邊寫

`Recording(folder_of_user, meta)` 在第一段音訊（原音或譯音）到時建立 `folder_of_user/.recording-<YYYYMMDD-HHMMSS>-<8 位隨機十六進位>/`，以無緩衝檔案（`buffering=0`）開兩個 `wave` 寫入器。`add_input(pcm)` 直接寫入 `input.wav`；`add_piece(arrived, pcm)` 依原規則算出開始樣本 `max(round(arrived*RATE), end)`，先以每次最多 1 秒的靜音補到開始處，再寫入 PCM。只保留計數（原音位元組、譯音位元組、`end`）與波形高度。

`save(usd)` 關閉寫入器；沒有任何音訊時回傳 `None`（暫存資料夾若存在則刪除）；否則寫 `session.json`、`transcript.txt`、`bars.json`，再把暫存資料夾改名成紀錄編號（規則不變：開始時間，重複時加 `-2`、`-3`…）。列表與讀取只認符合 `SESSION_ID` 的名稱，暫存資料夾自然排除。伺服器中途當掉時留下的暫存資料夾不會被列出。

替代方案「結束時才寫、但限制記憶體」：無法同時保留 4 小時上限，捨棄。

### 波形高度

每 2400 樣本（0.1 秒）一個 RMS 值（0–1，四位小數）。原音依送出順序連續累計（不足 0.1 秒的尾巴留到下一段）；譯音以各段在 `output.wav` 上的開始樣本為起點，每 2400 樣本一個 `[t, v]`，`t` 為秒，靜音（v 為 0）不記。`bars.json`：`{"step": 0.1, "input": [v, …], "output": [[t, v], …]}`。

`GET /api/interpret/sessions/<id>/bars`：只給本人（同既有規則，別人的或不合格式的 id 回 404）；有 `bars.json` 就回傳，沒有（本 change 之前存的紀錄）就從兩個 WAV 以 2400 樣本為一塊算出後回傳；譯音以 `output.wav` 開頭起每 0.1 秒一格，所以只有每段都從 0.1 秒整數倍開始時，數值才與邊收邊算的完全相同。

### 頁面不保留音訊

口譯中只記 `inBars`、`outBars` 與長度；不再有 `inChunks`、`outChunks`。即時播放譯音仍用 Web Audio（播完即釋放）。結束時若伺服器回報 `saved`，頁面呼叫 `loadSession(saved)` 顯示剛存好的紀錄（並顯示「已存檔」）；沒有存檔時重播按鈕維持停用。

`loadSession()` 改為讀 `session.json` 與 `bars`，並把兩個 `<audio preload="metadata">` 的 `src` 設為 `input.wav`、`output.wav`。重播：依模式取用一或兩個元素，設定 `currentTime = from` 後 `play()`；播放線取第一個元素的 `currentTime`；所有使用中的元素都結束（`ended`）或使用者停止時結束重播。`Interpret.state()` 的 `replaying.at` 改為該 `currentTime`，並移除 `inChunks`／`outChunks` 欄位，改為 `inBars`、`outBars`（波形高度的數量），供瀏覽器測試確認口譯中有在記錄波形。

### 原文只送變動的部分

頁面記住上次送出的原文 `sentSource`，計算與新 `srcFinal` 的共同前綴長度 `k`，送 `{"type":"source","keep":k,"text":srcFinal.slice(k)}`。伺服器：`keep` 是 0 到目前原文長度之間的整數時，原文 = 目前原文前 `keep` 字 + `text`，再截到 200000 字；`keep` 缺少時視為 0（整段取代，與舊頁面相容）；`keep` 不合法（非整數、負數、超過目前長度）時忽略這則訊息。

## Implementation Contract

- **行為：** 口譯中伺服器的暫存資料夾裡已有 `input.wav`，大小等於 44 位元組檔頭加上已送出的原音位元組；譯音照「到達時間、不重疊、補靜音」寫入 `output.wav`。結束後紀錄內容（`input.wav`、`output.wav`、`session.json`、`transcript.txt`）與以前相同，另多 `bars.json`。頁面結束後顯示剛存好的紀錄並可重播；口譯中不保留音訊。
- **介面：** 新增 `GET /api/interpret/sessions/<id>/bars` → `{"step":0.1,"input":[…],"output":[[t,v],…]}`。`/ws/interpret` 的 source 訊息多一個選填的 `keep`。`Interpret.state()` 不再有 `inChunks`／`outChunks`。
- **失敗情況：** 寫檔失敗（`OSError`）時照舊告知「存檔失敗」並保留用量紀錄；不合法的 `keep` 被忽略；舊紀錄沒有 `bars.json` 時即時算出。
- **驗收：** `test_server` 的 `InterpretTests` 新增：途中檔案大小、暫存資料夾不被列出與讀取、原文分段送出後存下的原文、`bars` 的值與權限、舊紀錄的 `bars`。既有「兩段 3 秒譯音」範例仍通過。`bench/interpret_e2e.mjs` 改為以 `bars` 與可播放的 WAV 回應，重播與拖曳檢查照樣通過，並檢查口譯中頁面沒有保留音訊片段、原文以分段方式送出。
- **範圍：** `webapp/interpret.py`、`webapp/static/interpret.js`、`webapp/static/interpret.html`（快取版本）、`webapp/test_server.py`、`bench/interpret_e2e.mjs`。

## Risks / Trade-offs

- `<audio>` 兩軌同時播放（整段模式）可能有數十毫秒的不同步 → 重播只是回顧，可接受；每次拖曳都重新對齊。
- 每 0.1 秒一次無緩衝寫入 → 每秒約 20 次小量系統呼叫，對伺服器負擔小（估計，未量測；可用 4 小時模擬串流量測 CPU 確認）。
- 波形高度在記憶體中每小時約 36000 個數字（每軌），4 小時仍在數 MB 以內（估計）。
