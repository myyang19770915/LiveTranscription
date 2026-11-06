## Why

member-avatars 上線後，使用者回饋三件事：待辦看板按下有照片的頭像篩選時，外圈和照片沒對齊，看起來怪怪的；團隊管理每位成員旁有「設定照片／更換照片／移除照片」好幾個按鈕，太佔空間，希望改成直接點頭像換照片；而且每個人應該能自己換自己的頭像，不必請系統管理員代勞。

## What Changes

- 待辦看板頭像篩選鈕：照片與首字都置中在圓框內，按下時以圓形外框標示，不再變形或偏移。
- 團隊管理成員列：頭像本身就是按鈕，點一下選圖換照片（滑過時顯示相機圖示）；拿掉「設定照片／更換照片」文字按鈕，只在有照片時保留「移除照片」。
- 每個人自己換頭像：頁首帳號名稱前加上自己的頭像，點一下打開小選單「更換照片」「移除照片」（有照片時才有移除）。
- 新增 `PUT`／`DELETE /api/me/avatar`（已登入者只能改自己的照片）；`GET /api/me` 帶 `avatarUrl`。
- 縮圖與上傳的程式移到所有頁面共用的 webapp/static/account.js（`AvatarPhoto`），團隊管理與頁首共用；換了自己的照片後，看板與團隊管理會即時更新頭像。

## Non-Goals

- 手動裁切介面（仍自動取中央正方形）。
- 一般使用者修改別人的照片。
- 舊版即時會議頁（index.html，使用 accounts.css）的頁首樣式重新設計：只加上頭像與選單，維持既有排版。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `team-access`: 「Member profile photos」需求改為系統管理員可改任何人、每個已登入者可改自己的照片；團隊管理改為點頭像換照片；頁首顯示自己的頭像。

## Impact

- 後端：webapp/team_access.py（`/api/me/avatar` 上傳與移除，共用既有檢查）、webapp/auth.py（`/api/me` 帶 `avatarUrl`；`avatar_url` 移到 auth 共用）。
- 前端：webapp/static/account.js（`AvatarPhoto`、頁首頭像與選單）、webapp/static/admin.html、webapp/static/admin.css、webapp/static/accounts.css、webapp/static/actions.js、webapp/static/actions.css，以及引用這些資源的 html 版本號。
- 測試：webapp/test_server.py、bench/avatar_e2e.mjs。
