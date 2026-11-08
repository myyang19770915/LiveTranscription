## 1. 頁首搜尋改為文字按鈕

- [x] 1.1 頁首搜尋連結（webapp/static/account.js 的 `account-search`）顯示文字「搜尋」、不含 svg，外觀與待辦看板等文字按鈕相同（webapp/static/admin.css 移除固定寬度與 svg 樣式），仍連到 `/search`、保留 `title="搜尋（/）"`、搜尋頁本身不顯示、手機 400px 仍可見；所有頁面的 account.js 與 admin.css 版本參數更新。驗證：bench/search_e2e.mjs 檢查按鈕文字為「搜尋」且沒有 svg、點擊開啟搜尋頁、400px 可見且不橫向捲動，全部通過；截圖確認桌面與手機頁首。
- [x] 1.2 README.md、bench/README.md、bench/search_e2e.mjs 的說明把「放大鏡／圖示」改為「搜尋按鈕」 [after: 1.1]。驗證：`grep -rn "放大鏡\|search icon\|header icon" README.md bench/` 沒有結果。
