## 1. 驗收測試先寫

- [x] 1.1 新增 `bench/ui_setup_collapse_e2e.mjs`。
  - **結構**：沿用 `bench/ui_night_celadon_e2e.mjs` 的寫法（PLAYWRIGHT_MODULE、YUQIAO_SESSION、`t(name, got, want)`、攔截 `**/api/meetings**` 的 POST）。不按開始。
  - **要驗的項目**：design.md Implementation Contract 的 Behavior 每一項，對應 The setup folds behind 更多設定 before a session、The sentence breaks only between its clauses、Advanced options are compact switches on one row、Setup details read in full、Sentence words open their setting（收起時按句中詞）、List pages carry no lead paragraph。
  - **驗證**：在尚未修改的程式上執行，收起、分句、小開關、細節、子頁說明各組都顯示 FAIL。

## 2. 設定收起

- [x] 2.1 [after: 1.1] 照「設定收起時只留一列」實作 The setup folds behind 更多設定 before a session。
  - **index.html**：`section.controls` 加 `id="setupFields"`；`#modeRow` 之後加 `<button id="setupMore" type="button" class="setup-more" aria-expanded="false" aria-controls="setupFields">更多設定</button>`。
  - **app.js**：新增 `showSetupMore()`，依 `setupMoreOpen` 與 `mobileQuery` 切換 `section.controls.setup-folded`、`#setupMore` 的 `aria-expanded` 與 `hidden`；由 `syncMobileLayout()` 與 `#setupMore` 的點擊呼叫，點擊時寫入 `setupMoreOpen`（try/catch）。`#setupMore` 不放進 `mobileSettingsNodes`。
  - **refine.css**（寬版）：`.controls.setup-folded` 改成一列 flex，只顯示 `#modeRow`、`#setupMore`、`#start`；`#setupMore` 是安靜的文字按鈕加箭頭；`#start` 靠右。
  - **驗證**：`ui_setup_collapse_e2e.mjs` 的收起、展開、記憶、390px 各項通過；`bench/ui_night_celadon_e2e.mjs` 開頁前設 `setupMoreOpen='1'` 後全數通過。
- [x] 2.2 [after: 2.1] 照「句中設定詞先展開再打開選單」修改 Sentence words open their setting。
  - **app.js**：`#setupSentence` 的點擊處理在 focus 前，若 `section.controls` 是 `setup-folded`，先展開並寫入 `setupMoreOpen='1'`。
  - **驗證**：`ui_setup_collapse_e2e.mjs` 收起狀態按團隊名後 `#setupMore` 為 `aria-expanded="true"`、`document.activeElement.id === 'team'`。

## 3. 句子與細節

- [x] 3.1 [after: 1.1] 照「句子按分句排版」實作 The sentence breaks only between its clauses。
  - **app.js**：`showSentence()` 把片段依「，」分組，各包進 `span.sentence-clause`，「，」留在前一組結尾；`SetupSentence.compose` 不改。
  - **refine.css**：`.sentence-clause { display: inline-block; max-width: 100%; }`。
  - **驗證**：`ui_setup_collapse_e2e.mjs` 的長團隊名檢查通過；`ui_night_celadon_e2e.mjs` 的句子文字檢查仍通過（`textContent` 不變）。
- [x] 3.2 [after: 2.1] 照「雲端精修、精準模式是一列小開關」實作 Advanced options are compact switches on one row（只在寬版）。
  - **refine.css**：`#refineGroup` 改成 flex 一列；`.toggle-field` 照 design.md 的表格畫成 36px 膠囊與 28×16px 開關。
  - **驗證**：`ui_setup_collapse_e2e.mjs` 展開進階後兩列同高同頂、高 36px；`bench/ui_polish_e2e.mjs`（開頁前設 `setupMoreOpen='1'`）全數通過。
- [x] 3.3 [after: 2.1] 照「細節修正」實作 Setup details read in full。
  - **refine.css／mobile.css**：資料去向 13px 並與句子第一行置中；`#swap` 橫排、grid 欄寬 92px；`#micStatus` 可換兩行、不截斷；`.language-dot` 不換行。
  - **驗證**：`ui_setup_collapse_e2e.mjs` 的細節檢查在 1440px 與 390px 通過；`bench/audio_test_e2e.mjs`（開頁前設 `setupMoreOpen='1'`）全數通過。
- [x] 3.4 [after: 1.1] 實作 List pages carry no lead paragraph：刪掉 `meetings.html`、`interpret.html` 頁首的 `p.lead`，`admin.html` 不動。
  - **驗證**：`ui_setup_collapse_e2e.mjs` 的子頁檢查通過；`bench/ui_consistency_e2e.mjs`（開頁前設 `setupMoreOpen='1'`）全數通過。

## 4. 收尾驗證

- [x] 4.1 [after: 2.2, 3.1, 3.2, 3.3, 3.4] 更新 `index.html` 中 `refine.css`、`mobile.css`、`app.js` 的 `?v=`，跑完整驗收。
  - **要跑的測試**：`ui_setup_collapse_e2e.mjs`、`ui_night_celadon_e2e.mjs`、`ui_polish_e2e.mjs`、`ui_consistency_e2e.mjs`、`audio_test_e2e.mjs`、`quality_e2e.mjs`、`privacy_e2e.mjs`、`node bench/qualitycheck.js`、`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server`。
  - **驗證**：全部通過，資料庫會議數前後相同。
- [x] 4.2 [after: 4.1] 截圖存到 `docs/spectra/changes/ui-setup-collapse/evidence/`：`/` 收起與展開（含進階）的 1440px 雙主題、390px 深色、`/meetings` 1440px 深色。
  - **人工確認**：首屏看得到兩張卡片標題列、句子不在詞中間斷行、開關不佔半列。
