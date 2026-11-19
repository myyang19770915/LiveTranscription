## Why

不翻譯（中翻中）的精準逐字稿要達到 90 分，最大的扣分是人名、專有名詞與同音字寫錯（阿總→阿祖、KKBOX→KBox、IDEO→IPO、地位專家→第一位專家）。實驗顯示先給正確的名詞，職場節目由 88 升到 92、Podcast 由 83 升到 87。但目前名詞只能在開會前手打進「會議情境」（最多 200 字），會後發現寫錯只能一段一段改，改過的寫法也不會留到下一場。使用者要：(1) 開會前自動帶入以前用過的名詞讓人確認；(2) 會後修正名詞（不只人名，也包括專有名詞、同音字）並一次更新整份逐字稿。

## What Changes

- 會後「修正名詞」：會議頁（逐字稿校對）新增「修正名詞」按鈕，打開對話框，逐列填「原本寫成」→「應該是」（人名、專有名詞、同音字都可以），每列即時顯示這場會議找到幾處。按「全部更正」後，伺服器把所有段落的原文與譯文中的這些寫法一次換掉，每段變更都記入修改紀錄（和手動修改相同），並把這些對照存進這場會議的名詞（`正確=錯誤寫法` 格式）。
- 會前帶入：開會設定選了系列，或填了和以前某場會議相同的主題時，「會議情境」下方出現「帶入上次的名詞（N 個）」，按下去把同系列（或同主題）最近幾場會議的名詞與更正合併後填入，使用者可以再修改。不會自動覆蓋已填的內容。
- 「會議情境」上限由 200 字放寬到 1000 字，讓累積的名詞放得下（最多 30 個名詞，和現在的解析上限相同）。
- 帶入的「正確=錯誤寫法」在下一場會議中照現有機制作用：即時逐字稿自動更正、只把正確寫法交給語音辨識當提示、精準模式把它當 TERMS。

## Non-Goals

- 更正後不自動重新翻譯；譯文只做相同的文字替換。需要重譯的段落可以照現在的方式逐段「儲存並重譯」。
- 不改會議紀要（紀要條目）的文字；只改逐字稿段落。
- 不做全團隊共用的名詞庫；來源只限同系列或同主題的會議。
- 單一個字的替換（例如 他→她）不支援：範圍太大，容易改錯，仍用逐段修改。

## Capabilities

### New Capabilities

- `meeting-terms`: 會後修正名詞並一次更新逐字稿、會前帶入以前用過的名詞。

### Modified Capabilities

(none)

## Impact

- Affected specs: meeting-terms
- Affected code:
  - Modified: webapp/review.py, webapp/server.py, webapp/translation_quality.py, webapp/static/review.html, webapp/static/review.js, webapp/static/review.css, webapp/static/index.html, webapp/static/app.js, webapp/test_server.py
  - New: bench/meeting_terms_e2e.mjs
