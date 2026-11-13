## Why

開會頁寫著「Local-first 音訊與錄音不離開你的設備」「端對端本機處理」「錄音與逐字稿存於 output 資料夾」。經對外網址使用時音訊是送到語橋主機並存成錄音檔，選了雲端辨識或雲端精修時還會送到外部服務，這些文字與實際不符；「output 資料夾」是伺服器路徑，對使用者沒有意義。另外登入頁帳號欄的範例是系統管理員的真實帳號，開會頁還有幾處英文狀態文字。以上都是 2026-11-13 站台稽核實見的項目。

## What Changes

- 開會頁頁首的隱私標示改為依目前選擇顯示音訊與文字送到哪裡：只在語橋主機、音訊送到 Azure（雲端辨識或混合）、文字送到外部模型服務（雲端精修），切換選項時立即更新。
- 頁尾的「端對端本機處理」改用同一個標示；「錄音與逐字稿存於 output 資料夾」改為「錄音與逐字稿存入會議紀錄」；存檔失敗的提示不再提 output。
- 頁首副標與 meta description 不再寫「本機」。
- 登入頁帳號欄範例改為「公司帳號」，不含任何真實帳號。
- 譯文空狀態「Translation appears here」改為「譯文會顯示在這裡」，翻譯狀態標籤「READY」改為「就緒」。

## Non-Goals (optional)

- 不改卡片上的裝飾性英文小標（REAL-TIME MULTILINGUAL MEETING、LIVE TRANSCRIPT、LIVE TRANSLATION）：它們旁邊都有中文標題，屬於版面設計。
- 不改即時翻譯模式的說明文字（「逐字稿與錄音只留在瀏覽器」「不存到伺服器」）：這兩句描述的是儲存位置，與現況相符。
- 不做介面多語。
- 不改紀要頁顯示模型名稱一事：那是另一個要先決定方向的項目。

## Capabilities

### New Capabilities

- `privacy-notice`: 開會頁上說明音訊與文字會送到哪裡的標示

### Modified Capabilities

(none)

## Impact

- 新增 webapp/static/privacy-note.js（依引擎與精修選擇回傳標示文字的純函式）
- 修改 webapp/static/index.html、webapp/static/app.js、webapp/static/login.html
- 新增 bench/privacycheck.js
- 修改 bench/README.md 中引用舊文字之處（若有）
- 不影響伺服器程式與資料庫
