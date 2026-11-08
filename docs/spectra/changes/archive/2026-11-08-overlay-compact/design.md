## Context

`overlay.js` 的 `render()` 把最近一句原文、最近兩句譯文與暫譯直接寫進 `.overlay-subs` 內的三個 `<p>`，框的高度隨內容無限制地長；`place()` 只在重繪時把中心夾回可見範圍，但框比畫面高時無法救。原文開關目前與浮動字幕視窗共用 `localStorage.subtitles.source`（預設關）。

## Goals / Non-Goals

**Goals:** 字幕框永遠是字幕大小（內容區 ≤ 4 行、框 ≤ 50vh），最新內容在底部一定看得到；原文預設顯示。
**Non-Goals:** 不改 PiP 視窗、切句、字級步階。

## Decisions

### 內容區貼齊底部、最多 4 行、捲到最新

`index.html` 把 `.ov-source`、`.ov-text`、`.ov-draft`、`.ov-empty` 包進 `<div class="ov-body">`；CSS：原文行、譯文、暫譯三個部分各自 `max-height: calc(1.35em * 2)`（各自的字級，所以原文約 1 行高、暫譯約 1.7 行高）、`overflow: hidden`、貼齊底部（flex column + flex-end），`render()` 把每個部分 `scrollTop = scrollHeight`；這樣長的定稿譯文不會把原文行或暫譯擠出去（原文行就是這次要找回來的）。整個框 `max-height: 50vh`。內容區最多約 5 行（2＋1.7＋1）。

### 原文開關改為覆蓋層自己的設定、預設開

`localStorage.overlay` 增加 `source`（布林，預設 `true`；非布林用預設）。「原文」按鈕改寫 `settings.source` 並 `save(); render()`；`render()` 用 `settings.source` 決定 `.ov-source` 是否顯示、`aria-pressed`。字級仍由 `Subtitles.getSettings().size` 取得，A−／A+ 仍經 `Subtitles.setSettings`（PiP 跟著變）。

**Supersedes**: screen-subtitles / 字幕內容與設定共用 subtitles.js（只有原文開關不再共用；字級與切句仍共用）

### 進行中的原文與暫譯同色

`app.js` 的 `render('transcript', …)` 與 `renderTranslation()` 改傳 `{done: transcript.slice(0, translationOffset), pending: transcript.slice(translationOffset), translation, draft}`（`source` 欄位移除）。兩個字幕介面的原文行是兩個 `<span>`：`.ov-done`／`.sub-done`（`lastSentences(done, 1)`，白色較淡）與 `.ov-now`／`.sub-now`（`pending` 全文，顏色 `--sub-now: #ffd86b`）；暫譯 `.ov-draft`／`.sub-draft` 也用 `--sub-now`（較淡、非粗體），定稿譯文白色。原文行關閉時只影響原文行，暫譯顏色不變。`--sub-now` 定義在 `tokens.css`：暗色 `#ffd86b`，明亮主題 `#8a5a00`（PiP 視窗用 `--page` 當底，明亮時近白，深琥珀色對比 5.9:1）；覆蓋層的框兩種主題都是黑底，`.overlay-subs` 內固定 `#ffd86b`。進行中原文只取最後兩句（`lastSentences(pending, 2)`），翻譯落後或換方向時不會整段舊逐字稿湧進字幕。暫譯與進行中原文都是全亮的 `--sub-now`（不再「較淡」，同色才好對照）；已定稿原文 `.ov-done` 以 opacity .75 退後。

## Implementation Contract

- 行為：開啟畫面＋字幕後，原文、譯文、暫譯各最多 2 行（內容區約 5 行），框不超過畫面一半；內容超過時只看得到每部分最新的字，進行中的原文與暫譯永遠可見；原文預設顯示（第一次使用），關掉後記住。
- 介面：`localStorage.overlay = {opacity, x, y, source}`；壞值用 `{55, 50, 88, true}`。`Overlay.update` 與 `Subtitles.update` 接受 `{done, pending, translation, draft}`。
- 顏色：進行中原文與暫譯的 `color` 相同（`--sub-now`），定稿譯文為白色（覆蓋層）或主題文字色（PiP）。
- 失敗模式：無新增。
- 驗收：`bench/translate_e2e.mjs` 新增——(1) 預設原文顯示（`.ov-source` 可見、`aria-pressed="true"`），(2) `Overlay.update({done: 長中文, pending: 長中文, translation: 8 句長英文, draft: 長英文})` 後 `.ov-text` ≤ 2 行、`.ov-body` ≤ 5.2 行、`.overlay-subs` ≤ 50% 視窗高、`.ov-draft` 與 `.ov-now` 的底邊在可見範圍內；(3) 預先存 `source:false` 重新整理後原文仍關；關掉原文時 PiP 視窗的原文設定不受影響。既有檢查通過；(4) 餵 `{done:'第一句。', pending:'第二句還在講', translation:'First.', draft:'Second being'}` 後 `.ov-now` 與 `.ov-draft` 的 `color` 相同且與 `.ov-text` 不同；PiP 視窗同樣檢查 `.sub-now`／`.sub-draft`。
- 範圍：以上前端與文件。

## Risks / Trade-offs

- 4 行對 48px 字級約 260px 高，仍不到畫面一半；對小視窗（<600px 高）以 50vh 為準。
