## 1. 精準模式只輸出原文

- [x] 1.1 （Requirement: 精準模式 without translation；設計：精準模式只輸出原文）`quality_pass` 新增 `NONE` 與 `SYSTEM_TRANSCRIPT`，target 為 none 時用它、請求不帶 TRANSLATE INTO、CONTEXT 只列原文、接受沒有 tgt 的回答、句子 target 為空；`revise_pass.Reviser(translate=False)` 用只修原文的指示與檢查；`server.py` 把標頭 `target: "none"` 交給精準模式。驗證：test_server 新增「none 的指示與請求」「沒有 tgt 的回答被接受、target 為空」「回顧修訂 none 的指示與檢查」，既有精準模式測試通過。

## 2. 開會模式的「不翻譯」

- [x] 2.1 （Requirement: A meeting without translation、The meeting page of a meeting without translation；設計：「不翻譯」是「翻譯成」的一個值、段落流程不變，只是翻譯直接回傳空字串、版面、會議頁）`#targetLanguage` 加 none（只在開會模式）；`streamTranslation` 不送請求；不執行雲端精修、自動學名詞、翻譯修正；隱藏譯文欄、逐字稿全寬；字幕顯示原文；隱私標示；`review.js` 不提供重譯；`?v=` 更新。驗證：新增 bench/transcript_only_e2e.mjs（攔截辨識與翻譯請求：零翻譯請求、版面、字幕、存檔段落 target 空、會議頁無譯文欄與重譯），bench interpret_e2e、ui_consistency_e2e、privacy_e2e 通過。 [after: 1.1]

## 3. 實際執行

- [x] 3.1 （另加：只重複上一句結尾的句子不顯示，test_server 驗證）用一段中文錄音實際跑「不翻譯＋精準模式」一次，回報花費、時間與段落品質；test_server 全部通過。 [after: 2.1]
