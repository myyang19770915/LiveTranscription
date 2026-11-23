## 1. 驗收測試先寫

- [x] 1.1 新增 `bench/ui_night_celadon_e2e.mjs` 的骨架。
  - **結構**：沿用 `bench/audio_test_e2e.mjs` 的寫法（PLAYWRIGHT_MODULE、YUQIAO_SESSION、`t(name, got, want)`）。分成「純函式」與「頁面」兩段；純函式段在 node 直接 `require('webapp/static/setup-sentence.js')`。
  - **頁面段要驗的項目**：
    - Night and celadon palettes：例表 token 值，以及不載入網路字型。
    - Interface without decorative chrome：九個頁面沒有 `.ambient`、`.eyebrow`、全大寫文字，標題字重 ≤ 600。
    - Header links are plain text。
    - 之後各組任務補上的 sentence 與 live-session 檢查。
  - **限制**：開會狀態只能用 `page.evaluate(() => setControls(true))` 模擬，不能按開始；路由攔截 `**/api/meetings**` 的 POST，確保資料庫不會多出會議。
  - **驗證**：在尚未修改的程式上執行，token 值、eyebrow、header 三組檢查顯示 FAIL，證明這些檢查真的會抓到舊樣式。

## 2. 配色與字型

- [x] 2.1 [after: 1.1] 實作 Night and celadon palettes，照 design.md 的「沿用現有 token 名稱換值」。
  - **token 值**：`webapp/static/tokens.css` 深淺兩組換成 Design Source 表的值；新增 `--live`、`--live-text`、`--font-ui`、`--font-mono`；`--glow`、`--intro` 改成純色。
  - **字型**：`styles.css` 的 `body` 與其他寫死 `Inter, "Noto Sans TC"…` 的 `font-family` 改用 `var(--font-ui)`；等寬字改用 `var(--font-mono)`。照「兩個主題共用字型」。
  - **驗證**：`ui_night_celadon_e2e.mjs` 的 token 與網路字型檢查通過。
- [x] 2.2 [after: 2.1] 照「夜航的主色用米白，琥珀只標錄音中」與「青瓷的琥珀只當記號」，改用錄音色。
  - **改用 `--live` 的位置**：`.wave i`、`.level i`、`.status.live i`、測試音源中的 `.mic-meter i` 與 `.test-dot`、字幕的 `--sub-now`，原本都用 `--mint` 或 `--accent`。
  - **文字**：錄音色的文字用 `--live-text`。
  - **主按鈕**：`.primary` 在夜航呈米白底黑字、在青瓷呈綠底白字。
  - **驗證**：開會狀態（`setControls(true)`）下 `#level` 的 computed `background-color` 等於 `--live`；1440px 雙主題截圖人工確認主按鈕與連結都看得出可以點。

## 3. 拿掉裝飾、改頂端列

- [x] 3.1 [after: 2.1] 實作 Interface without decorative chrome。
  - **移除元素**：`index.html` 的 `.ambient` 兩個 div 及其樣式；各頁 html 的 `.eyebrow`（meetings、interpret、actions、metrics、admin、search、ask），以及首頁卡片的 `LIVE TRANSCRIPT`、`LIVE TRANSLATION` 標籤。
  - **改樣式**：`styles.css`、`refine.css`、`admin.css`、`login.css`、`topbar.css` 裡的 `text-transform: uppercase` 改成 `none`、字距歸零；`h1` 等標題字重降到 ≤ 600。
  - **保留**：各子頁標題文字不變。
  - **驗證**：`ui_night_celadon_e2e.mjs` 的裝飾檢查在九個頁面雙主題通過，且 `bench/ui_consistency_e2e.mjs` 仍全數通過（頁寬與主題切換不動版面）。
- [x] 3.2 [after: 2.1] 實作 Header links are plain text。
  - **樣式**：`topbar.css` 的頁面連結拿掉邊框與膠囊底色，非目前頁透明、文字 `--muted`；目前頁 `aria-current="page"` 用 `--field` 底色與 `--text`；hover 只換色與底色。
  - **不動**：連結順序與隱藏寬度不變。
  - **驗證**：`ui_night_celadon_e2e.mjs` 的 header 檢查通過，`bench/ui_consistency_e2e.mjs` 與 `bench/ui_review_e2e.mjs` 的導覽檢查仍通過。
- [x] 3.3 [after: 3.1] 舊要求 Pages keep their appearance after the token change 已在 delta spec 移除，處理受影響的既有 bench。
  - **做法**：搜尋 bench 裡比對舊顏色或舊頁首位置的斷言（例如 `ui_polish_e2e.mjs`、`ui_review_e2e.mjs`），只改定位與期望的色值，不刪行為斷言。
  - **驗證**：這兩個 bench 全數通過。

