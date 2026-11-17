## Context

開會頁（`/`，含「會議」與「即時翻譯」兩種模式）目前在「進階」裡有 `#asrEngine` 下拉選單（本機／混合：中文本機、其他雲端 MAI／雲端 MAI），只有伺服器設定了 MAI（`/api/config` 的 `mai`）時才顯示。選的值存在 localStorage `asrEngine`，開始會議時由 `asrEngine()` 讀出，送進 `POST /api/meetings` 的 `engine` 與 WebSocket 串流標頭的 `engine`。伺服器 `server.asr_engine(choice, language)` 再決定實際引擎：`hybrid` 時 `zh`、`auto`、`zh_ja`、`yue` 用本機，其他用 MAI。

先前實測結論是中文用本機 Confucius、其他語言用 MAI，正好是 `hybrid` 的規則，所以選單沒有存在必要。

雲端精修（`#cloudRefineRow`）與精準模式（`#qualityRow`）的勾選框下方只有一行資料去向（「會議內容會傳送到外部服務」「音訊與文字會傳送到外部服務」），做什麼只寫在 `title` 滑鼠提示，手機看不到。精準模式勾選時雲端精修會被停用（`cloudRefineOn()` 視為關閉）。

## Goals / Non-Goals

**Goals:**

- 開會頁不再讓使用者選辨識引擎；引擎依語音語言決定，並在畫面上唯讀顯示目前會用哪個、資料去向。
- 隱私標示依語言即時正確。
- 雲端精修與精準模式各有看得到的說明（電腦與手機都看得到），寫清楚兩者差別與適用情況。

**Non-Goals:**

- 不改伺服器：`asr_engine()`、`/api/meetings` 仍接受 `local`、`hybrid`、`mai`，bench 工具（`--engine`）照用。
- 不改精準模式第二次辨識的選擇（`TRANSLATE_QUALITY_ASR`），那是伺服器設定。
- 不加「管理員強制引擎」之類的新設定。
- 不改校對頁（`review.html`）上的雲端精修。
- 不改成效指標頁的引擎名稱表（舊會議仍可能是 `hybrid`）。

## Decisions

### 頁面依語言算出實際引擎再送出

`asrEngine()` 改為：`/api/config` 的 `mai` 為 true 且語音語言不是 `zh`、`yue`、`auto`、`zh_ja` 時回傳 `mai`，否則回傳 `local`。這組語言與 `server.asr_engine()` 的 `hybrid` 規則相同。送出的是實際引擎（`local`／`mai`）而不是 `hybrid`，這樣會議紀錄存下的 `engine`、隱私標示、成效指標都是實際用到的引擎。

替代方案：一律送 `hybrid` 讓伺服器決定。不採用：隱私標示需要在頁面上知道實際引擎，而且會議紀錄會全部變成「混合」，看不出那場會議實際有沒有把音訊送出去。

語言清單在前端寫成常數 `LOCAL_ENGINE_LANGUAGES = ['zh','yue','auto','zh_ja']`，旁邊註明須與 `server.asr_engine()` 一致。

### 引擎欄位改為唯讀說明，保留在進階裡

`#asrEngineRow` 保留（id 不變，仍只在 `mai` 為 true 時顯示），內容從選單改為：標籤「辨識引擎」、目前值（`#asrEngineValue`）與規則說明（`.field-note`）。

- 目前值：本機時「本機模型（語橋主機）」；MAI 時「雲端 MAI（音訊會傳送到 Azure）」。
- 規則說明：「依語音語言自動選擇：中文、粵語、中英、中日雙向用本機，其他語言用雲端 MAI」。

保留在進階群組、窄螢幕對話框順序不變（辨識引擎、雲端精修、精準模式），這樣折疊與手機搬移的邏輯（`mobileSettingsNodes`、`aria-controls`）不用改。目前值在 `updateTranslationDirection()`（語言選單變更、交換方向都會呼叫）與伺服器設定載入後更新。

### 收合摘要不再列引擎

**Supersedes**: ui-visual-polish / 收合摘要由現有的值計算

摘要只由雲端精修與精準模式組成：雲端精修勾選、可見且精準模式未勾選→「雲端精修」；精準模式勾選且可見→「精準模式」；以「、」連接，都沒有時「預設」。原決定把 `mai`→「雲端 MAI」、`hybrid`→「混合辨識」列入摘要，是因為引擎當時是使用者選的進階設定；現在引擎由語言決定、不是選擇，資料去向已由隱私標示顯示，摘要再列會讓人以為可以改。

