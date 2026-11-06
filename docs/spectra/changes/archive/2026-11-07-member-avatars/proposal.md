## Why

待辦看板與團隊管理目前只用名字首字加顏色當頭像，同事多了以後不容易一眼認出是誰。使用者希望系統管理員能在團隊管理的成員列表為每個人設定頭像照片；沒有設定照片的人維持現在的首字頭像。

## What Changes

- 團隊管理的每位成員旁新增「設定照片」：選一張圖片（PNG、JPEG、WebP），瀏覽器先裁成正方形並縮成 160×160，再上傳；已有照片時可「更換」或「移除」。
- 照片以帳號為單位存在資料庫（同一人在多個團隊共用一張），成員尚未登入過也能設定。
- 新增 API：系統管理員上傳／移除照片；任何已登入者可讀取照片（給頭像顯示用）。
- 團隊管理成員列表、待辦看板（卡片、頭像篩選列、「+N」以外的頭像、依負責人分組的泳道、詳細面板負責人）有照片就顯示照片，沒有照片維持首字加顏色。

## Non-Goals

- 使用者自己上傳照片（只有系統管理員能設定）。
- 從 LDAP（thumbnailPhoto）自動帶入照片。
- 瀏覽器端的裁切介面（自動取中央正方形）。
- 會議紀要頁、逐字稿頁的負責人顯示（目前那裡沒有頭像）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `team-access`: 新增「成員頭像照片」需求：系統管理員設定與移除、格式與大小限制、讀取權限、各頭像位置的顯示與沒有照片時的退回行為。

## Impact

- 資料庫：新增 migration webapp/migrations/007_avatars.sql（user_avatars 資料表）。
- 後端：webapp/team_access.py（上傳、移除、讀取照片的 API；成員列表回傳 avatarUrl），webapp/actions.py（people 回傳 avatarUrl）。
- 前端：webapp/static/admin.html、webapp/static/admin.css、webapp/static/actions.js、webapp/static/actions.css、webapp/static/actions.html。
- 測試：webapp/test_server.py、新增 bench/avatar_e2e.mjs；bench/actions_e2e.mjs 僅作回歸，不修改。
