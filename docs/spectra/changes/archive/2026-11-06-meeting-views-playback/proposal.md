## Why

會議紀要（P2）上線後，使用者實際操作回報四個問題：

1. 會議列表上「紀要」與「校對」兩顆按鈕高度不一致（框線按鈕缺少 compact 尺寸）。
2. 紀要頁點證據會跳到校對頁看原文與聽錄音，再切回紀要頁，來回切換很麻煩。
3. 每場會議的「會議紀要」與「逐字稿校對」互相跳轉的連結不明顯（灰色小字），兩頁標頭不一樣，切換時畫面跳動、不流暢，返回鍵還會在兩頁之間繞。
4. 聽錄音時只能整段播完，無法暫停，有時只是想聽一下。

另外，紀要模型的 `MINUTES_*` 設定沒有出現在 `.env.example`，部署的人不知道可以設定。

這些修改已先實作並提交（commit dff06a5、f7ccf9f），沒有走 Spectra 流程；本變更補上規格、設計與驗證，讓 `docs/spectra/specs/` 與程式一致。

## What Changes

- **共用標頭與分頁列**：逐字稿校對頁（`/meetings/{id}`）與會議紀要頁（`/meetings/{id}/minutes`）共用同一個標頭（返回連結、會議主題、團隊／開始時間／錄音長度／語言／建立者）與「逐字稿校對 ｜ 會議紀要」分頁列。切換分頁取代目前的瀏覽紀錄，不增加返回步數；支援的瀏覽器以轉場淡入切換，標頭保持不動；標題先用上次造訪的內容顯示，不會閃一下。
- **返回會議紀錄**：不論在兩個分頁之間切換幾次，「返回會議紀錄」與瀏覽器返回都回到使用者進來前的列表（含篩選條件）。
- **證據側欄**：紀要頁點證據時間點，不離開紀要頁，在右側開啟側欄：顯示引用段落（標示）與前後各一段上下文、原文與譯文、播放錄音、「到校對頁修正」連結；Esc 或關閉鈕收起；寬螢幕上紀要內容讓出空間，手機改為底部面板。條目被重新產生取代時側欄自動關閉。
- **播放可暫停與繼續**：校對頁的播放鈕改為播放／暫停／繼續切換，旁邊顯示目前位置（例如 `00:01 / 00:19`），空白鍵可切換（輸入時不觸發）；證據側欄的播放鈕同樣可暫停與繼續。
- **會議列表按鈕**：兩顆按鈕同尺寸，名稱改為與分頁一致的「會議紀要」「逐字稿校對」。
- **設定範例**：`.env.example` 補上 `MINUTES_URL`、`MINUTES_MODEL`、`MINUTES_KEY` 的註解範例。

## Non-Goals

- 不把兩個分頁合併成單頁應用；仍是兩個網址、兩個靜態頁。
- 不在證據側欄內直接修改逐字稿；修正仍到校對頁進行（側欄提供連結）。
- 不改變播放的前後延伸量（前 3 秒、後 0.5 秒）與「往前／往後 2 秒」的行為。
- 不變更任何後端 API 或資料表。
- 不為 Firefox／Safari 補做轉場效果；不支援時直接切換。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `meeting-catalog`：「Returning from the review page」擴充為兩個會議分頁共用的返回行為，並新增兩頁共用標頭與分頁切換的需求；會議列表的按鈕名稱與分頁一致。
- `transcript-review`：「Segment playback」加入暫停、繼續、目前位置與空白鍵。
- `meeting-minutes`：新增證據側欄需求（在紀要頁內檢視與播放證據段落）。

## Impact

- 前端：`webapp/static/meeting-nav.js`（新增，共用標頭、分頁、返回）、`webapp/static/review.html`、`webapp/static/review.js`、`webapp/static/review.css`、`webapp/static/minutes.html`、`webapp/static/minutes.js`、`webapp/static/minutes.css`、`webapp/static/meetings.html`、`webapp/static/admin.css`、`webapp/static/admin.html`
- 設定與文件：`.env.example`、`README.md`、`bench/README.md`
- 驗收腳本：`bench/minutes_e2e.mjs`（證據側欄、分頁切換、返回）、`bench/playback_e2e.mjs`（新增，播放／暫停／繼續／空白鍵）
- 後端、API、資料庫：無變更
