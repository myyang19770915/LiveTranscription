## 1. 驗收測試先寫

- [x] 1.1 新增 `bench/ui_sentence_menus_e2e.mjs`。
  - **結構**：沿用 `bench/ui_setup_collapse_e2e.mjs` 的寫法（PLAYWRIGHT_MODULE、YUQIAO_SESSION、`t()`、攔截 `**/api/meetings**` 的 POST）。不按開始。
  - **要驗的項目**：Sentence words open their setting 的四個情境（團隊選單、鍵盤選取、Esc 關閉、語音語言分組），即時口譯模式的同步播放譯音選單，欄位停用時不是按鈕；Microphone names are readable 的例表（以 `micName` 對三列名稱做檢查，並在頁面注入例表名稱的選項看句子）；The header gives the brand room 的三個情境。
  - **驗證**：在尚未修改的程式上執行，選單、麥克風名稱、頂端列三組都顯示 FAIL。

## 2. 句中選單

- [x] 2.1 [after: 1.1] 照「句中設定詞打開自己的選單」與「句中設定詞不再展開設定區」實作 Sentence words open their setting。
  - **sentence-menu.js（新檔）**：`SentenceMenu.open(button, control, onDone)`、`close()`；建立單一 `#sentenceMenu`，依 design.md 的定位、內容、鍵盤、選取與關閉規則。
  - **app.js**：`showSentence()` 的設定詞加 `aria-haspopup="listbox"`、`aria-controls="sentenceMenu"`，欄位停用時畫成文字；`#setupSentence` 的點擊改成 `SentenceMenu.open(...)`，不再呼叫 `setSetupMore`、`focus()` 或 `showPicker()`；句子重畫時呼叫 `SentenceMenu.close()` 以外的情況保留選單（選取後由 `onDone` 把焦點放回）。
  - **refine.css**：選單外觀（`--panel` 底、`--border` 細線、`--radius-card`、陰影；選項高 44px、15px；選中的打勾並用 `--accent-soft` 底；焦點框 2px `--accent`；分組標題 12px `--muted`）。
  - **index.html**：載入 `sentence-menu.js`。
  - **驗證**：`ui_sentence_menus_e2e.mjs` 的選單各項通過；`bench/ui_night_celadon_e2e.mjs` 與 `bench/ui_setup_collapse_e2e.mjs` 中「按設定詞 focus 欄位／展開設定」的斷言改成「打開 `#sentenceMenu`、設定區不展開」後全數通過。

## 3. 麥克風名稱與頂端列

- [x] 3.1 [after: 1.1] 照「麥克風名稱整理」實作 Microphone names are readable。
  - **app.js**：新增 `micName(label)`；`refreshMicrophones()` 的選項文字用它；`sentenceState()` 的 `micLabel` 去掉「（系統預設）」「（通訊）」。
  - **驗證**：`ui_sentence_menus_e2e.mjs` 的麥克風例表三列通過；`bench/audio_test_e2e.mjs` 通過。
- [x] 3.2 [after: 1.1] 照「頂端列放大」實作 The header gives the brand room。
  - **topbar.css**：寬度大於 700px 套用 design.md 表格的尺寸；700px 以下維持原本規則。
  - **驗證**：`ui_sentence_menus_e2e.mjs` 的頂端列三個情境通過；`bench/ui_consistency_e2e.mjs` 與 `bench/ui_review_e2e.mjs` 的導覽檢查（除了已知與本變更無關的「移除」按鈕兩項）通過。

## 4. 收尾驗證

- [x] 4.1 [after: 2.1, 3.1, 3.2] 更新各頁 html 中 `topbar.css`，以及 `index.html` 中 `app.js`、`refine.css`、`sentence-menu.js` 的 `?v=`，跑完整驗收。
  - **要跑的測試**：`ui_sentence_menus_e2e.mjs`、`ui_setup_collapse_e2e.mjs`、`ui_night_celadon_e2e.mjs`、`ui_polish_e2e.mjs`、`ui_consistency_e2e.mjs`、`audio_test_e2e.mjs`、`quality_e2e.mjs`、`privacy_e2e.mjs`、`interpret_e2e.mjs`、`node bench/qualitycheck.js`、`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server`。
  - **驗證**：全部通過，資料庫會議數前後相同。
- [x] 4.2 [after: 4.1] 截圖存到 `docs/spectra/changes/ui-sentence-menus/evidence/`：`/` 1440px 雙主題（句中選單打開）、`/meetings` 1440px 深色（頂端列）、`/` 390px 深色。
  - **人工確認**：選單貼在設定詞下方、不超出視窗；頂端列品牌明顯；手機頂端列沒變。
