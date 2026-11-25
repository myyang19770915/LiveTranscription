# 實測（2026-11-25）

## 伺服器測試

`docker exec -w /app asr_confucius4-r2t2-app-1 python -B -m unittest -q test_server`：Ran 484 tests，OK（修改前 474；新增 `UsageAdminTests` 10 個，含 review 之後補的 2 個）。

## 圖表配色（dataviz validate_palette.js）

- 深色 `node validate_palette.js "#2f98e8,#e06d22" --mode dark --surface "#17181b"`：ALL CHECKS PASS（色盲最差相鄰 ΔE 26.3、一般視覺 31.2、對底色 ≥ 3:1）。
- 淺色 `node validate_palette.js "#1479c7,#e07018" --mode light --surface "#ffffff"`：ALL CHECKS PASS（色盲 24.7、一般視覺 32.5、對底色 ≥ 3:1）。
- 沿用 metrics.css 的 `--series-1`、`--series-2`，沒有換色。

## 瀏覽器測試

`YUQIAO_SESSION=… node bench/usage_admin_e2e.mjs http://localhost:18082/ <截圖資料夾>`（API 由測試回應，不寫入設定）：66 項全部通過（review 之後由 57 項增為 66 項）。

```
ok   figures of the month and accumulated ["2.31美元","0.27美元","2.04美元","3.19美元"]
ok   each figure comes with its hours ["共 1.50 小時；上月 0.81 美元","0.50 小時，每小時 0.54 美元","1.00 小時，每小時 2.04 美元","共 3.04 小時；雲端辨識 1.08 美元，即時口譯 2.11 美元"]
ok   figure labels ["本月合計","雲端辨識 本月","即時口譯 本月","累計合計"]
ok   the page says the amounts are estimates true
ok   no warning when both are within budget 0
ok   budget cards: name and state [["雲端辨識","正常",true],["即時口譯","正常",true]]
ok   budget figures ["1.08 / 50.00 美元（2%）","2.11 美元 · 未設上限"]
ok   a meter only where there is a budget ["1.08 / 50.00 美元（2%）",null]
ok   budget fields ["50",""]
ok   months, newest first [["2026/11","0.50","0.27","1.00","2.04","2.31"],["2026/10","1.50","0.81","0.00","0.00","0.81"],["2026/09","0.00","0.00","0.00","0.00","0.00"],["2026/08","0.00","0.00","0.00","0.00","0.00"],["2026/07","0.00","0.00","0.00","0.00","0.00"],["2026/06","0.00","0.00","0.04","0.07","0.07"]]
ok   purposes in plain words [["雲端辨識","評測","0.00","1.50","0.81"],["雲端辨識","即時辨識","0.50","0.50","0.27"],["即時口譯","即時口譯","1.00","1.00","2.04"],["即時口譯","測試","0.00","0.04","0.07"]]
ok   users, the empty name as （未記名） [["alice","1.00","1.00","2.04"],["（未記名）","0.00","0.04","0.07"]]
ok   wide tables scroll in their own region, reachable from the keyboard true
ok   no supplier or technology is named false
ok   daily chart: a bar for each service on its day [1,1]
ok   legend names both services ["雲端辨識","即時口譯"]
ok   one tab stop in the chart 1
ok   focus on the last day with usage shows its figures ["2026/11/25","雲端辨識 0.27 美元（0.50 小時）","即時口譯 0.00 美元（0.00 小時）"]
ok   the left arrow moves to the day before ["2026/11/24","雲端辨識 0.00 美元（0.00 小時）","即時口譯 2.04 美元（1.00 小時）"]
ok   the focused day is named for screen readers "11/24：雲端辨識 0.00 美元、即時口譯 2.04 美元"
ok   Home goes to the first day "10/27：雲端辨識 0.00 美元、即時口譯 0.00 美元"
ok   hovering a day shows its figures "2026/11/25"
ok   表格: the days with usage, newest first [["2026/11/25","0.50","0.00","0.27"],["2026/11/24","0.00","1.00","2.04"]]
ok   表格: the chart is gone and the button offers it back [0,"圖表","true"]
ok   pressing again shows the chart [1,"表格"]
ok   tabs on 用量管理 [["團隊管理","/admin",null],["用量管理","/admin/usage","page"]]
ok   tabs are at least 44 px high true
ok   the current tab is marked by more than colour [["600",false],["700",true]]
ok   header marks 管理 on /admin/usage ["管理"]
ok   header links "即時會議 會議紀錄 我的紀錄 待辦看板 成效指標 管理 搜尋"
ok   Tab reaches both tabs and each shows its focus [["團隊管理",true],["用量管理",true]]
ok   Enter on 團隊管理 opens /admin with that tab marked [["團隊管理","page"],["用量管理",null]]
ok   the tabs do not move between the two pages [[true,true],[true,true]]
ok   header marks 管理 on /admin ["管理"]
ok   用量管理 opens /admin/usage "/admin/usage"
ok   no page errors []
ok   near: one warning, naming the service ["雲端辨識接近上限：累計約 40.00 美元，已達上限 50.00 美元的八成。"]
ok   精準模式 for quality, and an unknown purpose as recorded ["精準模式","constructor"]
ok   near: states of the cards ["接近上限","正常"]
ok   near: the meter is at 80% ["40","50","80%",true]
ok   over: the warning names the service and says it keeps working [true,true]
ok   over: states of the cards ["正常","已達上限"]
ok   over: the meter does not pass its end ["2","100%"]
ok   saving sends both budgets [{"mai":80,"interpret":null}]
ok   the figures are shown again with the new budget ["1.08 / 80.00 美元（1%）","已儲存：上限 80.00 美元。"]
ok   saving the other card keeps the first budget {"mai":80,"interpret":20}
ok   an unsaved value in the other card is kept and not sent [{"mai":90,"interpret":20},"33","儲存"]
ok   「0.001」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   「-5」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   「1000001」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   「12e」 is refused and nothing is sent [0,"上限要是 0.01 到 1000000 之間的金額，留空表示不設上限"]
ok   half-typed 「12e」 was text the field could not read true
ok   an empty field means no budget [null,"已儲存：不設上限。"]
ok   refused: the reason is under the card and the field keeps what was typed [1,"上限要是大於 0 的金額，留空表示不設上限","5",true]
ok   no usage in 30 days: said in words, nothing drawn ["近 30 天沒有用量",0]
ok   a failed read: the message, and no figures ["用量暫時讀不到，請稍後再試。",true,false,0]
ok   a failed read: no page errors []
ok   /admin/usage at 390 px does not scroll sideways true
ok   at 390 px the months table scrolls inside its card true
ok   /admin at 390 px does not scroll sideways true
ok   /admin/usage at 500 px does not scroll sideways true
ok   at 500 px the avatar menu does not offer 管理 on its own page ["即時會議","會議紀錄","我的紀錄","待辦看板","成效指標"]
ok   /admin has no usage cards []
ok   /admin does not ask for the usage []
ok   /admin keeps its other cards [true,true,true,true]
ok   /admin: no page errors []
```

