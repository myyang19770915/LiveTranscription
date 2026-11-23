## Context

- **現有色彩**：前端色彩集中在 `webapp/static/tokens.css`，深淺兩組 token 包括 `--page`、`--panel`、`--border`、`--text`、`--muted`、`--faint`、`--field`、`--accent`、`--accent-ink`、`--accent-soft`、`--danger`、`--warn`、`--sub-now`、`--glow`、`--intro`。
  - `styles.css` 把 `--accent` 當成 `--mint`，用在主按鈕、焦點、音量條和小標。
  - 頁面樣式分散在 `styles.css`（壓縮成一行）、`refine.css`、`topbar.css`、`mobile.css`、`themes.css` 和各頁的 css。
- **即時會議頁 `/` 的現況**：
  - 頁首（`main > header`）有：
    - 英文小標 `REAL-TIME MULTILINGUAL MEETING`
    - 標題「專注對話，語言交給我們。」
    - 一句說明
    - 資料去向 `#privacyNote`
  - 下面是設定區 `section.controls`：模式按鈕、團隊、主題、系列、語言、方向、翻譯成、音訊來源、麥克風、測試音源、會議情境、進階，以及 `#start`。
  - 錄音中的狀態列 `section#liveBar` 有波形 `#wave`、`#activeMic`、音量 `#level`、計時 `#timer`。由 `setControls(active)` 切換 `.visible`，平常高度 0，開會時在設定區下方展開成一條 42px 的橫列。
- **手機版（`mobileQuery`：寬度 760px 以下，或橫放的觸控小螢幕）**：
  - `syncMobileLayout()` 把設定節點搬進 `#mobileSettingsFields` 對話框，把 `#start` 搬到 `#mobileActionSlot`，每個節點都留一個註解錨點，回到寬版時放回原處。
  - `mobile.css` 在手機上隱藏 `main > header` 和 `.ambient`。
- **各頁的英文大寫小標**：子頁頁首都有一個英文大寫 `.eyebrow`，例如 `MEETINGS`、`ACTIONS`、`TEAMS`、`MY RECORDS`、`METRICS`、`SEARCH`、`ASK`。首頁的兩張卡片標題前也有 `LIVE TRANSCRIPT`、`LIVE TRANSLATION`。
- **方向和評估**：2026-11-23 先研究同類產品、做出三個概念方向，使用者選了夜航配青瓷，再交給 Codex（gpt-6.2-sol）評估，修正如下：
  - 不做暫停：首頁只有開始和結束。
  - 句子要依模式說真話。
  - 會中保留資料去向、複製和字幕入口。
  - 兩個主題共用字型。
  - 逐句對齊延到下一個變更。
- **與另一個變更的衝突**：`webapp/static/app.js` 的工作區裡有另一個進行中變更 faster-meeting-end 的修改還沒提交，在 `stopMeeting()` 裡顯示「結束中…」。本變更也會修改 `app.js`。

## Design Source

- **來源**：2026-11-23 本對話產生的概念稿 HTML。網址參數 `?d=night` 或 `?d=celadon` 切換方向，加上 `&s=idle` 或 `&s=live` 切換畫面。這份稿是靜態 HTML，不是 Claude Design 的 `.dc.html`。
- **本機快取（不進版控）**：`.spectra/design-cache/ui-night-celadon/` 裡有：
  - `live.html`
  - `night-idle.png`、`night-live.png`、`celadon-idle.png`、`celadon-live.png`
  - `codex-review.txt`（Codex 評估全文）
- **概念稿與最終決定的差異**：下面的 Decisions 優先。
  - 概念稿把頁面左右留白設成 32px、導覽靠左，這次不採用。導覽位置與 1280px 共用框架照 visual-tokens 和 site-navigation 的現行規格。
  - 概念稿的原文、譯文同一列，以及暫停鍵，都不做。
  - 青瓷的霞鶩文楷不採用。

