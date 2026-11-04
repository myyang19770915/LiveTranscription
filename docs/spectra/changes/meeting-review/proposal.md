## Why

會議結束後，轉錄、轉譯與原始錄音彼此對不上：段落只記錄在逐字稿中的字元位置，沒有錄音時間，存下來的只有一份純文字檔與一份瀏覽器錄音。使用者無法點一段話去聽原音確認，也無法留下修改紀錄；而「ASR 原文 → 人工修正」正是之後微調 ASR 最有價值的資料。本變更建立在 `team-accounts`（登入、團隊、Postgres、會議歸屬）之上。

## What Changes

- 伺服器端錄音：gateway 把送往 ASR／MAI 的同一份 16 kHz PCM 寫成會議的 WAV 檔，錄音與轉錄共用時間軸；兩種辨識引擎都適用。
- 每個送回瀏覽器的辨識事件附上 `audioMs`（目前收到的音訊長度），前端據此為每個段落記錄開始與結束時間。
- 會議段落結構化保存到 Postgres：時間區間、ASR 原文、目前原文、即時譯文、目前譯文、偵測語言；會議同時保存會議詞彙與自動學習詞彙，供之後重譯使用。會議中定期存、結束時完整存。
- 新增會議列表頁與會後校對頁：列出自己團隊的會議；校對頁並排顯示每段的時間、原文、譯文，點段落播放該段錄音（可前後延伸）。
- 修改轉錄：確認後自動重譯該段，使用與現行精修相同的策略（前兩段原文與譯文、後文、會議詞彙、自動學習詞彙、可選雲端精修、防重複檢查）；可選擇一併重譯下一段。
- 每次修改都留下紀錄（修改者、時間、修改前後原文與譯文），不覆蓋；也可把未修改的段落標為「已確認正確」。
- 兩人同時修改同一段時，後送出者會被告知並重新載入。
- 匯出 ASR 微調資料：一個團隊在指定期間內已確認或已修改的段落，輸出為 zip（每段一個 WAV 與一份 JSONL）。

## Capabilities

### New Capabilities

- `meeting-timeline`: 伺服器端錄音、辨識事件的音訊時間、段落時間區間與段落保存
- `transcript-review`: 會議列表、校對頁、段落播放、修改轉錄與重譯、修改紀錄、確認、同時修改的處理
- `asr-training-export`: 依團隊與期間匯出已校對段落的音訊與文字

### Modified Capabilities

(none)

## Impact

- 受影響程式：webapp/server.py（`transcribe()` 錄音與 `audioMs`、`TranscriptDisplay.annotate`、新增段落／校對／匯出 API）、webapp/mai_asr.py（MAI 路徑寫入同一份錄音）、webapp/static/app.js（段落時間、保存段落）
- 新增：webapp/meeting_audio.py（WAV 寫入與區間讀取）、webapp/migrations/002_review.sql、webapp/static/translation-context.js（從 app.js 抽出的重譯請求組裝與防重複檢查，即時與校對共用）、webapp/static/meetings.html、webapp/static/review.html 與 review.js
- 儲存：每小時會議約 115 MB WAV（16 kHz × 16 bit × 單聲道 = 32 KB/s，計算值），存於 `output/teams/<team_id>/<meeting_id>/audio.wav`
- 相依：需先完成 `team-accounts`
- 文件：README.md、docs/roadmap.md
