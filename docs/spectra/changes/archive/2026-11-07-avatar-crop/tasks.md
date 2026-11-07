## 1. 裁切對話框

- [x] 1.1 webapp/static/account.js `AvatarPhoto` 新增 `crop(file)` 裁切對話框（原生 dialog、照片完整顯示、置中正方形框、拖曳移動、右下角把手與滑桿縮放、方向鍵移動、夾在照片內、圓形預覽、確定／取消／Esc，樣式注入一次），`upload(url, file)` 改為先 crop、取消回傳 `null`；頁首選單取消時不顯示錯誤。驗證：bench/avatar_e2e.mjs 頁首換照片經過對話框按確定成功、取消不送 PUT。（Member profile photos；設計：移動裁切框，而不是移動照片；對話框用原生 dialog，樣式由 account.js 注入；座標以「顯示像素」記錄，確定時換回原圖；upload 取消時回傳 null）
- [x] 1.2 webapp/static/admin.html 成員頭像換照片時取消不視為錯誤也不更新頁首；更新各 html 的 account.js 版本號 [after: 1.1]。驗證：bench/avatar_e2e.mjs 團隊管理預設框確定後照片中央為藍色、拖到最左邊後左緣為紅色、取消與 Esc 都沒有 PUT、400px 對話框不超出視窗。

## 2. 文件

- [x] 2.1 README 團隊管理段落與 bench/README 的 avatar_e2e 說明改為「選圖後在對話框移動、調整裁切框，確定才上傳」[after: 1.2]。驗證：內容檢查。
