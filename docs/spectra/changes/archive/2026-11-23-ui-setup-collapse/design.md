## Context

- **ui-night-celadon（2026-11-23 封存）之後的即時會議頁 `/`**：
  - 頁首 `header.setup-head`：標題句子 `h1#setupSentence`（32px，最寬 960px，保留兩行高度）與資料去向 `.privacy`（`#privacyNote`，字約 10–11px）。
  - 設定區 `section.controls`：模式按鈕 `#modeRow`、這場會議（團隊、主題、系列）、語音與翻譯（語音語言、交換鈕 `#swap`、翻譯成、音訊來源、麥克風來源、測試音源 `#testMic`）、提示 `.hint-stack`、進階 `#setupAdvanced`（收合，記在 `setupAdvancedOpen`）與 `#refineGroup`（`#cloudRefineRow`、`#qualityRow`，各是一個 `label.field.toggle-field`）、會議情境、開始 `#start`。版面由 `refine.css` 的 `grid-template-areas` 決定。
  - 句子由 `showSentence()` 把 `SetupSentence.compose()` 的片段畫成文字與 `button.sentence-pick`；按下時 focus 對應控制項並 `showPicker()`。
  - 開會中 `body.live-session`：`section.controls` 隱藏，`#start` 搬進浮動的 `#liveBar`（`placeStart()`）。
  - 手機（`mobileQuery`）：設定節點搬進 `#mobileSettingsFields` 對話框，`#start` 在 `#mobileActionSlot`。
- **2026-11-23 在 https://asr.my-yang.online/ 1440×900 看到的問題**：見 proposal 的 Motivation。
- **既有決定**：
  - ui-visual-polish「進階收合用按鈕切換 class，不用 `<details>`」：本變更的「更多設定」沿用同一種做法。
  - ui-night-celadon「句子由純函式組成，原生選單照舊」：本變更不改 `SetupSentence.compose`，只改畫法。
  - ui-night-celadon「設定區只留必要的字」：開關只顯示名稱，說明留在 `title`。

## Goals / Non-Goals

**Goals:**

- 寬版開會前，第一個畫面看得到兩張逐字稿卡片的標題列；設定只露出一列。
- 句子中的設定詞仍能直接改設定，即使設定區收起。
- 雲端精修、精準模式佔一列中的兩顆小開關。
- 標題不在詞中間斷行；資料去向、交換鈕、測試音源狀態、手機語言標記都完整可讀。
- 會議紀錄、我的紀錄頁標題下沒有說明段落。

**Non-Goals:**

- 開會中的畫面、浮動錄音列。
- 手機（`mobileQuery`）的設定對話框與版面。
- 進階收合本身、設定值、送出的資料、資料去向的文字。
- `/admin` 的說明段落（管理員需要的團隊規則）。

## Decisions

### 設定收起時只留一列

`section.controls` 加上 class `setup-folded` 時（只在寬版、還沒開會），只顯示 `#modeRow`、新的 `#setupMore` 按鈕與 `#start`，其他子元素隱藏，整區變成一列 flex：模式按鈕靠左，「更多設定」接在模式之後，開始按鈕靠右。

- **按鈕**：`<button id="setupMore" type="button" aria-expanded aria-controls="setupFields">更多設定</button>`，放在 `#modeRow` 之後。`aria-controls` 指向一個 id 清單不實際，改成讓 `section.controls` 帶 `id="setupFields"`。
- **記憶**：`localStorage` 的 `setupMoreOpen`，`'1'` 為展開；讀不到或沒有值時收起。
- **手機**：`mobileQuery` 成立時不加 `setup-folded`，`#setupMore` 隱藏（設定在對話框裡，跟以前一樣）。
- **捨棄的做法**：用 `<details>` 包住設定。設定區是一個 grid，各節點還會被搬到手機對話框，包一層會打亂既有的搬移錨點；也違反 ui-visual-polish 的既有做法。

### 句中設定詞先展開再打開選單

`#setupSentence` 的點擊處理：如果設定區是 `setup-folded`，先展開（同按「更多設定」，也寫入 `setupMoreOpen='1'`），再 focus 控制項並 `showPicker()`。

- **理由**：原生控制項被 `display: none` 時無法取得焦點，也打不開選單。展開後記住，是因為使用者正在調整設定，下一次回來大概也還要看。

### 句子按分句排版

`showSentence()` 畫的時候，把「，」之間的每一段包在 `span.sentence-clause`（`display: inline-block; max-width: 100%`）裡，「，」放在前一段的結尾。

- **效果**：只在分句之間換行；分句比整行還長時，`inline-block` 內部仍會換行，不會撐出水平捲動。
- **不改** `SetupSentence.compose` 的輸出（純函式與例表測試照舊）。

### 雲端精修、精準模式是一列小開關

寬版時 `#refineGroup` 改成 `display: flex; gap: 8px; flex-wrap: wrap`。每個 `.toggle-field`：

| 項目 | 值 |
| --- | --- |
| 外框 | 高 36px，`border: 1px solid var(--border)`，`border-radius: var(--radius-pill)`，`padding: 0 14px 0 10px`，背景透明 |
| 開關 | `input[type=checkbox]` 用 `appearance: none`，28×16px 圓角軌道（`var(--field-border)`），內有 12px 圓點；勾選時軌道 `var(--accent)`、圓點 `var(--accent-ink)` 並移到右側 |
| 名稱 | 14px、字重 500、`var(--text)`；停用時整顆 `opacity: .5` |
| 焦點 | 開關 `:focus-visible` 時外框 `outline: 2px solid var(--accent)` |