| 項目 | 夜航（dark） | 青瓷（light） |
| --- | --- | --- |
| `--page` 頁底 | `#111214` | `#f2f5f3` |
| `--panel` 卡片 | `#17181b` | `#ffffff` |
| `--field` 欄位、凸起面 | `#1f2024` | `#ffffff` |
| `--border` 細線 | `#2a2b30` | `#dce4df` |
| `--text` 主要文字 | `#ecedef` | `#14201b` |
| `--muted` 次要文字 | `#a3a5ac` | `#4b5a53` |
| `--faint` 輔助文字 | `#80838c` | `#66736d` |
| `--field-border` 欄位框 | `#45474d` | `#8a9892` |
| `--field-hover` | `#5c5f66` | `#66736d` |
| `--accent` 主色 | `#ecedef`（米白） | `#2e7a68`（青瓷綠） |
| `--accent-ink` 主色上的字 | `#111214` | `#ffffff` |
| `--accent-soft` | `#ecedef14` | `#2e7a6814` |
| `--live` 錄音中記號 | `#f2a93b` | `#d98a0b` |
| `--live-text` 錄音中文字 | `#f2a93b` | `#8a5300` |
| `--danger` | `#f2726b` | `#b3261e` |
| `--danger-soft` | `#f2726b1f` | `#b3261e14` |
| `--warn` | `#f2a93b` | `#8a5a00` |
| `--sub-now` 字幕正在講 | `#f2a93b` | `#8a5300` |
| `--glow`、`--intro` | 等於 `--page`（純色，不漸層） | 等於 `--page` |
| `--shadow-card` | `none` | `0 1px 2px rgb(20 32 27 / .05), 0 8px 24px rgb(20 32 27 / .05)` |

- **字型 token**（兩個主題相同）：
  - `--font-ui`：`"Segoe UI Variable Text", "Segoe UI", "Noto Sans TC", "Microsoft JhengHei UI", "PingFang TC", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`
  - `--font-mono`：`"Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace`
- **浮動錄音列**：
  - 位置：固定在視窗底部，距底 24px，水平置中。
  - 外觀：高 56px，圓角 `--radius-card`（14px），底色 `--field`，1px `--border` 細線；深色主題加 `0 12px 32px rgb(0 0 0 / .45)` 陰影，淺色主題用 `--shadow-card`。
  - 內容：左右內距 8px 到 20px，項目間距 16px。`#start` 與左邊的計時之間至少隔 16px，中間有一條 1px 分隔線。
- **開會前的句子**：字級 32px，行高 1.45，字重 400，最寬 960px，顏色 `--muted`。
  - 設定詞：顏色 `--text`、字重 500，底線 2px `--accent`（青瓷綠；夜航是米白）。
  - 會中縮成 17px、行高 1.6，設定詞不加底線。

## Goals / Non-Goals

**Goals:**

- 全站換成夜航（深色）和青瓷（淺色）兩套配色，所有頁面透過現有 token 一起換色。
- 拿掉英文大寫小標、背景光暈和全大寫加寬字距，標題字重最高 600。
- 頂端列連結改成純文字連結，位置和順序不變。
- 即時會議頁在寬度大於 760px 時：
  - 開會前用一句依模式寫出的真實設定當標題，設定詞可以跳到對應選單。
  - 開會時設定區收起，句子縮成一行摘要，「結束」移進浮動錄音列。逐字稿、複製、字幕入口、資料去向都不被遮住。
- 原文和翻譯卡片的標題只留中文，翻譯卡片不再染色。
- 設定區不顯示辨識引擎列和說明小字（見「設定區只留必要的字」）。

**Non-Goals:**