## 4. 即時會議頁：開會前的句子

- [x] 4.1 [after: 1.1] 新增 `webapp/static/setup-sentence.js`，照「句子由純函式組成，原生選單照舊」。
  - **介面**：輸出 `SetupSentence.compose(state)`，回傳 `[{text, field?}]`，措辭符合 Settings read as one sentence before a session 的例表八列。
  - **細節**：中文與拉丁字之間的空白規則照該規格；沒有團隊時寫「記進會議紀錄」。
  - **驗證**：`ui_night_celadon_e2e.mjs` 純函式段的八列例表全部通過。
- [x] 4.2 [after: 4.1, 3.1] 首頁顯示 Settings read as one sentence before a session。
  - **DOM**：`index.html` 的 `main > header` 換成 `h1#setupSentence` 加上保留的 `#privacyNote`，載入 `setup-sentence.js`。
  - **更新時機**：`app.js` 新增 `showSentence()`，在 `setLiveMode`、`updateTranslationDirection`、`updateSourceUI`、麥克風清單更新、團隊清單載入與 `#team`、`#interpretPlay` 的 change 時呼叫。
  - **樣式**：照 Design Source 的句子樣式（32px、最寬 960px）；760px 以下隱藏。
  - **驗證**：
    - `ui_night_celadon_e2e.mjs` 在 1440px 逐一切換例表設定，比對 `#setupSentence` 的文字。
    - 390px 時 `#setupSentence` 不可見。
    - `bench/privacy_e2e.mjs` 仍通過（資料去向仍可見）。
- [x] 4.3 [after: 4.2] 實作 Sentence words open their setting。
  - **行為**：有 `field` 的片段畫成 `button.sentence-pick`，`aria-label` 寫「更改語音語言」這類名稱；按下時 focus 對應控制項，`select` 再呼叫 `showPicker()`，失敗時用 try/catch 吞掉。
  - **驗證**：`ui_night_celadon_e2e.mjs` 按下團隊詞後 `document.activeElement.id === 'team'`、按下語言詞後為 `language`，而且 console 沒有錯誤。
- [x] 4.4 [after: 4.2] 設定區改成安靜的樣式（只在寬度大於 760px）。
  - **樣式**：欄位拿掉各自的藍框盒子，改成標籤加上細底線的原生選單；模式按鈕改成一組分段按鈕；測試音源的狀態仍在按鈕內。
  - **驗證**：
    - `bench/audio_test_e2e.mjs`（19 項）通過。
    - `bench/ui_polish_e2e.mjs` 通過（進階摺疊、會議情境、手機節點位置）；DOM 定位失效時只改定位。
    - 1440px 雙主題截圖存入 evidence。

## 5. 即時會議頁：會中

- [x] 5.1 [after: 4.2] 實作 A session folds the settings into a floating recorder bar，照「會中把「結束」搬進錄音列」。
  - **DOM**：`#liveBar` 最後加 `#liveActionSlot`。
  - **app.js**：新增 `placeStart()`（手機放 `#mobileActionSlot`；寬版且開會中放 `#liveActionSlot`；其他回到錨點），由 `syncMobileLayout()` 與 `setControls(active)` 呼叫；`setControls` 同時切換 `body.live-session`，並重畫一次不含按鈕的句子。
  - **CSS**：寬版 `body.live-session` 時隱藏 `section.controls`；`#liveBar` 用 `position: fixed` 置於底部中央（樣式照 Design Source 的錄音列）；`main` 底部預留錄音列高度加 32px；不做暫停鍵。
  - **驗證**：`ui_night_celadon_e2e.mjs` 在 1440×900 呼叫 `setControls(true)` 後：
    - `section.controls` 不可見，`#start` 在 `#liveBar` 內，`#liveBar` 是 `fixed`。
    - 捲到底後兩張卡片與 footer 按鈕的下緣都在錄音列上緣之上。
    - 呼叫 `setControls(false)` 後一切恢復。
    - 390px 時 `#start` 在 `#mobileActionSlot`，`#liveBar` 不是 `fixed`。
- [x] 5.2 [after: 5.1] 確認「結束收尾時錄音列不消失」。
  - **行為**：`#start` 在錄音列裡顯示「結束中…」時錄音列仍在。
  - **限制**：不修改 `stopMeeting()`（裡面有 faster-meeting-end 尚未提交的修改）。
  - **驗證**：`ui_night_celadon_e2e.mjs` 在 `setControls(true)` 後把 `#start` 的文字改成「結束中…」並設為 disabled，確認錄音列仍可見；`bench/meeting_end_e2e.mjs` 若能在本機執行，一併確認仍通過。
