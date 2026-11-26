## 1. 登入頁

- [x] 1.1 登入頁左側改成一句說明加開會畫面示意（The sign-in page says what the product does and shows the meeting screen）：`h1` 是「會議中即時顯示逐字稿和翻譯」，下面一句說明，寬於 760px 時顯示原文與翻譯兩欄各三行、最後一行譯文標「暫譯」的示意，760px 以下不顯示示意且不能橫向捲動；頁面不再有功能卡示意圖與 Cloud／Local。驗證：`bench/login_e2e.mjs` 在 1440、900、390 三種寬度檢查標題、示意是否顯示、兩欄行數、頁面文字與橫向捲動；`webapp/test_server.py` 檢查 `/login` 的內容含新標題、不含 Cloud。
- [x] 1.2 [after: 1.1] 表單標題是次標題，按鈕字距正常（The sign-in form is headed by a second-level heading）：表單標題是 `h2`「登入」，各寬度都比 `h1` 小；按鈕讀「登入」，送出中讀「登入中…」，字距正常；登入、錯誤訊息、顯示密碼、大寫鎖定提示照舊運作。驗證：`bench/login_e2e.mjs` 檢查 `h1` 只有一個、`h2` 的文字與字級、按鈕的 `letter-spacing`，原有的空欄位、錯誤、顯示密碼檢查仍通過。
- [x] 1.3 [after: 1.2] 登入頁不再持續移動、顏色都來自 token（The sign-in page is calm and uses the shared colours）：載入兩秒後沒有還在播放的動畫，減少動態時完全沒有動畫且內容都看得到；`login.css` 沒有十六進位色碼與 `blur(`。驗證：`bench/login_e2e.mjs` 檢查 `document.getAnimations()`（一般與減少動態兩種）；`webapp/test_server.py` 檢查 `login.css` 的內容。

## 2. 文字下限

- [x] 2.1 全站看得到的字不小於 12px，句子、按鈕、連結、欄位標籤不小於 13px（Text is never smaller than 12px）：開會首頁桌面與手機、成效指標與用量管理的圖表座標與說明、搜尋結果的來源資訊調到下限以上，版面不因此溢出或疊字。驗證：新增 `bench/legibility_focus_e2e.mjs`，在 1440 與 390 兩種寬度打開 14 個頁面，量每段可見文字的字級，全部符合；各頁沒有橫向捲動。

## 3. 鍵盤焦點

- [x] 3.1 Tab 走到的每個控制項都有至少 2px 的外框（Keyboard focus is always visible）：外框在控制項本身或包住它的欄位框上；待辦搜尋欄、問答輸入框、搜尋欄、管理頁輸入框、登入欄位、句中選單選項、成效指標圖表都補上；樣式表沒有聚焦時拿掉外框卻不替代的規則。驗證：`bench/legibility_focus_e2e.mjs` 在每頁按 Tab 走完一圈，逐一檢查外框；`webapp/test_server.py` 檢查樣式表裡每條在 `:focus` 上設 `outline: none` 的規則都只針對非鍵盤焦點。

## 4. 收尾

- [x] 4.1 [after: 1.3, 2.1, 3.1] 既有測試與說明跟著更新：`test_server` 全數通過；`bench/ui_consistency_e2e.mjs`、`bench/web_platform_polish_e2e.mjs`、`bench/page_switching_e2e.mjs`、`bench/usage_admin_e2e.mjs` 的失敗項目不多於修改前；README.md 與 bench/README.md 提到登入頁與瀏覽器測試的段落更新；改過的樣式表與腳本在各 HTML 的版本參數更新。驗證：上述指令的輸出，以及登入頁（1440 深色、淺色與 390）、開會首頁（1440 與 390）的截圖逐張檢視。
