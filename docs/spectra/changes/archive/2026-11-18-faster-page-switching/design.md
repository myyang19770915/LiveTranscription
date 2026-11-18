## Context

每一頁都是獨立的 HTML，頂端列由共用的 `webapp/static/account.js` 在 `/api/me` 回來後畫出（`window.accountReady`）。各頁腳本再等 `window.accountReady` 才抓自己的資料。靜態檔已有一個月快取（response-headers），伺服器 API 本機只要 10–30 ms。延遲來自前端的排隊：模擬 100 ms 延遲時，點連結後約 150 ms 畫面出現、約 370 ms 頂端列連結出現、約 370–500 ms 資料到齊（量測腳本見 tasks 的驗證任務）。

## Goals / Non-Goals

**Goals:**

- 換頁時頂端列連結與畫面同時出現（在同一分頁看過任一頁之後）。
- 各頁資料不再排在 `/api/me` 之後。
- 首頁不重複請求 `/api/config`。
- Chrome、Edge 中滑鼠停在頂端列連結上時先在背景準備下一頁，點下去幾乎立即顯示。

**Non-Goals:**

- 不改成單頁應用，也不改伺服器（API、HTML 輸出、快取標頭都不動）。
- 不處理 `/meetings/<id>` 等會議頁內部的載入速度。
- 不預先載入頂端列以外的連結（例如會議列表中的會議）。
- 帳號快取不作為權限依據：伺服器照舊檢查每個請求。

## Decisions

### 頂端列先用這個分頁上次的帳號畫出

`account.js` 把 `/api/me` 的回應存在 `sessionStorage`（鍵 `yq-me`，只在這個分頁、關閉即消失）。載入時若有存檔，立刻用它畫頂端列；`/api/me` 回來後存新值，內容不同才重畫。401 與登出時刪除存檔。`window.accountReady` 的意義不變（仍是伺服器回來的帳號）；新增 `window.accountSoon`：有存檔時立即給存檔，否則等同 `accountReady`。選用 sessionStorage 而非 localStorage：別的分頁或別人換帳號登入時不會沿用。

### 各頁資料與帳號同時抓

成效指標的資料不需要帳號，直接載入。待辦看板、搜尋、問答、首頁的團隊選單改用 `window.accountSoon`；帳號只用於下拉選單與介面上是否顯示可切換的開關，權限仍由伺服器判斷。待辦看板在 `accountReady` 回來後更新 `me`。

### 首頁共用一次設定請求

`app.js` 建立 `window.appConfig`（`/api/config` 的 promise），`series.js` 改用它。

### 滑鼠停在頂端列連結上時預先載入

`account.js` 畫好連結後在 `<head>` 加一次 `<script type="speculationrules">`：`prerender`，條件為 `#account a.nav-link` 且不是 `.current`，`eagerness: "moderate"`（滑鼠停留約 200 ms 或按下時開始）。只有支援的瀏覽器（Chromium）會執行，其他瀏覽器忽略。被預先載入的頁面只做 GET 請求；首頁的服務檢查在頁面隱藏時本來就不執行，麥克風、螢幕常亮只在按下開始後才要求。

### 預先準備的頁面在顯示時重新抓資料

被預先準備的頁面可能在很久之後才顯示，期間在別頁的修改（例如待辦看板改狀態後再看成效指標）不能被舊資料蓋住。`account.js` 提供 `window.onPageShown(fn)`：只在 `document.prerendering` 為真時，於 `prerenderingchange` 呼叫 `fn`。會議紀錄、我的紀錄、待辦看板、成效指標、團隊管理（成員與口譯權限）各自註冊重新載入。首頁的服務狀態本來就在頁面變為可見時重新檢查；搜尋、問答開啟時不載入結果。

## Implementation Contract

- 行為：同一分頁看過任一頁後，點頂端列連結時，下一頁第一次畫面就有頂端列連結（目前頁醒目）；資料請求在 HTML 之後立即發出，不等 `/api/me`；首頁 `/api/config` 只請求一次；Chromium 中滑鼠停在連結上時瀏覽器以 `Sec-Purpose: prefetch;prerender` 請求那一頁（被 DevTools 控制的瀏覽器不會啟用預先載入的頁面，`PrerenderingDisabledByDevTools`，所以自動測試只驗證請求已發出）。
- 介面：`window.onPageShown(fn)`；`sessionStorage['yq-me']` 存 `/api/me` 的 JSON；`window.accountSoon: Promise<me>`；`window.appConfig: Promise<config>`；speculation rules 只插入一次（`script#yq-prerender`）。
- 失敗情形：sessionStorage 無法使用時照舊等 `/api/me`；存檔 JSON 壞掉時刪除並照舊；`/api/me` 回 401 時刪除存檔並導向登入頁（與現在相同）；不支援 speculation rules 的瀏覽器照舊整頁載入。
- 驗收：`bench/page_switching_e2e.mjs`（新增）在模擬 100 ms 延遲下量測並斷言上述行為；既有 bench（ui_consistency_e2e、interpret_e2e、privacy_e2e、ui_polish_e2e、actions_e2e、metrics_e2e）與 `test_server` 仍通過。
- 範圍：只改 `webapp/static/` 的前端腳本與 HTML 的 `?v=` 版本，以及新增 bench。

## Risks / Trade-offs

- 換帳號但沒有登出（例如 session 過期後另一人在同一分頁登入）：登入前一定經過 401，存檔已刪除。
- 存檔的團隊清單可能比伺服器舊（剛被加入新團隊）：`accountReady` 回來後頂端列會更新，下拉選單在下一次載入時更新；伺服器仍檢查權限。
- 預先載入會多發出 GET 請求（每次停留一頁的份量，伺服器本機 10–30 ms），可接受。
