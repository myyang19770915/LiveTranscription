## Context

- **稽核方式**：2026-11-24 用 modern-web-guidance v1.0.2 跑 `legacy-scan webapp/static`，共 29 項。逐項對照指南的 keepWhen／dropWhen 後，留下：
  - `ime-safe-enter-submit`：`series.js` 的 `#seriesName`。
  - `light-dismiss-a-dialog`：`app.js` 的 `#mobileSettings` 點背景關閉。
  - 另外針對選單查了 `viewport-aware-dropdowns` 與 `animate-to-from-top-layer`。
- **其餘 22 項 `dark-mode-toggle`**：各頁 `<head>` 已有 inline script 依 `localStorage['interpreter-theme']` 設 `data-theme`，`tokens.css` 依 `data-theme` 設 `color-scheme`，不會閃爍。深色優先是 ui-night-celadon 的產品選擇，所以不採用。
- **`js/copying-array-methods`、`declarative-dialog-popover-control`**：使用者看不到差別，不採用。
- **`#seriesName` 現況**：`onkeydown` 收到 `event.key==='Enter'` 就 `preventDefault()` 並 `createSeries()`（POST `/api/teams/{team}/series`）；收到 Escape 就還原選擇並收起新增列。兩者都沒檢查 `isComposing`。
- **`#sentenceMenu` 現況**（`sentence-menu.js`，ui-sentence-menus）：
  - `div[role=listbox][hidden]` 放在 body 末端，`position: fixed; z-index: 40`。
  - 自己監聽 document 的 capture pointerdown 判斷點外面；自己監聽 resize 與 scroll。
  - keydown 處理 ↑↓／Home／End／Enter／Space／Esc／Tab。
- **`.account-menu` 現況**（`account.js` 的 `ownAvatar()`）：
  - `div[role=menu][hidden]` 放在 `.account-me` 裡，`position: absolute` 貼在頭像下方（`topbar.css`）。
  - 打開時在 document 掛 pointerdown 與 keydown（只處理 Escape）。
  - 焦點不移進選單，沒有方向鍵。
  - 項目是 `button[role=menuitem]`，部分項目依視窗寬度用 CSS `display: none` 隱藏（`.menu-nav`、`.menu-phone`）。
- **`#mobileSettings` 現況**：`showModal()` 開啟。`app.js` 掛 click 監聽，依 `getBoundingClientRect()` 判斷點在框外就 `close()`。
- **ui-ux-pro-max 準則**（本專案 UI 改動都要查）：
  - 每個互動元件有清楚焦點框。
  - 焦點不能被固定元件遮住（Focus Not Obscured）。
  - 完整鍵盤操作，Tab 順序合理。
  - 微互動 150–300ms。

## Goals / Non-Goals

**Goals:**

- 用輸入法打例行會議名稱時，Enter 只確認選字，不會建立系列。
- 兩個選單交給瀏覽器的 Popover：放在最上層，點外面自動關閉。
- 頭像選單可以完全用鍵盤操作。
- 選單打開時有 150ms 淡入，尊重「減少動態效果」。
- 手機設定對話框點背景關閉，在支援的瀏覽器用 `closedby="any"`。

**Non-Goals:**

- CSS 錨點定位：Firefox 不支援（指南列出的支援只有 Chrome 157、Safari 27），保留 JS 定位。
- 主題跟隨系統、`<meta name="color-scheme">`、三段式主題切換。
- 選單的關閉動畫：`overlay` 只有 Chromium 支援，關閉維持立即消失。
- Popover polyfill：Popover 從 2025-01 起是 Baseline，不載入 polyfill。
- 其他對話框（`account.js` 的照片裁切、Email 對話框）與其他頁面的元件。
- 選單內容、項目順序、隱藏寬度（site-navigation 的規則不變）。

## Decisions

### 輸入法組字中的 Enter 與 Escape 不動作

`#seriesName` 的 keydown 開頭先判斷：`if(event.isComposing||event.keyCode===229)return;`

- 這時不 `preventDefault()`，讓輸入法自行確認選字或取消組字。
- `keyCode===229` 是指南建議的 Safari 補救：Safari 會先送 `compositionend`，`isComposing` 因此已經是 false。
- Escape 也一併判斷：組字中按 Esc 是取消組字，不應收起新增列。
- **捨棄的做法**：用 `compositionend` 的時間差判斷。比較複雜，指南也把它列為次選。

### 兩個選單用 popover="auto"，保留 JS 定位

