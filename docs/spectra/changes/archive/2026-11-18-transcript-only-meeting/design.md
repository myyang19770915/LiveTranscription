## Context

開會模式的斷句與段落定稿跟翻譯綁在一起：`app.js` 的 `runTranslation()` 收到翻譯結果才把一段寫進 `segmentRecords`（定稿、存檔、字幕都從這裡來）。精準模式（`quality_pass.QualityPass`）的指示（`SYSTEM`）要求每句有 `src` 與 `tgt`，`_refine` 會丟掉沒有 `tgt` 的句子；`target` 不在 `NAMES` 時改成英文。回顧修訂（`revise_pass.Reviser`）的指示有「重新翻譯」一步，`_answer` 要求每句有 `tgt`。會議頁（`review.js`）在所有段落都沒有譯文時已經隱藏譯文欄。

## Goals / Non-Goals

**Goals:**

- 開會時選「不翻譯（只整理原文）」：零翻譯請求，畫面只有原文。
- 精準模式在這個選擇下只整理原文（修正、斷句），不翻譯；回顧修訂只修原文。
- 存下的會議沒有譯文，會議頁照現有規則不顯示譯文欄。

**Non-Goals:**

- 不改預設語言、不擴充精準模式的語言、不改已存會議。

## Decisions

### 「不翻譯」是「翻譯成」的一個值

`#targetLanguage` 加第一個選項 `<option value="none">不翻譯（只整理原文）</option>`，只在開會模式顯示（即時翻譯、即時口譯模式隱藏；切到這兩種模式時若選著 none 改回英文）。`direction.target === 'none'` 即為不翻譯；中日雙向時照舊停用「翻譯成」。開會模式記住「語音語言」與「翻譯成」（`localStorage` 的 `meetingLanguage`、`meetingTarget`）：語音語言預設是中日雙向，不記住的話中文會議每次都要重選，而中日雙向會蓋掉「不翻譯」。

### 段落流程不變，只是翻譯直接回傳空字串

`streamTranslation()` 在不翻譯時不送請求，立即回傳 `{text: '', source: direction.source}`，所以斷句、定稿、存檔、精準模式的接手都照舊，只是 `target` 為空字串。`queueRefinement()`（雲端精修）、`learnTerms()`（自動學名詞，只供翻譯參考）、翻譯修正佇列都不執行；雲端精修選項隱藏。隱私標示照不翻譯計算（沒有翻譯服務）。

### 版面

`body.no-translation`：隱藏譯文欄，逐字稿欄佔滿寬度。浮動字幕與畫面＋字幕把原文當成主要文字顯示（字幕的 translation 欄位放原文）。

### 精準模式只輸出原文

`quality_pass.NONE = "none"`。`QualityPass` 的 target 為 none 時：指示改用 `SYSTEM_TRANSCRIPT`（由 `SYSTEM` 去掉翻譯步驟與 `tgt`，回傳 `{"sentences": [{"src", "lang"}], "carry"}`）；請求不帶 `TRANSLATE INTO`，CONTEXT 只列原文；每句 `target` 為空字串。回顧修訂收到 `translate=False`：指示改用 `SYSTEM_TRANSCRIPT`（去掉第 3 步翻譯與 `tgt`，`TRANSLATE INTO` 不送），檢查不要求 `tgt`，修訂事件的 `target` 為空字串。`server.py` 的 `/ws/transcribe` 把 `target: "none"` 傳給精準模式。

### 會議頁

`review.js`：會議的 `targetLanguage` 為 `none` 時不提供重譯（沒有翻譯可重做）；譯文欄照現有規則因為沒有譯文而不顯示。

### 只重複上一句結尾的句子不顯示

實跑（2026-11-18，98.6 秒中文錄音，不翻譯＋精準模式）時模型把「…或是把零零一到零零九移到封存區嗎？」之後又單獨給了一次「或是把零零一到零零九移到封存區嗎？」。`_refine` 原本只去掉與上一句完全相同的句子；改為也去掉至少 6 個字、且只是上一句結尾的句子（`REPEAT_MIN`）。翻譯模式同樣受益。

### 畫面文字照「不翻譯」說

首頁：交換方向按鈕的譯文標籤顯示「—」、開始按鈕說明「即時轉錄，不翻譯」；切到其他模式時「不翻譯」改回英文，經過中日雙向也不會帶進即時翻譯（`fixedTarget`），從即時口譯回到開會時在選單換回之後才恢復記住的選擇。會議頁：標題下方顯示「中文・不翻譯」、說明改為按「儲存」、不顯示雲端精修、編輯按鈕寫「儲存」。（來自 review 與實際操作截圖。）

## Implementation Contract

- 行為：開會模式選「不翻譯（只整理原文）」開始會議後，網路上沒有 `/api/translate*`、`/api/terms`、雲端精修請求；畫面只有原文欄；打開精準模式時精準模式的句子只有原文；會議存下的段落 `target` 為空字串、`target_language` 為 `none`，會議頁只有原文欄、沒有重譯按鈕。
- 介面：`#targetLanguage` 值 `none`；`/ws/transcribe` 標頭 `target: "none"`；`quality_pass.NONE`、`quality_pass.system_prompt(language, "none")`；`revise_pass.Reviser(..., translate=False)`。
- 失敗情形：精準模式片段失敗時照舊保留即時原文（target 空字串）。
- 驗收：test_server 新增（精準模式 none 的指示不含翻譯步驟、回答沒有 tgt 也接受、句子 target 為空、請求不含 TRANSLATE INTO；回顧修訂 none 的指示與檢查）；`bench/transcript_only_e2e.mjs`（攔截 `/ws/transcribe`，確認沒有翻譯請求、版面、字幕、存檔段落、會議頁）；既有 bench interpret_e2e、ui_consistency_e2e、privacy_e2e 通過；精準模式實際跑一段中文錄音並回報花費。
- 範圍：只動 Impact 列出的檔案。

## Risks / Trade-offs

- 精準模式不翻譯後每段請求的輸出變短，費用與時間應下降（實跑時量測）。
- 字幕在不翻譯時顯示原文：原文開關在這個選擇下沒有作用，保持顯示。
