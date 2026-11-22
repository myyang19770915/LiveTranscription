## MODIFIED Requirements

### Requirement: Live text does not repeat kept text

While the quality pass is on, the live text shown after the kept sentences SHALL NOT begin with words the kept sentences already end with, also when the quality pass reworded them, the repeat spans more than one kept sentence, or the live text arrived late. All comparisons SHALL ignore punctuation and white space. The page SHALL compare against K, the last 15 characters of the kept sentences' source texts joined in order, and SHALL search L, the live text from at most 6 characters before the usual cut point to at most 30 characters after it, regardless of time marks. A candidate is a stretch P of L that starts at most 6 characters before the cut point or at it, ends after the cut point, and holds at least 3 characters. A candidate SHALL count as a repeat only when all of these hold, with LCS meaning the longest common subsequence (characters in the same order, not necessarily adjacent):

1. the LCS of P and K holds at least 3 characters and at least 80% of the characters of P;
2. the LCS of P and K is longer than the LCS of P without its last character and K, so that new speech right after a repeat is not hidden;
3. the LCS of P and K is longer than the LCS of P and K without its last 2 characters, so that the repeat continues the end of the kept text and not a word in its middle.

Of the repeats, the page SHALL choose the one with the longest LCS, and of those the one that ends first. The live text SHALL start right after the chosen repeat, without leading punctuation or white space; when no candidate counts, the live text SHALL start at the usual cut point.

#### Scenario: A reworded repeat is trimmed

- **WHEN** the kept sentences end with 「…給客戶的繁體中文回覆草稿。」 and the live text around the cut point is 「給客戶的繁體｜中文回覆的草稿，如果沒有確認交期呢」 (｜ is the cut point)
- **THEN** the transcript pane shows the live text 「如果沒有確認交期呢」

#### Scenario: New speech that shares only a short word stays

- **WHEN** the kept sentences end with 「…我們的系統。」 and the live text after the cut point is 「我們今天要談預算」
- **THEN** the transcript pane shows the live text 「我們今天要談預算」

##### Example: trimming cases

| Kept sentences end with | Live text around the cut point (｜) | Live text shown | Notes |
| --- | --- | --- | --- |
| …給客戶的繁體中文回覆草稿。 | 給客戶的繁體｜中文回覆的草稿，如果沒有確認交期呢 | 如果沒有確認交期呢 | reworded: 「的」 |
| …第一輪的提示詞，我們複製下來。去貼上。 | 示詞我們複製｜下來哦去貼上哦再來哦這個路徑 | 哦再來哦這個路徑 | two sentences, a filler in between |
| …按右鍵來複製連結，去做這個取代的動作。好，點擊傳送。 | 去做這個取代｜的動作，好點擊傳送，好我們可以看一下呢 | 好我們可以看一下呢 | late live text |
| 好，我們點進來。 | 前面的字｜點進來，好接著在教材的地方 | 好接著在教材的地方 | |
| 好，我們點進來。 | 好我們點｜進來，好接著在教材的地方 | 好接著在教材的地方 | repeat across the cut point |
| 品項、單價、數量、小計、運費、總額。 | 前面的字｜運費總額三十趴的定金 | 三十趴的定金 | |
| 好，我們點進來。 | 前面的字｜接著在教材的地方 | 接著在教材的地方 | no repeat |
| 好，我們點進來。 | 我們點進來｜接著說 | 接著說 | the repeat ends before the cut point |
| 這是我們的 | 前面｜我們的系統跟我們的客戶 | 系統跟我們的客戶 | the first one |
| right now. | 前面｜now we know | we know | |
| …我們的系統。 | 前面｜我們今天要談預算 | 我們今天要談預算 | only 「我們」 in common |
