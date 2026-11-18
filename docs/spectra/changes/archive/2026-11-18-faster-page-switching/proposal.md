## Summary

點頂端列換頁時，連結立即畫出、資料與帳號資訊同時抓，滑鼠移到連結上就先在背景準備下一頁，讓換頁不再有「頂端列空一下、資料晚到」的延遲感。

## Motivation

使用者回報點不同分頁時載入有延遲。實測（本機、模擬 100 ms 網路延遲、快取已暖）：

- 伺服器各 API 只要 10–30 ms（量測：curl 三次），不是瓶頸。
- 點連結後約 150 ms 畫面出現，但頂端列的連結要等 `/api/me` 回來才由 `account.js` 畫出，約 370 ms 才出現，中間有約 0.2 秒頂端列是空的（量測：bench 式 Playwright 腳本，每頁兩輪）。
- 待辦看板、成效指標、搜尋、問答、首頁都等 `/api/me` 回來才開始抓自己的資料，形成「HTML → 帳號 → 資料」三輪排隊，資料約 370–500 ms 才到齊。
- 首頁對 `/api/config` 送兩次（`app.js`、`series.js` 各一次）。

## Proposed Solution

1. 頂端列先用「這個分頁上次知道的帳號」（sessionStorage）立即畫出，`/api/me` 回來後再更新；登出、未登入（401）時清除。
2. 各頁的資料請求與 `/api/me` 同時發出，不再排在它後面。
3. 首頁共用一次 `/api/config`。
4. 在支援的瀏覽器（Chrome、Edge）滑鼠停在頂端列連結上時先在背景預先載入那一頁（Speculation Rules，moderate），點下去幾乎立即顯示；不支援的瀏覽器維持原本行為。

## Non-Goals (optional)

見 design.md。

## Alternatives Considered (optional)

- 改成單頁應用（SPA）：改動太大，與現有各頁獨立的結構不合。
- 伺服器把帳號資訊直接寫進 HTML：每頁都要改成樣板輸出，改動較大；sessionStorage 做法只改一個共用腳本。

## Impact

- Affected specs: page-switching（新增）
- Affected code: webapp/static/account.js、webapp/static/actions.js、webapp/static/metrics.js、webapp/static/search.js、webapp/static/ask.js、webapp/static/app.js、webapp/static/series.js、webapp/static/meetings.html（會議列表的選單改用 `window.accountSoon`）、各頁 HTML 的 `?v=` 版本、bench/page_switching_e2e.mjs（新增）
