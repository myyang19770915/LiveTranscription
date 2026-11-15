## 1. 校對頁改字版面

- [x] 1.1 實作 Translation stays visible while correcting：`webapp/static/review.css` 的 `.edit-form` 在有譯文欄時只佔原文欄（第 2 欄），譯文 `.seg-target` 留在第 3 欄；`main.no-target` 與 760px 以下的整列規則不變。驗證：以 gstack /browse 開 1280px 寬的校對頁，按「修改原文」前後截圖，譯文欄寬度相同且文字完整；500px 寬時編輯框與譯文各佔整列。

## 2. 團隊管理移出成員

- [x] 2.1 實作 Removing a member from a team is labelled as such：`webapp/static/admin.html` 的 `memberRow` 把移出按鈕改為「移出團隊」（警示樣式：`admin.css` 讓成員列的 `danger` 按鈕平時就是紅字），確認文字「確定把〈名稱〉移出〈團隊〉？」；`confirmButton` 加參數讓「移除照片」用一般樣式，仍需二次確認。驗證：以 gstack /browse 開 `/admin`，確認兩個按鈕文字與樣式不同，按一次「移出團隊」顯示含成員與團隊名的確認文字，4 秒後恢復，不實際移出任何人。

## 3. 窄螢幕導覽

- [x] 3.1 實作 Hidden header links stay reachable on narrow screens：`webapp/static/account.js` 的 `ownAvatar` 選單加入會議紀錄（不在 `/`、`/meetings` 時）、成效指標（不在 `/metrics` 時）、團隊管理（管理員且不在 `/admin` 時），`webapp/static/accounts.css`（開會頁：會議紀錄不加、團隊管理 ≤760px、成效指標 ≤900px）與 `webapp/static/admin.css`（其他頁面：會議紀錄、成效指標、團隊管理 ≤640px）讓它們只在頁首藏起對應連結時顯示，並更新引用該 CSS／JS 的頁面版本號。驗證：以 gstack /browse 依 spec 範例表的寬度與頁面（500px、700px、850px、1280px），打開頭像選單，連結與 spec 範例表一致。

## 4. 404 頁

- [x] 4.1 實作 Page requests that end in 404 get an HTML page 的新增內容：`webapp/static/not-found.html` 加團隊管理員權限提示，以及只在從本站其他頁面進來（`document.referrer` 是本站）時顯示、用 `history.back()` 的「返回上一頁」；頁面仍不呼叫 API。驗證：`webapp/test_server.py` 的 404 測試加斷言頁面含「返回上一頁」與「團隊管理員」，`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 通過；gstack /browse 從會議列表點進不存在的會議時看到「返回上一頁」，新分頁直接開時看不到。

## 5. 部署與回歸

- [x] 5.1 重建 app 容器使靜態檔生效並跑完整單元測試：`docker compose up -d --build app` 後執行 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過；確認 1.1–4.1 的瀏覽器檢查都在重建後的容器上完成。 [after: 1.1, 2.1, 3.1, 4.1]
