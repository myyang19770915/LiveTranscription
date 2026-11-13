## Why

登入後一律回到開會頁。紀要信的「開啟紀要」與提醒信的看板連結，只要 session 過期（12 小時）就會在登入後落在開會頁，使用者得回信箱再點一次。2026-11-13 的站台稽核實測確認：未登入開 `/meetings` 被轉到 `/login`，網址沒有帶回原路徑。

## What Changes

- 未登入開啟頁面時，轉址改為 `/login?next=<原本的路徑與查詢字串>`；原本就是 `/` 時維持 `/login`。
- 頁面上的程式發現登入失效（`/api/me` 等回 401、辨識連線以 4401 關閉）而轉到登入頁時，同樣帶上目前頁面的路徑。
- 登入成功後前往 `next` 指定的頁面，並保留網址的 `#` 片段；`next` 不是本站的相對路徑時一律回 `/`。
- 判斷 `next` 是否可用的規則放在一個可單獨測試的純函式模組。

## Non-Goals (optional)

- 不接受完整網址形式的 `next`（含 `https://本站/...`）：只接受以單一 `/` 開頭的路徑，規則最簡單也最不易被繞過。
- 已登入的人開 `/login?next=…` 不自動跳轉：現行登入頁本來就不檢查登入狀態，維持不變。
- 登出後不帶 `next`：登出是使用者主動離開。
- 不改 session 有效時間。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `user-auth`: 新增「登入後回到原本要開的頁面」的需求

## Impact

- 修改 webapp/auth.py（`require_signed_in` 的頁面轉址）
- 新增 webapp/static/return-path.js（`next` 的檢查與登入網址的組合）
- 修改 webapp/static/login.html、webapp/static/account.js、webapp/static/app.js
- 修改引用 account.js 的各頁面與 webapp/static/index.html 的資源版本號
- 修改 webapp/test_server.py；新增 bench/returnpathcheck.js