- **原文與譯文逐句對齊**（時間碼、語言標記、同一列）：留給下一個變更 `live-aligned-rows`。對齊要用穩定 ID 和時間範圍配對，不能按標點切兩份文字。字幕更新和 `render('transcript')` 綁在一起，精準模式還會合段，風險另外處理。
- **暫停功能**：首頁沒有暫停，這次不新增。
- **網路字型**（Google Fonts、霞鶩文楷等）：不下載，只用系統字型。
- **手機版（760px 以下）版面**：語言列、設定對話框、底部主按鈕和頁籤都不變，只換配色並拿掉裝飾。
- **浮動字幕視窗和「畫面＋字幕」的版面**：不改，只跟著換色。
- **導覽列位置與連結**：不改，site-navigation 的規則全部保留。
- **概念稿裡的左靠導覽、32px 頁邊距、`00:00:00` 空白列、裝飾波形**：不採用。

## Decisions

### 沿用現有 token 名稱換值

`tokens.css` 的深淺兩組保留原本的 token 名稱，只換數值（見 Design Source 表），另外新增 `--live`、`--live-text`、`--font-ui`、`--font-mono`。

- **好處**：所有頁面自動換色，不必逐頁改顏色。
- **捨棄的做法**：新建一套 token 名稱再逐頁遷移。要動四十多個 css 規則，而且換到一半時兩套並存，畫面會不一致。

### 夜航的主色用米白，琥珀只標錄音中

夜航的 `--accent` 是米白，所以主按鈕是米白底配黑字。琥珀色 `--live` 只用在錄音中的四個地方：

- 波形
- 音量條
- 狀態點
- 字幕「正在講」

原本用 `--accent` 的連結和焦點框變成米白，跟主文字同色。

- **理由**：重點色只留給「正在錄音」這件最重要的事，其他元素都安靜。
- **捨棄的做法**：夜航用琥珀當主色。主按鈕、連結和錄音全是琥珀，又回到「每樣都在搶眼」的老問題。

### 青瓷的琥珀只當記號

`#d98a0b` 在白底上的對比只有 2.5:1，不足以當文字色，所以拆成兩個 token：

- 記號（波形、點、音量條）用 `--live`（`#d98a0b`）。
- 文字用 `--live-text`（`#8a5300`，白底對比 6:1 以上）。

### 兩個主題共用字型

`body` 和所有頁面都用 `--font-ui`，時間與計數用 `--font-mono`。

- **理由**：visual-tokens 的「Switching the theme changes only colours」要求切換主題不能改變元素大小與位置。字型一換，換行就會變。
- **捨棄的做法**：青瓷的譯文改用霞鶩文楷。違反上面的規格；長時間閱讀和投影時細筆畫不好讀；中文網路字型在內網太重。

### 句子由純函式組成，原生選單照舊

新檔 `webapp/static/setup-sentence.js` 輸出 `window.SetupSentence = {compose}`，在 node 也能 `require`。

- **輸入**：`compose(state)` 讀一個設定物件。
- **輸出**：一串片段 `[{text, field?}]`，`field` 是要跳去的設定欄位 id。
- **組出的句子**：用「，」連接，結尾不加句號。
- **畫面**：`app.js` 在設定改變時呼叫它，把片段畫進 `#setupSentence`。有 `field` 的片段畫成 `<button type="button" class="sentence-pick" data-field="…">`，按下時：
  1. 對應的原生欄位取得焦點。
  2. 欄位是 `select` 而且瀏覽器支援 `showPicker()`，就打開選單；不支援時只給焦點，不報錯。
- **捨棄的做法**：在句子裡放自訂下拉選單。20 多種語言要另外處理搜尋、鍵盤、Esc、焦點返回和讀屏，Codex 也建議第一期用原生 `select`。

### 會中把「結束」搬進錄音列

`#liveBar` 新增一個空的 `#liveActionSlot`，放置 `#start` 的規則改成一個函式 `placeStart()`：

- 手機版：放在 `#mobileActionSlot`（不變）。
- 寬版且正在開會：放在 `#liveActionSlot`。
- 其他情況：回到原本的錨點。

`syncMobileLayout()` 和 `setControls(active)` 都呼叫 `placeStart()`。`body` 加上 `live-session` class 表示正在開會，寬版的 CSS 依這個 class 做三件事：

