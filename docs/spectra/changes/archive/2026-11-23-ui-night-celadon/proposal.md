## Summary

全站換成兩套新主題：深色「夜航」（石墨黑）、淺色「青瓷」。拿掉英文大寫小標、背景光暈和膠囊導覽。即時會議頁改成三部分：開會前用一句話總結設定，開會後收起設定，錄音控制改成浮在底部的錄音列。原文和譯文逐句對齊留給下一個變更。

## Motivation

長官評這版介面很醜。從 2026-11-23 的截圖看，問題有四個：

- 導覽、欄位、卡片和主按鈕用一樣的藍框圓角，看不出主次。
- 導覽列是 7 顆一樣的膠囊按鈕。
- 頁首有 `REAL-TIME MULTILINGUAL MEETING`、`LIVE TRANSCRIPT`、`MEETINGS` 這類英文大寫加寬字距的小標，背景還有漸層光暈。這些都是 AI 模板的典型特徵。
- 即時會議頁的設定表單佔滿首屏，逐字稿被擠到下面；開會後設定雖然鎖住了，仍然佔著版面。

方向已在 2026-11-23 跟使用者確認：

- 參考同類產品 Granola、Notion AI meeting notes、Apple 翻譯、Google Meet，三個概念方向裡選了夜航和青瓷。
- 交給 Codex（gpt-6.2-sol）評估後，依它的建議修正範圍：
  - 不做暫停鍵：首頁本來就只有開始和結束。
  - 句子要依模式寫出真實設定。
  - 會中不能藏掉資料去向、複製和字幕入口。
  - 譯文不換楷體，兩個主題共用字型。
  - 逐句對齊延到下一個變更。

## Proposed Solution

- **兩套主題配色**：`webapp/static/tokens.css` 的現有色彩 token 改成新值，所有頁面一次換色。
  - 夜航：底色 `#111214`、卡片 `#17181b`、主色為米白。
  - 青瓷：底色 `#f2f5f3`、卡片白色、主色青瓷綠 `#2e7a68`。
  - 新增 `--live`（錄音中的琥珀色），只用在錄音中的狀態。
  - 字型改用系統字型堆疊，不下載網路字型；兩個主題共用同一套字型與幾何。
- **全站拿掉裝飾**：
  - 刪掉英文大寫小標：首頁、會議紀錄、我的紀錄、待辦看板、成效指標、團隊管理、搜尋、問答、原文和翻譯卡片標題。
  - 刪掉背景光暈 `.ambient`。
  - 不再用全大寫加寬字距，字重最高 600。
- **頂端列**：連結從膠囊按鈕改成純文字連結，目前頁面用一階底色標示。位置和順序不變，照 site-navigation 既有規則。
- **即時會議頁，開會前（寬度大於 760px）**：
  - 原本「專注對話，語言交給我們。」的標題，換成一句依目前設定組出的話。例如：「中文和日文互相翻譯，從麥克風 1 收音，記進智慧應用部的會議紀錄」。
  - 句中的設定詞是按鈕，按下會把焦點移到對應的原生選單並打開它。
  - 開會、即時翻譯、即時口譯、不翻譯，各有各的正確說法。
  - 設定欄位改成安靜的樣式，資料去向保持可見。
- **即時會議頁，會中（寬度大於 760px）**：
  - 設定區收成一行文字摘要。
  - 「結束會議」移進浮在畫面底部中央的錄音列，跟音量、麥克風名稱、計時排在一起。
  - 逐字稿區預留錄音列的高度，最後一行不會被蓋住。
  - 複製、浮動字幕、畫面＋字幕、匯出、資料去向都留在原位。
- **設定區簡化**（2026-11-23 使用者看過實作後追加）：
  - 「辨識引擎」那列不再顯示，寬版的進階區和手機的設定對話框都一樣。引擎本來就由語音語言自動決定，送出的 engine 不變；音訊會不會送到外部服務，由頁首的資料去向 `#privacyNote` 和頁尾說明。
  - 拿掉說明小字：雲端精修與精準模式的兩行說明（改成滑鼠停留時的提示）、模式說明 `#modeNote`、欄位標籤旁的「選填」「例行會議」、選麥克風時的耳機提示、開始按鈕與測試音源按鈕的第二行小字、逐字稿卡片底部右側的說明。
  - 保留：即時口譯不能用的原因 `#interpretLocked`、分頁／系統聲音的分享步驟提示、資料去向。
- **原文與翻譯卡片**：標題只留中文；翻譯卡片不再染色；原文用次要文字色，譯文用主要文字色。
- **390px 手機版**：維持現有的語言列、設定對話框和底部按鈕，只換配色和裝飾。

## Non-Goals (optional)

見 design.md 的 Goals / Non-Goals。

## Alternatives Considered (optional)

- **淺色主題「墨紙」（米白配朱紅印章）**：已做概念稿，使用者選了青瓷。
- **翻譯用霞鶩文楷**：Codex 指出三個問題，因此捨棄。
  - 長會議快速掃讀和投影時，細筆畫不好讀。
  - 只有青瓷換字型，會改變換行高度，違反「切換主題只換顏色」。
  - 中文網路字型在內網太重。
- **句子裡直接放自訂下拉選單**：要另外處理鍵盤、讀屏和 20 多種語言的搜尋，所以第一期保留原生 `select`，句子只負責摘要和跳到對應選單。

## Impact

- Affected specs: visual-tokens（修改）、meeting-setup-layout（修改）
- Affected code:
  - Modified:
    - webapp/static/tokens.css
    - webapp/static/themes.css
    - webapp/static/styles.css
    - webapp/static/refine.css
    - webapp/static/topbar.css
    - webapp/static/admin.css
    - webapp/static/login.css
    - webapp/static/mobile.css
    - webapp/static/actions.css
    - webapp/static/overlay.css
    - webapp/static/review.css
    - webapp/static/series.css
    - webapp/static/speakers.css
    - webapp/static/subtitles.css
    - webapp/static/subtitles.js
    - webapp/static/index.html
    - webapp/static/app.js
    - webapp/static/meetings.html
    - webapp/static/interpret.html
    - webapp/static/actions.html
    - webapp/static/metrics.html
    - webapp/static/admin.html
    - webapp/static/search.html
    - webapp/static/ask.html
    - webapp/static/login.html
    - webapp/static/minutes.html
    - webapp/static/review.html
    - webapp/static/not-found.html
    - bench/ui_polish_e2e.mjs
    - bench/ui_consistency_e2e.mjs
    - bench/translate_e2e.mjs
  - New:
    - bench/ui_night_celadon_e2e.mjs
    - webapp/static/setup-sentence.js
  - Removed: 無
