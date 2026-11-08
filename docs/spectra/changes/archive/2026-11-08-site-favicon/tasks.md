## 1. 瀏覽器圖示

- [x] 1.1 每個頁面的分頁都顯示語橋 Live 圖示：webapp/static/ 新增 favicon.ico、favicon-32.png、favicon-192.png、apple-touch-icon.png，所有 html 的 `<head>` 加上 `<link rel="icon">`（ico 與 32px png）與 `<link rel="apple-touch-icon">`；webapp/server.py 提供 `GET /favicon.ico`（不需登入）。驗證：`test_server.py` 新增測試確認未登入取得 `/favicon.ico` 為 200 且 content-type 為 image/x-icon 或 image/vnd.microsoft.icon；`grep -L 'rel="icon"' webapp/static/*.html` 沒有結果；以瀏覽器開啟任一頁面截圖確認分頁圖示。
