## Summary

用 modern-web-guidance（Chrome、Edge、Firefox、MDN 共同維護的網頁平台指南）稽核前端後，修正四件事：

- 例行會議名稱遇到中文、日文輸入法時被提早建立。
- 句中選單與頭像選單改用瀏覽器內建的 Popover，頭像選單補上鍵盤操作。
- 兩個選單加上短暫淡入。
- 手機設定對話框的點外面關閉改用內建屬性。

## Motivation

- **輸入法 bug**：在 `/` 的「新增系列」欄位（`#seriesName`），`series.js` 一收到 Enter 就呼叫 `createSeries()`，沒有檢查 `event.isComposing`。用注音、倉頡或日文輸入法時，Enter 是「選字確認」，結果字還沒選完系列就建立了。例如要打「研發週會」，可能建出「研發ㄓㄡ」或「けんきゅう」。這是本系統主要使用者（中文、日文）每次都會遇到的問題。
- **頭像選單無法用鍵盤操作**：選單宣告了 `role="menu"`，打開時焦點卻不會移進去，方向鍵也沒作用。讀屏軟體會說這是選單，使用者卻無法照選單的方式操作。
- **兩個選單各自手寫關閉邏輯**：點外面關閉與 Esc 都是自己寫的（`sentence-menu.js` 的 pointerdown／scroll，`account.js` 的 pointerdown／keydown）。瀏覽器內建的 Popover（`popover="auto"`）原生就有這兩種關閉方式，並放在最上層（top layer），不會被浮動錄音列或其他 `z-index` 蓋住。
- **選單出現得太突兀**：選單一瞬間出現。指南建議用 `@starting-style` 做短暫淡入，並尊重「減少動態效果」設定。
- **手機設定對話框**：`#mobileSettings` 用一段手寫腳本判斷是否點在背景上。指南建議改用 `closedby="any"`，只在不支援的瀏覽器（Safari）保留舊腳本。

## Proposed Solution

- `series.js`：`#seriesName` 的 Enter 與 Escape 在 `event.isComposing` 或 `event.keyCode === 229` 時不動作，讓輸入法自己處理。
- `sentence-menu.js`：
  - `#sentenceMenu` 加 `popover="auto"`，用 `showPopover()`／`hidePopover()` 開關，改由 `beforetoggle` 事件同步 `aria-expanded`。
  - Esc 與點外面關閉交給瀏覽器。
  - 定位、listbox 鍵盤操作、Tab 關閉、捲動或縮放視窗時關閉，都照舊。
- `account.js`：
  - `.account-menu` 加 `popover="auto"`，打開時焦點移到第一個看得見的項目。
  - ↑↓ 在看得見的項目間循環，Home／End 跳到頭尾。
  - Esc 或 Tab 關閉並把焦點還給頭像。
  - 因為選單進了 top layer，位置改由 JS 依頭像按鈕計算。
- `refine.css`、`topbar.css`：兩個選單打開時從透明淡入，並往下滑 4px，共 150ms；「減少動態效果」開啟時只淡入，不位移。
- `index.html`、`app.js`：`#mobileSettings` 加 `closedby="any"`；舊的點背景關閉腳本只在 `!('closedBy' in HTMLDialogElement.prototype)` 時才掛上。

## Non-Goals (optional)

（寫在 design.md 的 Goals / Non-Goals。）

## Alternatives Considered (optional)

- **CSS 錨點定位（anchor positioning）取代 JS 定位**：Firefox 還不支援，不支援的瀏覽器仍要保留 JS 定位，等於維護兩套，所以不採用。
- **主題預設跟隨系統（`<meta name="color-scheme">`）**：深色優先是產品設計，而且每頁 `<head>` 已有 inline script 依記憶的主題設定 `data-theme`，不會閃爍，所以不改。

## Impact

- Affected specs: meeting-series, site-navigation, meeting-setup-layout, visual-tokens
- Affected code:
  - Modified: webapp/static/series.js, webapp/static/sentence-menu.js, webapp/static/account.js, webapp/static/refine.css, webapp/static/topbar.css, webapp/static/app.js, webapp/static/index.html, 各頁 html 的 `?v=` 版本參數（webapp/static/*.html）
  - New: bench/web_platform_polish_e2e.mjs
  - Removed: none