- 收起 `section.controls`。
- 讓 `#liveBar` 浮在底部。
- 在 `main` 底部預留錄音列的高度。

- **理由**：手機版已經在用同一套搬節點的做法（註解錨點加 `appendChild`）。按鈕還是同一個節點，所以事件、`stop` class 和「結束中…」文字都不用改。
- **捨棄的做法**：用 CSS 把 `#start` 固定定位到錄音列旁。兩個元素各自定位，視窗寬度一變就會錯開。

### 結束收尾時錄音列不消失

`setControls(false)` 要等 `stopMeeting()` 存檔完成才會呼叫，所以「結束中…／正在儲存」一直顯示在錄音列裡，直到收尾完成。這個時間點是現有行為，本變更不改。

### 設定區只留必要的字

**Supersedes**: engine-auto-and-mode-help / Cloud refinement and 精準模式 state what each does

2026-11-23 使用者看過實作後要求簡化：辨識引擎已經固定，不需要顯示；說明小字讓畫面更亂。

- **辨識引擎列**：`#asrEngineRow` 一律隱藏，寬版和手機都不出現。`asrEngine()` 的規則與送出的 `engine` 不變。音訊是否送到外部服務，原本也由 `#privacyNote` 和頁尾 `#secureLabel` 依引擎說明（`PrivacyNote.text`），所以拿掉這列不會少掉資料去向。
- **雲端精修、精準模式**：只顯示名稱。兩行說明改放在整列的 `title`，勾選後資料去向會跟著變（例如「精準模式／音訊與文字會傳送到外部服務」）。
- **拿掉的小字**：`#modeNote`、欄位標籤裡的 `span`（選填、例行會議）、`#start` 與 `#testMic` 的 `small`、逐字稿卡片 `.card-foot` 右側說明、選麥克風時 `#sourceHint` 的耳機提示（`#sourceHint` 在這時變空並隱藏）。
- **保留**：`#interpretLocked`（即時口譯不能用的原因）、分頁／系統聲音時 `#sourceHint` 的分享步驟、測試音源的狀態 `#micStatus`、資料去向、字數。
- **捨棄的做法**：只在寬版拿掉。手機的設定對話框同樣擠，使用者要的是整體簡化。

## Implementation Contract

**Behavior（使用者看到的結果）：**

- 任何頁面、任一主題，`getComputedStyle(document.documentElement)` 讀到的 token 值都等於 Design Source 表。頁面上沒有 `.ambient`、沒有英文大寫小標；`h1`、`h2`、`h3` 和品牌名的字重都不超過 600。
- 頂端列連結沒有邊框，非目前頁的背景透明，目前頁用 `--field` 底色。連結順序、隱藏寬度和頭像選單照 site-navigation。
- `/` 在寬度大於 760px、還沒開會時：
  - `#setupSentence`（`h1`）顯示依模式組出的句子，措辭見 meeting-setup-layout 的例表。
  - 句子在模式、語言、翻譯成、音訊來源、麥克風、團隊、同步播放譯音任何一項改變後立刻更新。
  - 資料去向 `#privacyNote` 仍然看得到。
- `/` 在寬度大於 760px、開會中（`setControls(true)` 之後）：
  - `section.controls` 不顯示。
  - 句子縮成一行文字，設定詞不能點。
  - `#liveBar` 固定在視窗底部，`#start`（顯示「結束會議／結束翻譯／結束口譯」）在 `#liveBar` 裡。
  - 頁面捲到底時，兩張逐字稿卡片的下緣和 footer 的按鈕都在錄音列上緣之上。
- 會議結束（`setControls(false)`）後一切恢復原狀，`#start` 回到設定區原位。
- 760px 以下的版面、節點位置和行為都和變更前一樣。

**Interface（介面）：**

- `SetupSentence.compose(state)`：
  - `state` 的欄位：`{mode:'meeting'|'translate'|'interpret', source, sourceLabel, target, targetLabel, audio:'microphone'|'system'|'mixed', micLabel, team, teamLabel, play}`
  - 回傳：`Array<{text:string, field?:'language'|'targetLanguage'|'audioSource'|'microphone'|'team'|'interpretPlay'}>`