- 只改寬版；手機對話框維持原本的勾選框列。

### 細節修正

- **資料去向**：`.setup-head` 改成 `align-items: flex-start`；`.privacy` 字級 13px（標籤 `b` 13px 字重 600），`margin-top` 讓它和句子第一行（32px × 1.45 ≈ 46px 行高）垂直置中。
- **交換鈕**：寬版 `.controls > .direction` 改回橫排（`flex-direction: row`，間距 6px），grid 欄寬從 58px 改成 92px。
- **測試音源狀態**：`.mic-test .mic-health > span:first-child` 允許換行（`white-space: normal`，`-webkit-line-clamp: 2`），不加省略號。
- **語言標記**：`.language-dot` 加 `white-space: nowrap`，寬度改成 `min-width` 讓「中⇄日」一行顯示（手機與寬版都適用）。
- **子頁說明**：刪掉 `meetings.html` 與 `interpret.html` 頁首的 `p.lead`。`interpret.html` 的 `#retention` 移到標題下的 `p.retention-note`（13px、`--muted`，空白時隱藏），因為 realtime-interpret 要求「我的紀錄」寫出紀錄保存天數。
- **標題換行**：`.setup-sentence` 另加 `text-wrap: balance`，讓兩行長度接近（ui-ux-pro-max `heading-line-balance`）。
- **收起時停止測試音源**：`setSetupMore(false)` 若測試音源進行中，先 `stopMicTest()`，與手機設定對話框關閉時一致。

## Implementation Contract

**Behavior（使用者看到的結果）：**

- `/` 在 1440×900、第一次來（沒有 `setupMoreOpen`）：
  - `section.controls` 有 `setup-folded`；看得到 `#modeRow` 的模式按鈕、`#setupMore`（`aria-expanded="false"`）與 `#start`；看不到團隊、語言選單、測試音源、進階、會議情境。
  - 兩張 `.transcript-card` 的 `.card-head` 下緣都在 900px 之內。
- 按 `#setupMore`：設定全部出現，`aria-expanded="true"`；重新整理後仍展開；再按一次收起。
- 收起時按句子裡的團隊名：設定展開，`document.activeElement` 是 `#team`。
- `#setupSentence` 的每個 `span.sentence-clause` 都不跨行斷在中間（除非該分句本身比一行寬）。
- 展開進階時，`#cloudRefineRow` 與 `#qualityRow` 的上緣相同、高度 36px；勾選與 `title` 行為照舊。
- `.privacy` 的字級 13px；`#swap` 的兩個 `.lang-tag` 在同一行；`#micStatus` 沒有被省略號截斷；`.language-dot` 只有一行。
- `/meetings`、`/interpret` 沒有 `p.lead`；`/admin` 仍有。
- 390px：設定對話框、語言列、底部開始按鈕的位置與內容和變更前一樣；`#setupMore` 不可見。

**Interface（介面）：**

- DOM：`section.controls#setupFields`、`button#setupMore`、`span.sentence-clause`。
- class：`section.controls.setup-folded`。
- localStorage：`setupMoreOpen`（`'1'`／`'0'`）。
- app.js：`showSetupMore()`（依記憶與 `mobileQuery` 設定 class 與 `aria-expanded`），由 `syncMobileLayout()` 與 `#setupMore` 的點擊呼叫。

**Failure modes（出錯時）：**

- localStorage 無法使用：每次都從收起開始，按鈕仍可展開，不報錯。
- 收起時團隊清單為空（沒有團隊）：句子寫「記進會議紀錄」，按開始的錯誤提示照舊。

**Acceptance（驗收）：**

- 新增 `bench/ui_setup_collapse_e2e.mjs`，用 Playwright 驗上面每一項；不按開始，`POST /api/meetings` 一律攔截，資料庫會議數不變。
- 既有 bench 因設定預設收起而失效的，只在開頁時設定 `setupMoreOpen='1'`（或先按 `#setupMore`），不改其他斷言：`ui_night_celadon_e2e.mjs`、`ui_polish_e2e.mjs`、`ui_consistency_e2e.mjs`、`audio_test_e2e.mjs`。
- 截圖存成 evidence：`/` 收起、展開（含進階）的 1440px 雙主題，390px 深色，`/meetings` 1440px 深色。

**Scope（範圍）：**

- 範圍內：`webapp/static/index.html`、`app.js`、`refine.css`、`mobile.css`、`meetings.html`、`interpret.html`，以及上述 bench。
- 範圍外：伺服器與 API、開會中的版面、手機對話框的內容、`/admin`。

## Risks / Trade-offs

- [收起後看不到測試音源，使用者開會前不測試] → 測試音源只在「更多設定」裡；開始後若沒收到聲音，現有的「還沒收到聲音」提示照常出現。
- [收起後看不到主題、系列，例行會議忘了選系列] → 句子不含主題與系列；這兩項本來就是選填。記住展開狀態，常用的人展開一次之後就一直看得到。
- [既有 bench 依賴設定區可見] → 只在開頁時設 `setupMoreOpen='1'`，斷言不變。
- [`app.js` 工作區有 faster-meeting-end 未提交的修改] → 不碰 `stopMeeting()`；提交時同 ui-night-celadon，只放本變更的部分。

## Migration Plan

純前端。更新 `index.html` 中 `refine.css`、`mobile.css`、`app.js` 的 `?v=`。要回復時 revert 這個 commit。

## Open Questions

無。