## 既有測試（連結改名後）

- `bench/ui_consistency_e2e.mjs`：32 項通過，0 失敗。
- `bench/web_platform_polish_e2e.mjs`：51 項通過，0 失敗。
- `bench/page_switching_e2e.mjs`：18 項通過，0 失敗。
- `bench/ui_review_e2e.mjs 1b2a60ca-… <dir>`：2 項失敗（「every member row has 移出團隊 and no bare 移除」與它之後的點擊逾時），與修改前相同：即時口譯權限那一列的「移除」被測試當成成員列，和這次修改無關。
- `node bench/checks.js`：15 項中 2 項失敗（closecheck、privacycheck），與修改前的 HEAD 相同。

## 實機畫面（真實資料）

`evidence/usage-1440-dark.png`、`usage-1440-light.png`、`usage-390-dark.png`、`usage-390-light.png`、`admin-1440-dark.png`。

- 真實資料：雲端辨識累計 3.05 小時約 1.65 美元（上限 50，3%），即時口譯累計 0.14 小時約 0.29 美元（未設上限）。
- 看圖後修正三處：手機寬度上限欄位被擠成直排（改成欄位與按鈕各佔一列）；每月表的合計與數字卡差 0.01（合計改由畫面上的兩個金額相加）；依用途表的「用途」欄改成靠左。
- 沒有儲存過任何上限：`app_settings` 裡沒有 `usage_budgets`，雲端辨識仍是預設的 50 美元。

## review 之後的修正（同日）

獨立審查沒有找到嚴重問題；修正了以下幾項並補上測試：

- 上限欄位打了不是金額的字（例如「12e」）時，瀏覽器回報空字串，原本會被當成「不設上限」存下去：改成在頁面上拒絕並說明，不送出。0.001、負數、超過 1000000 也在頁面上拒絕。
- 儲存一張卡時，另一張卡還沒儲存的輸入會被清掉：現在保留。儲存期間兩張卡的按鈕都停用，避免第二次儲存用到舊數字；儲存後焦點回到該卡的儲存鈕。
- 記錄檔的上限警告原本每種狀態只記一次：管理者調高上限後，達到新上限的八成與新上限時會再各記一次。
- `usage_budgets` 被手動改成不是正數的值時當成不設上限；上限讀不到時用量照樣記錄，另記一行警告。
- 超大的整數（JSON 裡 400 位數）原本回 500，改回 422。
- 進度條的無障礙屬性改用 HTML 屬性設定（舊版瀏覽器也讀得到）；名為 `constructor` 的用途不再顯示成程式碼。
- `bench/interpret_e2e.mjs` 還在找團隊管理頁上已移除的用量卡：改成確認那張卡不存在。
- 補測試：一月（跨年）的數字、兩個分頁都能用 Tab 到達、500px 的頭像選單、「精準模式」與未知用途的顯示。

沒有改的：數字卡（伺服器由秒數算）與表格（由畫面金額相加）在極少數情況仍可能差 0.01 美元；頁面已註明金額是估算。

## 已知、與這次修改無關

`bench/interpret_e2e.mjs` 在首頁即時口譯那一段（勾選 `#interpretPlay`，腳本第 206 行）就逾時中止，還沒跑到團隊管理頁的部分；這一段的程式這次沒有改，HEAD 的版本在同一行也是同樣的內容。所以這支腳本裡跟著改的那一行（確認用量卡已不在團隊管理頁）這次沒有實際跑到；同一件事由 `bench/usage_admin_e2e.mjs` 的「/admin has no usage cards」檢查。