- [x] 5.3 [after: 2.1] 原文與翻譯卡片的標題只留中文（原文、`#targetLabel`），翻譯卡片拿掉 accent 染色；原文用 `--muted`、譯文用 `--text`。
  - **驗證**：
    - `bench/quality_e2e.mjs`（17 項）與 `bench/transcript_only_e2e.mjs` 通過。
    - 深色主題下 `#translation` 的 computed `color` 等於 `--text`。

## 6. 收尾驗證

- [x] 6.1 [after: 3.3, 4.4, 5.2, 5.3] 更新所有被修改的 css、js 在各頁 html 的 `?v=` 版本參數。
  - **驗證**：`grep` 確認每個被修改的檔案在引用它的 html 都換了新版本字串。
- [x] 6.2 [after: 6.1] 跑完整驗收。
  - **要跑的測試**：
    - `ui_night_celadon_e2e.mjs`
    - `ui_polish_e2e.mjs`、`ui_consistency_e2e.mjs`、`ui_review_e2e.mjs`
    - `audio_test_e2e.mjs`、`quality_e2e.mjs`、`transcript_only_e2e.mjs`、`privacy_e2e.mjs`
    - `node bench/qualitycheck.js`
    - `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server`
  - **驗證**：全部通過，並確認資料庫的會議數在測試前後相同。
- [x] 6.3 [after: 6.2] 截圖存到 `docs/spectra/changes/ui-night-celadon/evidence/`。
  - **畫面**：`/`（開會前、開會中模擬）、`/meetings`、`/login`，各有 1440px 雙主題與 390px 深色；另加一張團隊名 20 字的長句子截圖。
  - **人工確認**：句子最多四行、無水平捲動、連結可辨識、錄音列沒有蓋住文字。
  - **驗證**：evidence 資料夾內有上述截圖，並在任務回報中逐張說明檢查結果。

## 7. 設定區簡化（2026-11-23 追加）

- [x] 7.1 照 design.md 的「設定區只留必要的字」，實作 The spoken language decides the recognition engine、Advanced settings fold away by default 與 Narrow screens keep the settings dialog unchanged 的新版：辨識引擎列一律不顯示，進階只剩雲端精修和精準模式（寬版摺疊、手機對話框都一樣）。
  - **app.js**：`#asrEngineRow` 永遠 `hidden`，不論 `/api/config` 的 `mai`；`asrEngine()` 的引擎規則改由 `mai` 設定值判斷，不再讀這列是否隱藏，送出的 `engine` 不變。`mobileSettingsNodes` 拿掉這列。
  - **驗證**：
    - `ui_night_celadon_e2e.mjs` 新增：1440px 展開進階、390px 打開設定對話框，`#asrEngineRow` 都不可見。
    - `bench/ui_polish_e2e.mjs` 的引擎檢查改成只比對送出的 `engine` 與資料去向，不再讀列的文字；全數通過。
    - `bench/translate_e2e.mjs` 若讀 `#asrEngineValue` 或 `#modeNote`，改成讀送出的 `engine`。
- [x] 7.2 [after: 7.1] 實作 Cloud refinement and 精準模式 state what each does 與 The setup shows no explanatory small print。
  - **index.html／app.js**：拿掉 `#modeNote` 的文字顯示、欄位標籤裡的「選填」「例行會議」、`#start` 與 `#testMic` 的第二行 `small`、`.card-foot` 右側說明、`.toggle-desc`／`.toggle-fit`；雲端精修與精準模式的說明留在 `title`。選麥克風時 `#sourceHint` 隱藏，分頁／系統聲音時照舊顯示分享步驟。
  - **保留**：`#interpretLocked`、`#micStatus`、`#privacyNote`、`#storeNote`。
  - **驗證**：
    - `ui_night_celadon_e2e.mjs` 新增：1440px 與 390px 設定對話框中，上述元素都不可見；`#cloudRefineRow`、`#qualityRow` 的 `title` 含原本的說明；勾選精準模式後 `#privacyNote` 寫「音訊與文字會傳送到外部服務」。
    - `bench/ui_consistency_e2e.mjs` 的即時口譯按鈕說明檢查改成「沒有第二行」；`bench/ui_polish_e2e.mjs` 的說明文字檢查改成檢查 `title`。全數通過。
- [x] 7.3 [after: 7.2] 更新被修改檔案的 `?v=` 版本參數，重跑 6.2 的測試（`transcript_only_e2e.mjs` 會建立真的會議，不跑），重拍 evidence 截圖。
  - **驗證**：全部通過，資料庫會議數前後相同，evidence 的 `/` 截圖沒有辨識引擎列與說明小字。
