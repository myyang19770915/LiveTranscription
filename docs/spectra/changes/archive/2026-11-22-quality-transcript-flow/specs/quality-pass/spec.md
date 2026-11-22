## MODIFIED Requirements

### Requirement: Quality events replace live content on the page

The gateway SHALL send the result of each chunk to the browser on the recognition WebSocket as an event with a `quality` object containing `seq`, `throughMs`, `final` and `sentences`. On such an event the live page SHALL append the sentences to its kept segments and SHALL stop showing live transcript text and live finalized translations whose audio time is at or before the `endMs` of the last kept sentence. The transcript pane SHALL show the source texts of the kept sentences grouped into paragraphs (see "Kept sentences flow into paragraphs"), followed by the live text after that time on the same line as the end of the last paragraph; the translation pane SHALL show the kept translations followed by later live translations and the draft. The floating subtitles, the screen view, copy and export SHALL use the same kept segments. While the quality pass is on, the page SHALL NOT run background refinement or term-learning re-translation.

#### Scenario: A quality event arrives

- **WHEN** the page shows live translations ending at 9000 ms and 14000 ms and a quality event arrives with two sentences ending at 10000 ms
- **THEN** the translation pane shows the two sentences followed by the live translation ending at 14000 ms

#### Scenario: Export after the session

- **WHEN** a session with the quality pass ends after its final event
- **THEN** the segment pairs of the exported file are the kept sentences in order

## ADDED Requirements

### Requirement: Kept sentences flow into paragraphs

While the quality pass is on, the transcript pane SHALL join kept sentences in order into paragraphs, with no line break between sentences of one paragraph and one blank line between paragraphs. Within a paragraph, and between the last paragraph and the live text, texts SHALL be joined directly when either side of the seam is a Chinese or Japanese character or full-width punctuation, and with one space otherwise. A sentence SHALL start a new paragraph when its `startMs` is at least 3000 ms after the previous sentence's `endMs`, or when the current paragraph already holds at least 200 characters. A sentence whose `startMs` and `endMs` are both 0 SHALL join the current paragraph unless that paragraph already holds at least 200 characters, and SHALL NOT count as the previous sentence when the pause before the next timed sentence is measured. The translation pane SHALL keep one paragraph per kept sentence.

#### Scenario: Sentences close together share a paragraph

- **WHEN** three kept sentences follow each other with pauses under 3000 ms and the paragraph stays under 200 characters
- **THEN** the transcript pane shows them as one paragraph with no line break between them

##### Example: pause and length breaks

| Kept sentences (source, startMs–endMs) | Paragraphs |
| --- | --- |
| 「好，我們點進來。」0–2000、「接著在教材的地方點進來。」2500–6000、「我們把檔案放進來。」6500–9000 | 1：三句相接 |
| 「第一句。」0–2000、「第二句。」5000–7000 | 2：「第一句。」／「第二句。」（停頓 3000 ms） |
| 一句 200 字的句子 0–30000、「下一句。」30100–31000 | 2：長句自成一段 |
| 「甲。」0–0、「乙。」0–0 | 1：沒有時間的句子接在同一段 |
| 「第一句。」0–2000、「甲。」0–0、「第二句。」5000–7000 | 2：「第一句。甲。」／「第二句。」（停頓從「第一句。」量起） |
| 「Okay, let's start.」0–2000、「Next item is the budget.」2500–5000 | 1：「Okay, let's start. Next item is the budget.」（英文以空格相接） |

### Requirement: Live text does not repeat kept text

While the quality pass is on, the live text shown after the kept sentences SHALL NOT begin with words the last kept sentence already ends with. Within the live text from 6 characters (not counting punctuation and white space) before the usual cut point up to the last time mark at or before `throughMs` plus 1500 ms, the page SHALL look for the end of the last kept sentence, ignoring punctuation and white space, trying its last 6 down to its last 3 characters (fewer only when the sentence has fewer). Only an occurrence that ends after the usual cut point SHALL count, since a repeat can begin before the cut point and end after it. When found, the live text SHALL start right after the first such occurrence, so that later new speech that repeats the same words stays shown, without leading punctuation or white space; when not found, the live text SHALL start at the usual cut point.

#### Scenario: Overlapping live chunk is trimmed

- **WHEN** the last kept sentence is 「好，我們點進來。」 and the live text after the cut point is 「點進來，好接著在教材的地方」
- **THEN** the transcript pane shows the live text 「好接著在教材的地方」

##### Example: trimming cases

| Last kept sentence | Live text after the cut point (within throughMs + 1500 ms) | Live text shown |
| --- | --- | --- |
| 好，我們點進來。 | 點進來，好接著在教材的地方 | 好接著在教材的地方 |
| 品項、單價、數量、小計、運費、總額。 | 運費總額三十趴的定金 | 三十趴的定金 |
| 好，我們點進來。 | 接著在教材的地方 | 接著在教材的地方 |
| 好，我們點進來。 | 切點前「…好我們點」、切點後「進來，好接著在教材的地方」 | 好接著在教材的地方 |
| 這是我們的 | 我們的系統跟我們的客戶 | 系統跟我們的客戶（取第一次出現） |
| right now. | now we know | we know |