- DOM：
  - `#setupSentence`：取代 `main > header` 裡的 `.eyebrow`、原本的 `h1` 和說明 `p`。
  - `#liveActionSlot`：`#liveBar` 的最後一個子元素。
  - `body.live-session`：開會中加上。

**Failure modes（出錯時）：**

- 拿不到團隊名稱（還在載入或沒有團隊）：句子寫「記進會議紀錄」，不顯示空白按鈕。
- `showPicker()` 拋錯或不存在：只給焦點，不跳錯誤訊息。
- 麥克風清單還沒有裝置名稱：用選單目前的文字（例如「系統預設麥克風」）。

**Acceptance（驗收）：**

- 新增 `bench/ui_night_celadon_e2e.mjs`，有兩個部分：
  - **純函式**：在 node 直接驗 `SetupSentence.compose` 的例表。
  - **頁面**：用 Playwright 開 `/` 和各子頁，驗 token 值、沒有裝飾、句子措辭、句中按鈕跳到選單、開會狀態的版面。開會狀態用 `page.evaluate(() => setControls(true))` 模擬，不真的開始會議，資料庫不會多出任何會議。
- 既有 bench 照常通過，只調整因 DOM 移動而失效的定位：`ui_polish_e2e.mjs`、`ui_consistency_e2e.mjs`、`audio_test_e2e.mjs`、`quality_e2e.mjs`、`transcript_only_e2e.mjs`、`privacy_e2e.mjs`。
- 伺服器 `python -m unittest -q test_server` 通過。
- 截圖存成變更的 evidence：`/`（開會前、開會中）、`/meetings`、`/login`，各有 1440px 雙主題和 390px 深色。

**Scope（範圍）：**

- 範圍內：
  - `webapp/static/` 的 css、`index.html`、`app.js`
  - 各子頁 html 的 `.eyebrow`
  - 新的 `setup-sentence.js`
  - bench 測試
- 範圍外：`webapp/server.py` 和所有 API、字幕與畫面＋字幕的版面、精準模式的資料流、逐句對齊。

## Risks / Trade-offs

- [`app.js` 裡有 faster-meeting-end 還沒提交的修改] → 實作只動 `setControls`、`syncMobileLayout`、新的 `placeStart` 和句子相關程式碼，不碰 `stopMeeting()`。提交時用 path-limited commit，先跟使用者確認 faster-meeting-end 的修改要先提交還是一起提交。
- [米白主色讓連結看不出可以點] → 連結保留底線，或維持既有的 hover 樣式。evidence 截圖逐頁檢查連結是否可辨識。
- [句子太長，換成三行以上] → 最寬 960px、字級 32px。evidence 用長團隊名（20 字）截圖確認，句子最多換四行，而且不出現水平捲動。
- [浮動錄音列在矮視窗（高 600px）蓋住內容] → `main` 底部預留錄音列高度加 32px，頁面可以捲到底。驗收以「捲到底時卡片下緣在錄音列上緣之上」為準。
- [移除英文小標後，各頁頁首的垂直位置改變] → visual-tokens 的「Pages keep their appearance after the token change」是舊變更 ui-visual-polish 的過渡要求，這次以 REMOVED 刪除。「One page width」和「Switching the theme changes only colours」照舊成立。
- [深色主題 `--accent` 改成米白，帶 accent 色的狀態（`.state-chip.active`、測試音源中）辨識度下降] → 錄音相關的狀態改用 `--live`；其餘狀態用文字表達。evidence 截圖檢查。

## Migration Plan

純前端樣式和頁面結構的修改，沒有資料遷移。各頁 html 裡被修改的 css、js 版本參數（`?v=`）要更新，避免瀏覽器用到舊快取。要回復時，直接 revert 這個 commit。

## Open Questions

無。範圍已經過使用者與 Codex 評估確認。
