## Why

開會頁的團隊、主題、系列、辨識引擎、雲端精修五個設定，目前用和「使用耳機開會可避免…」同一種小字提示的樣式排在音源列下方，看起來像備註而不是要填的欄位；使用者反映不明顯、不知道怎麼用。同一頁還有三個相關的小問題：標題區「專注對話，語言交給我們。」占約 200px，天天用的工具每次都要先捲過它；主題切換在這頁是「☀ 明亮」文字按鈕、其他頁是圖示；手機寬度時頁首放不下，「登出」、系統狀態、主題切換在螢幕外，而這頁手機版不能捲動，完全點不到。

## What Changes

- 設定區改成兩排欄位卡：第一排「這場會議」：團隊、主題、系列；第二排「語音與翻譯」：語音語言、翻譯方向、翻譯成、音訊來源、麥克風、測試音源（現有）；其下「進階」：辨識引擎、雲端精修（只在有設定時出現），然後是會議情境與「開始會議」。每個都是和語音語言同一層級、有標題的欄位卡；耳機提示與自動學習詞彙維持小字提示。所有控制項的 id 不變，app.js、series.js 的邏輯不改；手機設定視窗以同樣順序與分組標題顯示。
- 標題區縮成一行：主標題縮小、副標題隱藏、Local-first 標示縮小，整區高度約 70px。
- 主題切換改成和其他頁一樣的圖示按鈕（無文字），aria-label 不變。
- 其他頁頁首的「回到會議」改名「即時會議」，與首頁頁首的「會議紀錄」對稱。
- 開會頁手機版（≤ 760px）頁首只留品牌、搜尋、會議紀錄、頭像、系統狀態、主題切換（430px 以下狀態只留圓點、品牌只留圖示）；「待辦看板」與「登出」移進頭像選單（只在手機版顯示），400px 與 360px 不橫向捲動、所有操作都點得到。

## Non-Goals

- 不改音源、麥克風、測試音源的行為與版面。
- 不改手機設定視窗的開關方式。
- 不改其他頁面的手機版頁首（admin.css 已處理）。

## Impact

- Affected specs: none（控制項與行為不變，只改排版與頁首；meeting-search 要求的頁首搜尋按鈕仍在）
- Affected code:
  - New: (none)
  - Modified: webapp/static/index.html, webapp/static/refine.css, webapp/static/themes.css, webapp/static/mobile.css, webapp/static/series.css, webapp/static/accounts.css, webapp/static/admin.css, webapp/static/app.js, webapp/static/account.js, webapp/replay_inject.js, webapp/static/meetings.html, webapp/static/admin.html, 其他頁面的 html（只更新版本參數）
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