### 兩種模式各用兩行說明，取代原本的單行附註

勾選框旁的 `<small>` 改為兩行（`.toggle-desc` 說做什麼與速度、`.toggle-fit` 說傳送什麼與適合情況）：

| 開關 | 第一行 | 第二行 |
| --- | --- | --- |
| 雲端精修 | 只改寫譯文：每句定稿後幾秒內由雲端大模型帶前後文重譯，原文不變 | 傳送文字到外部服務 · 適合辨識已正確、想要譯文更通順 |
| 精準模式 | 重新辨識再翻譯：語句結束後把音訊交給較準的辨識重新修字、斷句、翻譯，取代即時結果，約慢 10–25 秒 | 傳送音訊與文字到外部服務 · 適合重要會議、需要準確紀錄；已包含雲端精修 |

精準模式勾選時，雲端精修第二行改為「精準模式已包含，不需另外開啟」。`title` 滑鼠提示保留但改成與兩行相同的內容，不再是唯一說明來源。「約慢 10–25 秒」沿用現有 `#qualityRow` 的 `title` 文字（2026-11-14 精準模式評測時的估計，未在本 change 重新量測）。

## Implementation Contract

**行為：**

- 伺服器有 MAI 時，開會頁的進階裡「辨識引擎」是文字不是選單；語音語言選中文時顯示「本機模型（語橋主機）」，選日本語時顯示「雲端 MAI（音訊會傳送到 Azure）」，切換語言或按交換方向後立即更新。
- 開始會議時 `POST /api/meetings` 與串流標頭的 `engine`：MAI 有設定時，`ja` → `mai`，`zh`、`yue`、`auto`、`zh_ja` → `local`；MAI 未設定時一律 `local`。localStorage 裡舊的 `asrEngine` 值不影響結果。
- 隱私標示（`PrivacyNote.text(engine, ...)`）以上述實際引擎計算，語言切換後立即更新：例如沒有外部翻譯、沒有精修時，中文顯示「自架主機」，日本語顯示「雲端辨識／音訊會傳送到 Azure」。
- 進階收合摘要：只列「雲端精修」「精準模式」或「預設」。
- 雲端精修、精準模式的兩行說明在 1280px 與 390px（設定對話框內）都可見，文字如上表；精準模式勾選時雲端精修第二行變成「精準模式已包含，不需另外開啟」，取消後恢復。

**介面：** `asrEngine()` 回傳 `'local' | 'mai'`；新增 `engineForLanguage(language)`（同規則，供頁面與檢查腳本呼叫）；HTML 移除 `<select id="asrEngine">`，新增 `#asrEngineValue`；兩個開關內新增 `.toggle-desc`、`.toggle-fit`（雲端精修的第二行 id `cloudRefineFit`）。

**失敗情況：** `/api/config` 讀取失敗時視為沒有 MAI，引擎為 `local`、引擎欄位隱藏，與現在相同。

**驗收：**

- bench/ui_polish_e2e.mjs：改寫依賴 `#asrEngine` 選單的檢查（摘要表、窄螢幕對話框順序改用 `#asrEngineRow` 仍可見）；新增：中文／日文時 `#asrEngineValue` 文字與 `asrEngine()` 回傳值、交換方向後更新、隱私標示隨語言改變、開始會議送出的 `engine`、兩段說明在 1280px 與 390px 可見、精準模式勾選時雲端精修第二行改變。
- bench/translate_e2e.mjs：讀 `#asrEngine option` 與「約慢 1 秒」附註的檢查改為檢查唯讀引擎文字。
- 單元測試 `python -m unittest -q test_server` 全數通過（伺服器未改，確認沒有回歸）。

**範圍：** 只動 webapp/static/index.html、webapp/static/app.js、說明文字樣式所在的 CSS、上述兩支 bench 腳本與 bench/README.md。伺服器、成效指標頁、校對頁不動。

## Risks / Trade-offs

- [使用者無法再強制用 MAI 辨識中文，或強制全部本機避免音訊外送] → 中文本來就在本機；要完全不外送的會議，選中文類語言即可，引擎欄位會寫清楚。若之後有需求，再由管理員設定處理。
- [前端與伺服器各有一份語言清單] → 前端常數旁註明對應 `server.asr_engine()`；檢查腳本驗證各語言的結果。
- [說明文字變長，進階區塊變高] → 進階預設收合，展開才看到；手機在設定對話框內，不影響字幕區。
