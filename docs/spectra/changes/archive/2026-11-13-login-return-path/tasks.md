## 1. 伺服器轉址

- [x] 1.1 spec「Sign-in returns to the requested page」的「Deep link while signed out」與「Main page while signed out」情境：`webapp/auth.py` 的 `require_signed_in` 對未登入的頁面請求轉到 `/login?next=<百分比編碼的路徑與查詢字串>`，路徑為 `/` 且無查詢字串時維持 `/login`。驗證：`webapp/test_server.py` 的 `SignedOutTests` 新增測試比對 `/meetings/abc/minutes?item=50` 的 `Location`，既有的 `test_main_page_redirects_to_sign_in` 仍通過。

## 2. 瀏覽器

- [x] 2.1 spec「Sign-in returns to the requested page」的「Next value is checked before use」情境與範例表：新增純函式模組 `webapp/static/return-path.js`，提供 `ReturnPath.safe(next)`（回傳可用的路徑或 `/`）與 `ReturnPath.loginUrl(path, search)`（組出登入網址，`/` 且無查詢字串時為 `/login`）。驗證：新增 `bench/returnpathcheck.js`，`node bench/returnpathcheck.js` 對範例表十列與 `loginUrl` 的兩個例子全部印出 ok、exit 0。
- [x] 2.2 [after: 2.1] spec「Sign-in returns to the requested page」的登入後前往與「Session expires on an open page」情境：`webapp/static/login.html` 載入 `return-path.js`，登入成功後前往 `ReturnPath.safe(next)` 加上登入頁網址的 `#` 片段；`webapp/static/account.js` 與 `webapp/static/app.js` 在登入失效時改去 `ReturnPath.loginUrl(location.pathname, location.search)`（登出仍去 `/login`）；載入 `account.js` 的頁面都先載入 `return-path.js`，並更新這些資源的版本號。驗證：以瀏覽器（gstack browse，本機 `http://localhost:18082`）未登入開 `/meetings`，確認網址為 `/login?next=%2Fmeetings`，登入後落在 `/meetings`；再開 `/login?next=//example.com/` 登入後落在 `/`。

## 3. 整體驗證

- [x] 3.1 [after: 1.1, 2.2] 全部單元測試通過：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 結果為 OK，且 `node bench/returnpathcheck.js` exit 0。
