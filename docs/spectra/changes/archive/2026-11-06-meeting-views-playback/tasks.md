## 1. 共用標頭與返回

- [x] 1.1 One header and tabs for a meeting's two views，依「會議頁共用標頭與分頁列」與「分頁切換取代瀏覽紀錄並加轉場」：`webapp/static/meeting-nav.js` 提供 `MeetingNav.show(meeting)` 與分頁列（`#tabReview`、`#tabMinutes`），校對頁與紀要頁都以 `GET /api/meetings/{id}` 畫出相同標題與五段資訊列；一般點擊分頁以取代瀏覽紀錄的方式切換，修飾鍵點擊保留預設行為；`@view-transition` 轉場與 `sessionStorage` 標題快取。驗證：`bench/minutes_e2e.mjs` 的「tab opens the transcript」「header is the same on both tabs」「tab switch adds no history entries」，以及新增「Ctrl 點擊分頁另開瀏覽器分頁、原頁不變」的檢查
- [x] 1.2 Returning from the review page，依「返回會議紀錄記住列表網址」：從列表進入時記住含篩選的列表網址，切換分頁後「返回會議紀錄」仍回到該列表；直接開啟時前往 `/meetings`。驗證：`bench/minutes_e2e.mjs` 改為從依團隊篩選的列表進入，切換分頁兩次後返回，網址含相同篩選；新增直接開啟紀要頁後返回到 `/meetings` 的檢查 [after: 1.1]
- [x] 1.3 列表按鈕尺寸與名稱：會議列表兩顆按鈕名稱為「會議紀要」「逐字稿校對」且同為 40px 高（`.secondary-button.compact`），列表說明文字同步。驗證：`bench/minutes_e2e.mjs` 新增檢查兩顆按鈕的高度相同、文字與分頁名稱一致

## 2. 證據側欄

- [x] 2.1 Viewing evidence in place，依「證據側欄」：紀要頁點證據時間點開啟 `#peek` 側欄、網址不變；顯示引用段落與前後各一段、不相鄰處的「⋯」、原文與譯文、「到校對頁修正」連結；Esc 與關閉鈕收起；條目被重新產生取代時自動關閉。挑選要顯示的段落抽成可在 node 執行的純函式。驗證：新增 node 檢查涵蓋 spec 範例表「segments shown」三列；`bench/minutes_e2e.mjs` 的「evidence opens the side panel」「panel shows context」「Esc closes the panel」「panel link opens the segment on the review page」

## 3. 播放

- [x] 3.1 Segment playback，依「播放鈕可暫停與繼續」：校對頁播放鈕在播放中暫停、暫停後從原處繼續、播完或換段則從頭播放；旁邊顯示目前位置與片段結束；展開某段且焦點不在輸入或可點擊元素時空白鍵切換。驗證：`bench/playback_e2e.mjs` 校對頁各項（暫停、暫停後位置不動、繼續從原處、位置顯示、空白鍵）
- [x] 3.2 證據側欄的播放鈕同樣可播放、暫停、繼續，按鈕顯示目前位置。驗證：`bench/playback_e2e.mjs` 側欄各項（以有錄音的會議音訊替代，不寫入資料）[after: 2.1]

## 4. 設定與文件

- [x] 4.1 `.env.example` 有 `MINUTES_URL`、`MINUTES_MODEL`、`MINUTES_KEY` 的註解範例並說明未設定時沿用 `TRANSLATE_REFINE_*`；README.md「會後校對」「會議紀要」說明分頁、證據側欄、暫停與空白鍵；bench/README.md 列出 `playback_e2e.mjs`。驗證：內容檢查，名稱與實作一致；`python -m unittest test_server` 與 `bench/*check.js` 全數通過（後端無變更）[after: 1.2, 2.1, 3.2]
