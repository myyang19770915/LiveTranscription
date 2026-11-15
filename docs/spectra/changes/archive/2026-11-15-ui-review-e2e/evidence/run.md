# 執行紀錄（2026-11-15）

- git HEAD：`11e8468`（修改皆為未提交的工作區內容）
- app 容器映像：`sha256:87a6a9e03e71`（重建後，靜態檔與工作區一致）
- 檔案 sha256 前 12 碼：

```
45da066dba2e  *bench/ui_review_e2e.mjs
a2943a6c6453  *webapp/static/review.css
582126f96cd2  *webapp/static/admin.html
431837b6ba9c  *webapp/static/admin.css
951a17d87fef  *webapp/static/account.js
245bed7150cd  *webapp/static/accounts.css
0c30c93969eb  *webapp/static/not-found.html
```

## 目前版本：全部通過（exit code 0，26 項）

指令：`YUQIAO_SESSION=<myyang> YUQIAO_MEMBER_SESSION=<alice> node bench/ui_review_e2e.mjs f8511bc5-466c-4f68-bd4e-4e6b2c7e4fb0 <截圖目錄>`

```
ok   meeting has a translated first segment "Later I also learned the defin"
ok   1280px: translation width unchanged while editing [465,465]
ok   1280px: translation text unchanged while editing
ok   1280px: editor sits beside the translation, not over it 465
ok   500px: editor and translation each take the full row {"target":434,"form":434}
ok   every member row has 移出團隊 and no bare 移除 ["移出團隊","移除照片","移出團隊","移除照片","移出團隊"]
ok   移出團隊 is a danger button
ok   移除照片 is not a danger button
ok   移出團隊 and 移除照片 are coloured differently ["rgb(255, 141, 114)","rgb(155, 172, 190)"]
ok   移出團隊 asks with member and team names "確定把bob移出業務部？"
ok   the question resets to 移出團隊 after 4 s
ok   no membership changed
ok   404 from a page of this site: 返回上一頁 and both links ["返回上一頁","回開會頁","會議紀錄"]
ok   404 shows the team administrator hint
ok   返回上一頁 goes back to the list "http://localhost:18082/meetings"
ok   404 opened directly: no 返回上一頁
ok   404 with a /meetings referrer: 返回上一頁 (control)
ok   404 right after signing in: referrer is the sign-in page
ok   404 right after signing in: no 返回上一頁
ok   menu 500px /meetings/<id> admin ["會議紀錄","成效指標","團隊管理"]
ok   menu 500px /actions member ["會議紀錄","成效指標"]
ok   menu 500px /metrics admin ["會議紀錄","團隊管理"]
ok   menu 500px / admin ["待辦看板","成效指標","團隊管理"]
ok   menu 850px / admin ["成效指標"]
ok   menu 700px /actions admin []
ok   menu 1280px /actions admin []
```

review 建議前的版本（24 項）曾連跑 5 次皆 ok；不給 `YUQIAO_MEMBER_SESSION` 時一般成員那列印 skip、exit code 0。

## 退化測試：故意改壞後確實失敗

暫時把 `review.css` 的 `.edit-form` 改回 `grid-column: 2 / 4`，並刪掉 `account.js` 的成效指標選單項目，重建容器後執行（只列非 ok 行）：

```
FAIL 1280px: translation width unchanged while editing [465,76]
FAIL 1280px: editor sits beside the translation, not over it 946
FAIL menu 500px /meetings/<id> admin ["會議紀錄","團隊管理"]
FAIL menu 500px /actions member ["會議紀錄"]
FAIL menu 500px / admin ["待辦看板","團隊管理"]
FAIL menu 850px / admin []
exit=1
```

之後以備份還原兩個檔案（`git diff --stat` 只剩 ui-review-fixes 的修改）、重建容器，上方「目前版本」即還原後的結果。

## spectra-review 建議後（2026-11-15）

- 404「登入後」一項加上對照組（以 `/meetings` 為 referrer 必須出現返回上一頁）並斷言 `document.referrer` 確實是登入頁；沒有成員有照片時改為 FAIL 而非略過。
- 暫時刪掉 `not-found.html` 的 `/login` 排除後執行（只列非 ok 行）：

```
FAIL 404 right after signing in: no 返回上一頁
exit=1
```

還原後重建容器，結果即上方「目前版本」。
