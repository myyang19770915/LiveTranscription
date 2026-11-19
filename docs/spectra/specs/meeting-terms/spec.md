# meeting-terms Specification

## Purpose

Names, proper nouns and homophones written wrong in a meeting can be corrected once for the whole meeting, and the corrected terms are offered again before later meetings of the same series or topic.

## Requirements

### Requirement: Fixing terms across a meeting

A team member SHALL be able to correct, on a meeting's review page, how terms were written throughout the meeting — names, proper nouns and homophones — by giving one to twenty pairs of "written as" and "should be". Each "written as" SHALL be 2 to 40 characters (a Latin-script one at least 2 letters), each "should be" 1 to 40 characters, the two SHALL differ, and neither SHALL contain a newline or a glossary separator (= , ， 、 ; ； / ／ | ｜). The page SHALL show, for each pair, how many places of the meeting contain the "written as" form before anything is changed. Applying SHALL replace every occurrence in every segment's transcript and translation in one transaction — every form regardless of letter case, a Latin-script one only as a whole word, and where the "should be" contains the "written as" form, a "should be" already written stays as it is — record each changed segment in its edit history as an edit by that member, mark it edited, and answer with the number of changed segments and the changed segments. A request by a non-member SHALL be answered 404, an invalid pair 422, and a request that matches nothing SHALL change and record nothing.

#### Scenario: A misheard name and a homophone

- **WHEN** a member fixes 阿祖 → 阿總 and 第一位專家 → 地位專家 in a meeting where three segments contain 阿祖 and one contains 第一位專家
- **THEN** those four segments now say 阿總 and 地位專家, each has an edit in its history, and the answer reports 4 changed segments

##### Example: what is replaced

| Text | Written as | Should be | Result |
| ---- | ---------- | --------- | ------ |
| 我們用 KBox 聽歌 | KBox | KKBOX | 我們用 KKBOX 聽歌 |
| 我們用 kbox 聽歌 | KBox | KKBOX | 我們用 KKBOX 聽歌 |
| 這是 KBoxes 的資料 | KBox | KKBOX | unchanged (not a whole word) |
| 阿祖沒翻譯，阿祖說好 | 阿祖 | 阿總 | 阿總沒翻譯，阿總說好 |
| 王小說好，王小明也說好 | 王小 | 王小明 | 王小明說好，王小明也說好 |

#### Scenario: Invalid pairs

- **WHEN** a member sends a "written as" of one character, or a pair whose two sides are the same
- **THEN** the answer is 422 and no segment changes


<!-- @trace
source: meeting-terms
updated: 2026-11-19
code:
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/server.py
  - chang01.png
  - bench/meeting_terms_e2e.mjs
  - lab/realtime-translate/index.html
  - gpt-realtime-translate_demoUI.png
  - webapp/translation_quality.py
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/review.py
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/review.html
  - bench/cases_transcript.json
  - webapp/static/series.js
  - webapp/static/earlier-terms.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/review.js
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/static/index.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/quality_pass.py
  - lab/realtime-translate/costs.jsonl
  - webapp/server.py
  - webapp/static/review.css
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
tests:
  - webapp/test_server.py
-->

---
### Requirement: Fixed terms become the meeting's terms

Applied pairs SHALL be stored in the meeting's terms as `should-be=written-as` entries: a "should be" already listed gains the "written as" form as one more misheard form, and a term whose correct form equals a "written as" form SHALL be removed. The stored terms SHALL keep at most 30 terms and 1000 characters, dropping the oldest first.

#### Scenario: Correcting a term that was listed wrong

- **WHEN** the meeting's terms are `LINE=耐、阿祖` and a member fixes 阿祖 → 阿總
- **THEN** the meeting's terms are `LINE=耐、阿總=阿祖`


<!-- @trace
source: meeting-terms
updated: 2026-11-19
code:
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/server.py
  - chang01.png
  - bench/meeting_terms_e2e.mjs
  - lab/realtime-translate/index.html
  - gpt-realtime-translate_demoUI.png
  - webapp/translation_quality.py
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/review.py
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/review.html
  - bench/cases_transcript.json
  - webapp/static/series.js
  - webapp/static/earlier-terms.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/review.js
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/static/index.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/quality_pass.py
  - lab/realtime-translate/costs.jsonl
  - webapp/server.py
  - webapp/static/review.css
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
tests:
  - webapp/test_server.py
-->

---
### Requirement: Terms of earlier meetings are offered before a meeting

When a member setting up a meeting has chosen a series, or typed a topic equal to the topic of an earlier meeting of the same team, the setup page SHALL offer 帶入上次的名詞（N 個） below 會議情境, where N is the number of terms merged from the terms of the five most recent ended meetings of that series (or, without a series, of that topic), newest first, with the misheard forms of the same term joined, at most 30 terms and 1000 characters. Choosing it SHALL keep what is already typed exactly as it is and add after it each offered term not already typed; nothing SHALL be filled without that choice, and the offer SHALL be hidden while a meeting runs. 會議情境 SHALL accept up to 1000 characters.

#### Scenario: A weekly meeting in a series

- **WHEN** a member chooses the series 研發週會, whose last ended meeting had the terms `阿總=阿祖、KKBOX=KBox`, and 會議情境 is empty
- **THEN** the page offers 帶入上次的名詞（2 個）, and choosing it fills 會議情境 with `阿總=阿祖、KKBOX=KBox`

##### Example: merging earlier meetings

| Newest meeting | Older meeting | Offered |
| -------------- | ------------- | ------- |
| 阿總=阿祖 | 阿總=阿主、MES | 阿總=阿祖/阿主、MES |
| (none) | (none) | no offer |

<!-- @trace
source: meeting-terms
updated: 2026-11-19
code:
  - webapp/static/refine.css
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/server.py
  - chang01.png
  - bench/meeting_terms_e2e.mjs
  - lab/realtime-translate/index.html
  - gpt-realtime-translate_demoUI.png
  - webapp/translation_quality.py
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - webapp/review.py
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - webapp/static/review.html
  - bench/cases_transcript.json
  - webapp/static/series.js
  - webapp/static/earlier-terms.js
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/output.wav
  - webapp/static/review.js
  - 螢幕擷取畫面 2026-11-17 225637.png
  - webapp/static/index.html
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - webapp/quality_pass.py
  - lab/realtime-translate/costs.jsonl
  - webapp/server.py
  - webapp/static/review.css
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/session.json
tests:
  - webapp/test_server.py
-->