- **建立**：`#sentenceMenu` 與 `.account-menu` 都在建立時 `setAttribute('popover','auto')`。指南提醒在 polyfill 情境不要用 IDL 屬性；本變更不用 polyfill，但用 `setAttribute` 一樣可行，也較明確。開關用 `showPopover()`／`hidePopover()`，取代 `hidden`。
- **定位**：popover 在 top layer 時，包含區塊是視窗。
  - 兩者都設 `position: fixed; inset: auto; margin: 0`，蓋掉 UA 預設的 `inset: 0; margin: auto` 置中。
  - 打開後用 JS 依觸發按鈕的 `getBoundingClientRect()` 設 `top`／`left`。
  - 句中選單沿用現有的 `place()`。
  - 頭像選單：`top = 按鈕下緣 + 6px`，右緣對齊按鈕右緣，左邊不小於 12px。
- **關閉的來源**：
  - 點外面：交給 popover 的 light dismiss，移除 `sentence-menu.js` 的 capture pointerdown 與 `account.js` 的 document pointerdown。
  - Esc：保留各自的 keydown 處理（先 `preventDefault()` 再關閉並把焦點還給觸發按鈕），確保焦點一定回到觸發按鈕。原生的 Esc 關閉不保證焦點回去。
  - 句中選單的 Tab、捲動、縮放視窗關閉照舊。頭像選單的 Tab 關閉並還焦點，捲動與縮放視窗也關閉。
- **狀態同步**：監聽 popover 的 `beforetoggle` 事件（實作時由 `toggle` 改為 `beforetoggle`：`toggle` 是非同步觸發，那時選單已隱藏、焦點已離開，無法再判斷焦點是否在選單裡）。`newState==='closed'` 時：
  - 把觸發按鈕的 `aria-expanded` 設成 `false`，清掉 opener。
  - 若焦點原本在選單裡（例如 light dismiss 時焦點還在選項上），把焦點還給觸發按鈕。
- **再按觸發按鈕會關閉**：選單開著時按觸發按鈕要關閉，而不是先被 light dismiss 關掉、click 又重新打開。
  - 打開時用 `showPopover({source: button})` 建立觸發關係，瀏覽器就不會把按觸發按鈕當成「點外面」。
  - 不支援 `source` 參數的瀏覽器會丟 TypeError：改呼叫無參數的 `showPopover()`，並在觸發按鈕掛 capture pointerdown，記下「這次按下時選單是開的」，接著的 click 只關閉、不重新打開。
- **頭像選單的鍵盤操作**（WAI-ARIA menu button 模式）：
  - 打開後焦點移到第一個看得見的 `[role=menuitem]`（`checkVisibility()` 為真）。
  - ↓／↑ 在看得見的項目間循環，Home／End 到頭尾。
  - Esc 關閉並把焦點還給頭像，Tab 關閉並把焦點還給頭像。
  - 在頭像上按 ↓ 或 Enter／Space 打開；按 ↓ 打開時焦點移到第一項，按 ↑ 打開時移到最後一項。
  - 錯誤訊息 `.account-menu-error` 不是 menuitem，不參與移動。
- **捨棄的做法**：
  - `popovertarget` 宣告式開關：頭像選單與句中選單打開前都要先產生內容與定位，仍需 JS，而且句中選單的觸發按鈕會隨句子重畫。
  - 錨點定位：見 Non-Goals。

### 選單打開時淡入 150ms

兩個選單的開啟狀態 `:popover-open`：`opacity: 1`，`@starting-style { opacity: 0 }`。

- 只有在 `@media (prefers-reduced-motion: no-preference)` 時，再加 `translate: 0 -4px` → `0` 的位移。
- 「減少動態效果」時：`styles.css`、`admin.css`、`login.css` 既有 `*{transition:none!important}`，淡入也一併取消，選單直接出現。這比只取消位移更保守，沿用不推翻（實作時發現，2026-11-24 修訂規格）。
- `transition: opacity 150ms ease-out, translate 150ms ease-out`。
- 關閉不做動畫：不轉場 `display` 與 `overlay`。
- 150ms 落在 ui-ux-pro-max 的微互動 150–300ms 範圍。用 `translate` 個別屬性，不影響其他 `transform`。

### 手機設定對話框用 closedby="any"

- `index.html` 的 `<dialog id="mobileSettings">` 加 `closedby="any"`。
- `app.js` 既有的點背景判斷改成只在 `!('closedBy' in HTMLDialogElement.prototype)` 時掛上（Safari 目前不支援）。
- `close` 事件的「停止測試音源」照舊，兩種關閉方式都會觸發。
- 對話框裡的原生 `select` 自己處理 Esc，不會誤關對話框。

## Implementation Contract

**Behavior（使用者看到的結果）：**

