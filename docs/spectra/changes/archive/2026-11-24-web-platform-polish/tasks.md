## 1. 輸入法安全的系列名稱（設計：輸入法組字中的 Enter 與 Escape 不動作）

- [x] 1.1 新增 `bench/web_platform_polish_e2e.mjs` 的骨架（登入 cookie、攔截並 abort `POST /api/meetings` 與 `POST /api/teams/*/series`、記錄 series 請求數），加入 meeting-series「Naming a new series works with input methods」表格中的五種 keydown 檢查。改程式前先跑一次，確認 `isComposing:true` 的 Enter 會發出請求（失敗符合預期）。
- [x] 1.2 `series.js` 的 `#seriesName` keydown 在 `event.isComposing||event.keyCode===229` 時直接 return，Enter 與 Escape 都適用。驗證：1.1 的五種檢查全部通過。[after: 1.1]

## 2. 句中選單改用 Popover

- [x] 2.1 meeting-setup-layout「The sentence menu is a popover」— `sentence-menu.js`：
  - `#sentenceMenu` 建立時 `setAttribute('popover','auto')`，開關改用 `showPopover({source: button})`（TypeError 時退回無參數加 pointerdown 防重開）／`hidePopover()`。
  - 不支援 `showPopover` 時退回 `hidden` 切換與手寫的點外面關閉。
  - 移除 capture pointerdown 的點外面判斷。
  - `beforetoggle` 事件在 closed 時同步 `aria-expanded`，焦點在選單內時還給設定詞。
  - Esc、Tab、捲動、縮放視窗的行為不變。
  - 驗證：bench 檢查 `popover="auto"`、`:popover-open`、點外面關閉、開著再按同一詞會關閉；`ui_sentence_menus_e2e.mjs` 24 項照常通過。[after: 1.1]
- [x] 2.2 `refine.css`：`.sentence-menu` 設 `inset: auto; margin: 0`，蓋掉 popover 的 UA 置中，JS 設的 `top`／`left` 才生效。把 `.sentence-menu[hidden]` 規則改成同時適用 `:not(:popover-open)` 的退回情況。驗證：1440px 深淺兩色截圖中，選單在詞下方 8px 內；`ui_sentence_menus_e2e.mjs` 的位置檢查通過。[after: 2.1]

## 3. 頭像選單改用 Popover 並補上鍵盤操作

- [x] 3.1 `account.js` 的 `ownAvatar()`：
  - `.account-menu` 加 `popover="auto"`，打開時依頭像按鈕位置設 `top`／`left`（右緣對齊頭像，左邊不小於 12px）。
  - 移除 document 的 pointerdown 監聽，改由 light dismiss 關閉；`beforetoggle` 事件同步 `aria-expanded`。
  - 開著時再按頭像會關閉（`source` 或 pointerdown 防重開）。
  - 捲動或縮放視窗時關閉。
  - 驗證：bench 在 `/meetings` 1440px 檢查 `:popover-open`、位置在頭像下方、點外面關閉、再按頭像關閉；`avatar_e2e.mjs` 照常通過。[after: 1.1]
- [x] 3.2 site-navigation「The avatar menu works from the keyboard」— `account.js` 的鍵盤操作：
  - 打開時焦點到第一個看得見的 menuitem（用 `checkVisibility()` 判斷）。
  - ↑↓ 循環、Home／End 到頭尾、Esc 與 Tab 關閉並還焦點給頭像。
  - 在頭像上按 ↓／↑ 打開並聚焦第一項或最後一項。
  - 驗證：bench 的 End→↓→Esc 順序檢查，以及 900px 下 ↓ 走過每個看得見的項目、不經過隱藏項目。[after: 3.1]
- [x] 3.3 `topbar.css`：`.account-menu` 從 `position: absolute` 改成 `position: fixed; inset: auto; margin: 0`；`.account-menu[hidden]` 規則同時涵蓋退回情況。後代選擇器 `.account .account-menu button` 不變。驗證：`ui_consistency_e2e.mjs` 與 `ui_review_e2e.mjs` 結果與變更前相同（ui_review 的 2 項既有失敗除外）；`/meetings` 1440px 與 390px 的頭像選單截圖。[after: 3.1]

## 4. 選單淡入

- [x] 4.1 visual-tokens「Menus fade in when they open」— `refine.css` 與 `topbar.css`：兩個選單的開啟狀態加 `@starting-style { opacity: 0 }`，`transition: opacity 150ms ease-out`；`prefers-reduced-motion: no-preference` 時再加 `translate: 0 -4px` → `0` 的 150ms 轉場。不轉場 `display` 與 `overlay`。驗證：bench 打開後 `getAnimations()` 含 duration 150 的 opacity 轉場；用 `reducedMotion: 'reduce'` 的 context 打開時 `translate` 計算值為 `none`。[after: 2.2, 3.3]

## 5. 手機設定對話框點背景關閉

- [x] 5.1 meeting-setup-layout「The settings dialog closes on a tap outside」— `index.html` 的 `#mobileSettings` 加 `closedby="any"`；`app.js` 的點背景判斷只在 `!('closedBy' in HTMLDialogElement.prototype)` 時掛上；`close` 事件停止測試音源的處理不變。驗證：bench 在 390px 打開對話框、點 (5,5) 後 `open` 為 false；另在頁面載入前刪除 `HTMLDialogElement.prototype.closedBy`，再跑同一項檢查，退回腳本也能關閉。[after: 1.1]

## 6. 收尾

- [x] 6.1 更新 `index.html` 中 `series.js`、`sentence-menu.js`、`app.js`、`refine.css` 的 `?v=`，以及各頁 `account.js`、`topbar.css` 的 `?v=`。驗證：`grep` 各頁版本參數一致，瀏覽器載入新檔。[after: 2.2, 3.3, 4.1, 5.1]
- [x] 6.2 跑完整驗收：
  - `bench/web_platform_polish_e2e.mjs`。
  - 既有 bench：`ui_sentence_menus_e2e`、`ui_setup_collapse_e2e`、`ui_night_celadon_e2e`、`ui_consistency_e2e`、`avatar_e2e`、`ui_review_e2e`、`audio_test_e2e`。
  - `test_server` 單元測試。
  - 會議數前後相同。
  - 截圖存到 change 的 evidence。
  - 驗證：全部通過，ui_review 只剩 2 項既有失敗。[after: 6.1]
