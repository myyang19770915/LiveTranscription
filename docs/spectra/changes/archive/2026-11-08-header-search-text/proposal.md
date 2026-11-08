## Why

頁首的導覽按鈕中，只有搜尋是放大鏡圖示，其餘（回到會議、待辦看板、成效指標、團隊管理、登出）都是文字按鈕，外觀不一致；圖示也比文字難辨認用途。

## What Changes

- webapp/static/account.js 產生的頁首搜尋連結改為文字「搜尋」，外觀與其他頁首按鈕相同；保留 `account-search` class、`/search` 連結、`title="搜尋（/）"` 提示與 `/` 快捷鍵；在搜尋頁本身仍不顯示。
- webapp/static/admin.css 與會議主頁用的 webapp/static/accounts.css 移除圖示專用的固定寬度、圓形與 svg 樣式。手機寬度（≤ 640px）仍顯示「搜尋」；文字按鈕比圖示寬約 10px，所以手機版頁首間距由 8px 收為 6px、按鈕左右內距由 11px 收為 9px，並直接隱藏空的使用者名稱欄位（原本只隱藏其中的 `<b>`，空欄位仍佔一個間距），400px 不橫向捲動。會議主頁（`/`）的手機版頁首比照其他頁面隱藏「團隊管理」，抵銷「搜尋」變寬的空間。
- 所有頁面的 account.js、admin.css，以及 index.html 的 accounts.css 版本參數更新，避免瀏覽器用舊檔。
- bench/search_e2e.mjs、bench/README.md、README.md 的「放大鏡／圖示」字樣改為「搜尋按鈕」，e2e 另外檢查按鈕文字，並在會議主頁 `/` 檢查同樣的外觀。

## Non-Goals

- 不把其他按鈕改成圖示，也不替所有按鈕加圖示：其他按鈕都是文字，改搜尋一個最小且一致。
- 不改頁首按鈕的順序與手機上隱藏哪些按鈕。
- 不處理 400px 以下品牌名稱「語橋 Live」換成兩行（改版前就是如此）。
- 不處理會議主頁手機版頁首原本就超出螢幕（改版前超出約 155px，「登出」與主題切換在畫面外；本變更後約 95px），需另行決定手機上保留哪些按鈕。

## Impact

- Affected specs: none（meeting-search 規格只寫「頁首的搜尋按鈕」，未指定圖示）
- Affected code:
  - New: (none)
  - Modified: webapp/static/account.js, webapp/static/admin.css, webapp/static/accounts.css, webapp/static/*.html（版本參數）, bench/search_e2e.mjs, bench/README.md, README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
