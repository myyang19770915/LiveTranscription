# 實測（2026-11-25）

- `docker exec -w /app asr_confucius4-r2t2-app-1 python -B -m unittest -q test_server`：Ran 484 tests，OK（`/admin/settings` 的 403／200 與團隊管理頁不含兩項設定的檢查加在既有的 `test_only_administrators_see_the_figures_and_the_page`）。
- `node bench/usage_admin_e2e.mjs`：80 項全部通過（修改前 66 項；新增系統設定頁與三個分頁的檢查）。和這次有關的項目：

```
ok   tabs on 用量管理 [["團隊管理","/admin",null],["用量管理","/admin/usage","page"],["系統設定","/admin/settings",null]]
ok   tabs are at least 44 px high true
ok   Tab reaches every tab and each shows its focus [["團隊管理",true],["用量管理",true],["系統設定",true]]
ok   the tabs do not move between the pages true
ok   系統設定 opens /admin/settings with that tab marked [["團隊管理",null],["用量管理",null],["系統設定","page"]]
ok   the tabs are in the same place on /admin/settings true
ok   header marks 管理 on /admin/settings ["管理"]
ok   「0.001」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   「-5」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   「1000001」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   「12e」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   refused: the reason is under the card and the field keeps what was typed [1,"上限要是大於 0 的金額，留空表示不設上限","5",true]
ok   /admin/settings at 390 px does not scroll sideways true
ok   /admin has no usage cards []
ok   /admin does not ask for the usage []
ok   /admin has neither setting and starts with 建立新團隊 [false,false,"createTeam",true]
ok   /admin does not ask for the settings []
ok   one card with both settings, the controls to the right of the name [1,[["紀錄保存期限",true,false],["即時口譯權限",true,false]]]
ok   the retention shown, and the granted accounts ["90",["alice"]]
ok   saving the days [["PUT",{"days":30}],"已儲存：保存 30 天，較舊的紀錄已刪除。"]
ok   granting an account [["POST",{"username":"Bob"}],["alice","bob"]]
ok   removing an account asks once more [["DELETE","alice"],["bob"]]
ok   a refused request is reported on the page ["保存天數要在 1 到 3650 之間",true]
ok   /admin/settings: no page errors []
ok   on a phone the controls are below the explanation [["紀錄保存期限",false,true],["即時口譯權限",false,true]]
ok   on a phone the fields stay inside the card true
```

- `node bench/ui_consistency_e2e.mjs`：32 項通過，0 失敗（保存期限的手機檢查改開 `/admin/settings`）。
- `node bench/ui_review_e2e.mjs 1b2a60ca-… <dir>`：23 項通過，0 失敗。修改前有 2 項失敗（即時口譯權限那一列的「移除」被當成成員列）；那一列搬走後就通過了。
- `bench/interpret_e2e.mjs` 的權限與保存期限檢查改開 `/admin/settings`，但這支腳本在更前面的首頁即時口譯段落就逾時中止（與這次無關，上一個 change 已記錄），所以改的那幾行沒有實際跑到；同樣的操作由 `bench/usage_admin_e2e.mjs` 的系統設定頁檢查涵蓋。
- 實機畫面（真實資料）：`evidence/settings-1440-light.png`、`settings-1440-dark.png`、`settings-390-light.png`、`settings-390-dark.png`、`admin-1440-light.png`、`admin-390-dark.png`。1440px 時名稱在左、控制項在右；390px 時上下排列；團隊管理頁第一張卡是建立新團隊。
- 第一次跑 `test_server` 有 1 項失敗：團隊管理頁的程式註解裡還寫著兩項設定的中文名稱，被「團隊管理頁不含這兩項」的檢查抓到；註解改寫後通過。
