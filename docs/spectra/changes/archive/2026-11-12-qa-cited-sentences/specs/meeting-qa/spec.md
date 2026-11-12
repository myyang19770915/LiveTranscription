## MODIFIED Requirements

### Requirement: Asking a question

The system SHALL provide `POST /api/ask` for signed-in users with a question of 1 to 300 characters after trimming (otherwise 422) and the same team, series and date filters as full-text search (a team or series the user cannot see gets 404). It SHALL retrieve candidates from the user's teams only, by keyword (latin words other than English function words and Chinese two-character terms of the question, keeping a passage only when it contains two of the terms, or the only term of a one-term question, or a latin term, and ranking by the summed rarity of the terms it contains, so a rare word such as a name counts more than a common one and one shared everyday word does not count) and by embedding similarity, merge both rankings with reciprocal rank fusion, and give the top 8 to the minutes model. The answer SHALL be in Traditional Chinese, based only on the candidates, with a citation `[n]` on every sentence; citations to numbers that were not given SHALL be removed, every sentence (ending in 。, ！, ？, ! or ? together with any closing quotes or brackets after it, or at a line end) without a valid citation SHALL be removed from the answer, and an answer left with no sentence SHALL be returned as not found. The response SHALL list only the cited sources, each with its meeting, time or item kind, text and link. When nothing relevant is found the response SHALL say not found and SHALL NOT contain an answer. When the embedding service is unavailable the system SHALL answer from keyword retrieval only and mark the response degraded; when the minutes model is not configured it SHALL return 503.

#### Scenario: A paraphrased question

- **WHEN** a member asks 上次跟客戶談價格的結論是什麼 and a segment says 報價先壓在八五折，下週三前回覆對方
- **THEN** the answer states the 85% offer and the Wednesday reply with a citation that links to that segment

##### Example: Citations checked

| Model reply | Candidates given | Response |
| ----------- | ---------------- | -------- |
| `報價維持八五折 [2]。` | 1–8 | answer with source 2 |
| `報價維持八五折 [2][9]。` | 1–8 | answer with source 2 only; [9] removed |
| `報價維持八五折。` | 1–8 | not found |
| `報價維持八五折 [2]。下週三回覆對方。` | 1–8 | answer `報價維持八五折 [2]。` with source 2; the uncited sentence removed |
| `結論如下：
- 八五折 [2]
- 下週三回覆` | 1–8 | answer `- 八五折 [2]` with source 2 |
| `報價維持八五折。[2]` | 1–8 | answer `報價維持八五折。[2]` with source 2; a citation right after the period belongs to that sentence |
| `客戶說：「先壓八五折。」[2]下週回覆。` | 1–8 | answer `客戶說：「先壓八五折。」[2]` with source 2; closing quotes after the end mark belong to that sentence |
| `- 八五折 [2]
- 下週回覆
- 先寄報價 [2]` | 1–8 | answer `- 八五折 [2]
- 先寄報價 [2]`; a removed line leaves no blank line |
| `{"notFound": true}` | 1–8 | not found |
| (not called) | none | not found |

#### Scenario: Other teams stay invisible

- **WHEN** a member asks about something discussed only in another team's meeting
- **THEN** the response is not found, and no source from that team is given to the model

#### Scenario: Embedding service down

- **WHEN** the embedding service cannot be reached and a member asks 合約 寄出 了嗎
- **THEN** the answer is built from keyword candidates and the response is marked degraded

