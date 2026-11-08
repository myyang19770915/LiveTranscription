## Purpose

Lets a team member ask a question in plain language about their teams' meetings and get an answer drawn only from transcripts and minutes, with every sentence linked to its source, found by combining keyword and embedding-based retrieval.

## ADDED Requirements

### Requirement: Passage index

The system SHALL keep an embedding for every transcript segment and every proposed or confirmed minutes item, computed by the configured embedding service in the background. A segment's text SHALL be the segment and its translation only (neither its neighbours nor the meeting topic, which ranked the right segment lower in the evaluation); an item's text SHALL be its kind and content. When a segment or item changes, its embedding SHALL be recomputed; when it is deleted, its embedding SHALL be deleted; when the embedding model changes, every embedding SHALL be recomputed with the new model and only embeddings of the current model SHALL be used. `GET /api/ask/status` SHALL report how many passages of the user's teams are indexed out of how many, the model, and whether the embedding service is reachable.

#### Scenario: A corrected segment is re-indexed

- **WHEN** a reviewer corrects segment 5 of a meeting
- **THEN** within the next indexing round segment 5 gets a new embedding, and other segments keep theirs

#### Scenario: Changing the model

- **WHEN** the embedding model is changed and the app restarts
- **THEN** status reports 0 indexed out of all passages, and the count rises to all as the background indexing finishes

### Requirement: Asking a question

The system SHALL provide `POST /api/ask` for signed-in users with a question of 1 to 300 characters after trimming (otherwise 422) and the same team, series and date filters as full-text search (a team or series the user cannot see gets 404). It SHALL retrieve candidates from the user's teams only, by keyword (latin words other than English function words and Chinese two-character terms of the question, keeping a passage only when it contains two of the terms, or the only term of a one-term question, or a latin term, and ranking by the summed rarity of the terms it contains, so a rare word such as a name counts more than a common one and one shared everyday word does not count) and by embedding similarity, merge both rankings with reciprocal rank fusion, and give the top 8 to the minutes model. The answer SHALL be in Traditional Chinese, based only on the candidates, with a citation `[n]` on every sentence; citations to numbers that were not given SHALL be removed, and an answer without any valid citation SHALL be returned as not found. The response SHALL list only the cited sources, each with its meeting, time or item kind, text and link. When nothing relevant is found the response SHALL say not found and SHALL NOT contain an answer. When the embedding service is unavailable the system SHALL answer from keyword retrieval only and mark the response degraded; when the minutes model is not configured it SHALL return 503.

#### Scenario: A paraphrased question

- **WHEN** a member asks 上次跟客戶談價格的結論是什麼 and a segment says 報價先壓在八五折，下週三前回覆對方
- **THEN** the answer states the 85% offer and the Wednesday reply with a citation that links to that segment

##### Example: Citations checked

| Model reply | Candidates given | Response |
| ----------- | ---------------- | -------- |
| `報價維持八五折 [2]。` | 1–8 | answer with source 2 |
| `報價維持八五折 [2][9]。` | 1–8 | answer with source 2 only; [9] removed |
| `報價維持八五折。` | 1–8 | not found |
| `{"notFound": true}` | 1–8 | not found |
| (not called) | none | not found |

#### Scenario: Other teams stay invisible

- **WHEN** a member asks about something discussed only in another team's meeting
- **THEN** the response is not found, and no source from that team is given to the model

#### Scenario: Embedding service down

- **WHEN** the embedding service cannot be reached and a member asks 合約 寄出 了嗎
- **THEN** the answer is built from keyword candidates and the response is marked degraded

### Requirement: Question page

The system SHALL provide a page at `/ask`, linked from the search page with a switch between 全文搜尋 and 問答 that carries the filters. The page SHALL show the answer with each `[n]` linking to its source in a list below. Choosing `[n]` or a source SHALL open the source in a side panel on the same page, without leaving it: a segment with one segment of context each side, an item with its evidence segments; a segment of a recorded meeting SHALL play, pause and resume there, with its button or with Space while the panel has focus, and the cited segment SHALL offer 到校對頁修正. Esc or the close button SHALL close the panel and give focus back to what opened it. Each source SHALL keep its link (to the review page with its time, or to the minutes page or the board), so a modified click still opens that page. While waiting the page SHALL mark the answer region busy and, after 200 ms, say 正在找資料並整理答案… in a polite live region; a newer question SHALL replace an older one's answer. Not found SHALL offer full-text search with the question; degraded and not configured SHALL be stated. The question and filters SHALL be kept in the address, and opening an address SHALL NOT send the question until the user does. The page SHALL show the index progress when it is incomplete.

#### Scenario: Asking from the page

- **WHEN** a member types a question and presses Enter
- **THEN** the answer appears with numbered citations, and choosing [1] marks source 1 and opens it in the side panel with the segments before and after it, while the page address stays `/ask`

#### Scenario: Listening to a source

- **WHEN** a member opens a source from a recorded meeting in the side panel and presses ▶, then ▶ again, then Space
- **THEN** the segment plays, pauses showing 繼續 and its position, and resumes; closing the panel stops it

#### Scenario: Nothing found

- **WHEN** the answer is not found
- **THEN** the page says it found nothing in the meetings the user can see and links to `/search?q=<question>`

### Requirement: Retrieval evaluation

The repository SHALL include `bench/qa_eval.py` with a set of synthetic meeting transcripts and questions (paraphrased, keyword, cross-language and unanswerable), which loads them into a separate evaluation database, indexes them with the running embedding service, and reports recall@5, recall@10 and mean reciprocal rank for keyword, embedding and hybrid retrieval; with `--answer` it SHALL also ask the minutes model and report how many answerable questions cite a correct source and how many unanswerable ones are not found.

#### Scenario: Comparing models

- **WHEN** the evaluation is run once per candidate model
- **THEN** each run prints the three retrieval methods' recall@5, recall@10 and MRR for that model, and the evaluation database is removed afterwards