- 在 `/` 的新增系列欄位用輸入法組字時按 Enter：只確認選字，不送出 POST `/api/teams/{team}/series`，欄位保留。組字完成後再按 Enter 才建立。組字中按 Esc：新增列不收起。
- 按句中設定詞：`#sentenceMenu` 是 `popover="auto"` 且 `:popover-open`。其他行為照 meeting-setup-layout「Sentence words open their setting」：位置在詞下方、目前選項被選且有焦點、↑↓ Enter 選取、Esc／Tab／點外面關閉且值不變。
- 句中選單開著時再按同一個設定詞：選單關閉，不重新打開。
- 按頭像：`.account-menu` 是 `popover="auto"` 且打開，位置在頭像下方、右緣對齊。焦點在第一個看得見的項目；↓ 移到下一項，到最後一項後回到第一項；Esc 關閉並把焦點還給頭像；點外面關閉。
- 兩個選單打開的瞬間 `opacity` 從 0 轉到 1，共 150ms。
- 手機寬度（390px）打開設定對話框，點對話框外的背景：對話框關閉；若正在測試音源，測試停止。

**Interface（介面）：**

- `window.SentenceMenu = {open(button, control, onDone), close(refocus), isOpen()}` 介面不變。
- DOM：`#sentenceMenu[popover=auto][role=listbox]`；`.account-menu[popover=auto][role=menu]`；`#mobileSettings[closedby=any]`。
- 頭像按鈕 `aria-haspopup="menu"`、`aria-expanded` 隨開關變化。

**Failure modes（出錯時）：**

- 瀏覽器不支援 Popover（2025 年以前的版本）：`showPopover` 不存在時，退回原本的 `hidden` 切換加上手寫的點外面關閉。兩個選單共用一個小函式，判斷式為 `typeof HTMLElement.prototype.showPopover==='function'`。
- `showPopover({source})` 丟出 TypeError：改用無參數呼叫，並啟用觸發按鈕的 pointerdown 防重開（見 Decisions）。
- 不支援 `closedBy`：保留原本的點背景腳本。

**Acceptance（驗收）：**

- 新增 `bench/web_platform_polish_e2e.mjs`，攔截 `POST /api/teams/*/series` 與 `POST /api/meetings`（abort，不寫資料庫）：
  - 在 `#seriesName` 派送 `keydown {key:'Enter', isComposing:true}` 與 `{key:'Enter', keyCode:229}`：不發出 series POST。之後派送一般 Enter：發出一次 POST。
  - 句中選單：有 `popover="auto"`、`matches(':popover-open')`；點外面關閉；開著時再按同一詞會關閉；`getAnimations()` 打開後含 150ms 的 opacity 轉場。
  - 頭像選單：在 `/meetings` 1440px 打開，焦點在第一個看得見的 menuitem；↓、End、Home、Esc 的焦點位置正確；點外面關閉；在 900px 寬度下，↓ 會經過該寬度才出現的連結。
  - 390px 打開 `#mobileSettings`，點 (5,5) 背景：對話框關閉。
  - 「減少動態效果」開啟時，選單沒有位移（`translate` 計算值為 `none` 或 `0px 0px`）。
- 既有 bench 照常通過：`ui_sentence_menus_e2e`、`ui_setup_collapse_e2e`、`ui_night_celadon_e2e`、`ui_consistency_e2e`、`avatar_e2e`、`ui_review_e2e`（2 項既有失敗與本變更無關）、`audio_test_e2e`。
- `test_server` 單元測試照常通過，會議數不變。

**Scope（範圍）：**

- 範圍內：`series.js`、`sentence-menu.js`、`account.js`、`refine.css`、`topbar.css`、`app.js`（只動 `#mobileSettings` 的點背景關閉）、`index.html`、各頁 `?v=` 版本參數、新的 bench。
- 範圍外：伺服器、`stopMeeting()`（faster-meeting-end 未提交的修改）、主題切換、照片裁切與 Email 對話框。

## Risks / Trade-offs

- [頭像選單進了 top layer，不再跟著 `.account-me` 定位] → JS 依按鈕位置定位；捲動或縮放視窗時關閉，與句中選單一致。頂端列是 sticky，捲動時頭像位置不變，關閉只是保守做法。
- [`.account .account-menu button` 這類後代選擇器] → top layer 不改變 DOM 位置，選擇器照樣命中；依寬度隱藏的 `.menu-nav` 規則不變。
- [light dismiss 與觸發按鈕的 click 互相打架] → 用 `source` 建立觸發關係；不支援時用 pointerdown 防重開。bench 驗「開著時再按會關閉」。
- [Firefox 不轉場 display] → 本變更只做開啟淡入，不依賴 `display` 轉場。
- [`keyCode` 已被標為過時] → 指南明確建議與 `isComposing` 一起用，且只在 `key==='Enter'` 時檢查，不影響手機虛擬鍵盤。

## Migration Plan

純前端。更新 `index.html` 與各頁引用 `account.js`、`topbar.css` 的 `?v=` 版本參數；`sentence-menu.js`、`series.js`、`refine.css`、`app.js` 的參數只在 `index.html`。

## Open Questions

無。
