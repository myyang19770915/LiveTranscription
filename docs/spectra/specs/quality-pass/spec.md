# quality-pass Specification

## Purpose

Quality pass is an opt-in mode of the live page in which the gateway re-recognizes the meeting audio in pause-delimited chunks with a stronger offline recognizer and a text model that repairs, segments and translates it sentence by sentence. Its results replace the live transcript and translation for the same time range, so what the reader keeps and what the meeting stores is one complete, corrected sentence per segment.

## Requirements

### Requirement: Quality pass is opt-in and hidden until configured

`GET /api/config` SHALL include `quality`, true only when both a recognizer (`TRANSLATE_QUALITY_ASR_MODEL`, or one of the app's own engines chosen with `TRANSLATE_QUALITY_ASR` as the requirement below states) and `TRANSLATE_QUALITY_MODEL` are set and a service URL is available from `TRANSLATE_QUALITY_URL` or, when that is empty, `TRANSLATE_REFINE_URL`. The live page SHALL show the 精準模式 checkbox only when `quality` is true, unchecked by default, with the two-line explanation that meeting-setup-layout specifies (its second line states 傳送音訊與文字到外部服務), remembered in the browser, and disabled while a session is running. The gateway SHALL run the quality pass for a stream only when the stream header has `quality: true` and the service is configured; otherwise it SHALL NOT call the external services and the events sent to the browser SHALL be the same as without this capability.

#### Scenario: Not configured

- **WHEN** `TRANSLATE_QUALITY_MODEL` is empty and a signed-in user opens the live page
- **THEN** `/api/config` returns `quality: false` and the 精準模式 checkbox is not shown

#### Scenario: Configured but not chosen

- **WHEN** the service is configured and a stream header has no `quality` field
- **THEN** no request is sent to the external recognizer or text model for that stream


<!-- @trace
source: engine-auto-and-mode-help
updated: 2026-11-15
code:
  - bench/README.md
  - webapp/static/refine.css
  - bench/translate_e2e.mjs
  - webapp/static/app.js
  - bench/ui_polish_e2e.mjs
  - webapp/static/index.html
  - chang01.png
-->

---
### Requirement: The second recognition can use the app's own engines

When `TRANSLATE_QUALITY_ASR` is `local`, `mai` or `hybrid`, the gateway SHALL choose the recognizer of each stream as follows: `local` uses the local ASR engine and `mai` uses Azure MAI for every stream, neither requiring `TRANSLATE_QUALITY_ASR_MODEL`; `hybrid` uses the transcriptions API (`TRANSLATE_QUALITY_ASR_MODEL`) for streams whose language is `zh` or `yue` and Azure MAI for every other stream. With `local`, chunk audio SHALL NOT be sent to any external service. With `mai` or `hybrid`, the quality pass SHALL be configured only when MAI is configured, and `hybrid` SHALL also require `TRANSLATE_QUALITY_ASR_MODEL`. Any other non-empty value SHALL leave the quality pass not configured.

When a stream's recognizer is Azure MAI, the gateway SHALL open one MAI session for that stream, SHALL send the stream's audio to it as the audio arrives (never a whole chunk at once), and SHALL commit the MAI input at each chunk that contains speech; the text of a chunk SHALL be the transcript MAI completes for that commit, taken in order. When the MAI session cannot be opened or drops, the chunks waiting for a transcript SHALL fail (the live result of their range stays) and the gateway SHALL open a new session for the audio that follows. A chunk of which audible audio had already gone to the dropped session SHALL fail as well, and the transcript the new session completes for it SHALL be discarded. A transcript that arrives later than the time allowed for recognition SHALL fail its chunk without ending the quality pass for the stream.

#### Scenario: Local engine

- **WHEN** `TRANSLATE_QUALITY_ASR` is `local`, `TRANSLATE_QUALITY_MODEL` is set and a chunk is ready
- **THEN** the chunk audio goes to the local ASR engine on a connection of its own with `retain` false
- **AND** no request is made to `/audio/transcriptions`
- **AND** the recognized text goes to the text model as NEW

#### Scenario: MAI not configured

- **WHEN** `TRANSLATE_QUALITY_ASR` is `mai` and MAI is not configured
- **THEN** `/api/config` reports `quality` false

#### Scenario: Unknown engine name

- **WHEN** `TRANSLATE_QUALITY_ASR` is `whisper`
- **THEN** `/api/config` reports `quality` false

#### Scenario: MAI hears the audio as it arrives

- **WHEN** the recognizer of a stream is MAI and the stream sends three seconds of speech in 0.2-second messages, then ends
- **THEN** the MAI session received fifteen audio appends before its one commit, together holding exactly the audio sent
- **AND** the transcript MAI completes for that commit goes to the text model as NEW

#### Scenario: MAI session drops inside a chunk

- **WHEN** one second of speech of a chunk has gone to a MAI session that then closes, and the rest of the chunk goes to a new session
- **THEN** that chunk is reported as failed and the transcript the new session completes for it is not used
- **AND** the chunk after it gets the transcript of its own commit

#### Scenario: MAI answers too late

- **WHEN** the transcript of a commit arrives after the time allowed for recognition
- **THEN** that chunk is reported as failed
- **AND** the next chunk is processed as usual and the stream ends with a final event

#### Scenario: MAI session drops

- **WHEN** the MAI session closes while a chunk is waiting for its transcript
- **THEN** that chunk is reported as failed and the stream goes on
- **AND** audio that arrives afterwards goes to a new MAI session

##### Example: recognizer by setting and stream language

| `TRANSLATE_QUALITY_ASR` | Stream language | Recognizer |
| ----------------------- | --------------- | ---------- |
| (empty) | zh | transcriptions API |
| (empty) | ja | transcriptions API |
| mai | zh | MAI |
| hybrid | zh | transcriptions API |
| hybrid | yue | transcriptions API |
| hybrid | ja | MAI |
| hybrid | en | MAI |
| hybrid | auto | MAI |
| hybrid | zh_ja | MAI |
| local | ja | local ASR engine |


<!-- @trace
source: quality-completeness
updated: 2026-11-14
code:
  - bench/README.md
  - bench/omit_probe.py
  - .env.example
  - bench/omit_analyze.py
  - README.md
  - webapp/quality_pass.py
  - webapp/chunk_asr.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: The recognizer can be a separate service

When `TRANSLATE_QUALITY_ASR_URL` is set, the gateway SHALL send transcription requests to that address and SHALL authorize them with `TRANSLATE_QUALITY_ASR_KEY` only, sending no Authorization header when that key is empty. The key of the text-model service SHALL NOT be sent to the recognizer address.

#### Scenario: Recognizer on this machine without a key

- **WHEN** `TRANSLATE_QUALITY_ASR_URL` is `http://asr.test/v1`, `TRANSLATE_QUALITY_ASR_KEY` is empty and the text service key is `text-key`
- **THEN** the transcription request goes to `http://asr.test/v1/audio/transcriptions` with no Authorization header
- **AND** the text request goes to the text service with `Bearer text-key`


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: A recognizer's repetition loop is kept once

The gateway SHALL add the fields of the JSON object in `TRANSLATE_QUALITY_ASR_EXTRA` to every transcription request. When the recognized text of a chunk ends in a unit of 2 to 12 characters repeated five or more times in a row (the last repetition may be cut short), the gateway SHALL keep that unit once and drop the repetitions before the text goes to the text model. Repetitions that are not at the end of the text, and single characters repeated, SHALL be left as they are.

#### Scenario: Loop at the end of a chunk

- **WHEN** the recognizer answers `分かってきたんですね。` followed by `はい。` forty times and a cut-off `はい`
- **THEN** the text given to the text model is `分かってきたんですね。はい。`

#### Scenario: Repetition inside the text

- **WHEN** the recognizer answers `はい。` six times followed by `では次に進みます。`
- **THEN** the text is unchanged

#### Scenario: Output limit for the recognizer

- **WHEN** `TRANSLATE_QUALITY_ASR_EXTRA` is `{"max_completion_tokens": 400}`
- **THEN** every transcription request carries the form field `max_completion_tokens` with the value `400`


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: The translation language is named with every chunk

Every text-model request SHALL name the language to translate into both in its instructions and in the user message, as a last line `TRANSLATE INTO: <language>`: the stream's target language (Chinese (Traditional, Taiwan), English or Japanese; English when none was given), or for the two-way Chinese and Japanese mode the rule that each sentence goes into the other of the two.

#### Scenario: English speech translated into Japanese

- **WHEN** the stream language is `en` and the target is `ja`
- **THEN** the user message of every text-model request ends with `TRANSLATE INTO: Japanese`


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Audio is cut into chunks at pauses

The quality pass SHALL cut the stream audio into consecutive, non-overlapping chunks: once a chunk is at least 5 seconds long it SHALL end at the middle of the first run of 0.35 seconds of silence; a chunk that reaches 18 seconds without such a pause SHALL be cut at the quietest 100 ms of its last 6 seconds. Each chunk SHALL carry a pause value: `none` when it was cut without a pause, `long` when silence continued for at least 1.0 second after the cut, otherwise `short`. A chunk with less than 0.3 seconds of speech SHALL NOT be sent to the recognizer.

#### Scenario: Pause after seven seconds

- **WHEN** speech runs for 7 seconds and is followed by 0.5 seconds of silence and more speech
- **THEN** one chunk ends inside that silence with pause `short`

#### Scenario: No pause for eighteen seconds

- **WHEN** speech runs for 18 seconds with no 0.35-second silence
- **THEN** a chunk ends at the quietest 100 ms of seconds 12 to 18 with pause `none`

#### Scenario: Silence only

- **WHEN** a chunk contains no speech
- **THEN** no recognition request is made for it


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Each chunk yields corrected sentences with translations

For each chunk the quality pass SHALL request a transcription of its audio from the configured recognizer, with the meeting glossary terms and the last 200 characters of earlier recognized text as prompt; when the recognizer refuses a request that has a prompt with HTTP status 400, the quality pass SHALL repeat it without the prompt and SHALL send no prompt for the rest of the stream. It then SHALL make one text-model request that receives the previous sentences with their translations, the carried text, the new recognized text, the pause value, and whether the stream has ended; it SHALL also receive the live recognizer text for the same time range only when `TRANSLATE_QUALITY_ALT` is `1`. The pause value SHALL be read only after it is decided, that is after 1.0 second of audio following the cut has been heard or the stream has ended. The result SHALL be a list of sentences, each with source text, translation and language, and the text carried to the next chunk. When the pause value is `none` or `short` and the stream has not ended, the final sentence SHALL be carried, not emitted, even if the model returned it as a sentence. When the stream has ended, nothing SHALL be carried. Chinese source text and Chinese translations SHALL be converted to Traditional script before they are sent to the browser.

#### Scenario: Sentence continues across a short pause

- **WHEN** a chunk ends with pause `short` and the model returns its whole text as one sentence with an empty carry
- **THEN** no sentence is emitted for that chunk and the whole text is carried to the next chunk

#### Scenario: Recognizer takes no prompt

- **WHEN** the recognizer answers a transcription request that has a prompt with status 400
- **THEN** the same audio is sent again without a prompt, the chunk yields its sentences, and later requests of that stream have no prompt

#### Scenario: Last chunk

- **WHEN** the stream ends while text is carried
- **THEN** the final request emits every remaining sentence and the carry is empty

#### Scenario: Two-way Chinese and Japanese

- **WHEN** the stream language is 中日雙向 and a chunk contains a Japanese sentence
- **THEN** that sentence has language `ja` and a Chinese translation in Traditional script


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Sentences carry an estimated time span

Each emitted sentence SHALL have `startMs` and `endMs` in the audio clock of the stream. The span from the start of the carried text to the end of the chunk SHALL be divided among the emitted sentences and the new carried text in proportion to their source text lengths, in order, so that consecutive sentences share their boundary and the first sentence starts where the carried text started.

#### Scenario: Proportional division

- **WHEN** a request covers 10000 ms to 20000 ms and returns sentences of 30 and 50 source characters with 20 characters carried
- **THEN** the sentences span 10000–13000 and 13000–18000 and the carried text starts at 18000

##### Example: allocation

| Span start | Span end | Sentence lengths | Carry length | Sentence spans | Next carry start |
| ---------- | -------- | ---------------- | ------------ | -------------- | ---------------- |
| 10000 | 20000 | 30, 50 | 20 | 10000–13000, 13000–18000 | 18000 |
| 0 | 6000 | 60 | 0 | 0–6000 | 6000 |
| 4000 | 9000 | (none) | 40 | (none) | 4000 |


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Quality events replace live content on the page

The gateway SHALL send the result of each chunk to the browser on the recognition WebSocket as an event with a `quality` object containing `seq`, `throughMs`, `final` and `sentences`. On such an event the live page SHALL append the sentences to its kept segments and SHALL stop showing live transcript text and live finalized translations whose audio time is at or before the `endMs` of the last kept sentence. The transcript pane SHALL show the source texts of the kept sentences, one paragraph each, followed by the live text after that time; the translation pane SHALL show the kept translations followed by later live translations and the draft. The floating subtitles, the screen view, copy and export SHALL use the same kept segments. While the quality pass is on, the page SHALL NOT run background refinement or term-learning re-translation.

#### Scenario: A quality event arrives

- **WHEN** the page shows live translations ending at 9000 ms and 14000 ms and a quality event arrives with two sentences ending at 10000 ms
- **THEN** the translation pane shows the two sentences followed by the live translation ending at 14000 ms

#### Scenario: Export after the session

- **WHEN** a session with the quality pass ends after its final event
- **THEN** the segment pairs of the exported file are the kept sentences in order


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Live events carry the audio clock while the quality pass is on

While the quality pass runs for a stream, every recognition event the gateway sends to the browser SHALL carry `audioMs`, the amount of stream audio received so far, also in 即時翻譯 mode where no recording is kept. Without the quality pass, events of a 即時翻譯 stream SHALL NOT carry `audioMs`, as before.

#### Scenario: Live translation with the quality pass

- **WHEN** a 即時翻譯 stream with `quality: true` has received 3000 ms of audio and the recognizer sends text
- **THEN** the event sent to the browser has `audioMs` 3000

#### Scenario: Live translation without it

- **WHEN** a 即時翻譯 stream without `quality` receives recognizer text
- **THEN** the event sent to the browser has no `audioMs`


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: The privacy notice names the quality pass

When the 精準模式 checkbox is shown and checked, the live page's privacy notice SHALL show the label 精準模式 and the sentence 音訊與文字會傳送到外部服務, whatever the recognition engine, and the 雲端精修 checkbox SHALL be disabled and SHALL count as off.

#### Scenario: Checked before a meeting

- **WHEN** the user checks 精準模式 with the local engine selected
- **THEN** the privacy notice shows 精準模式 and 音訊與文字會傳送到外部服務, and the stream header of the next session has `quality: true` and `refine: false`


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: A failed chunk keeps the live result

When the transcription or the text-model request for a chunk fails, times out, or returns an unusable answer after one retry, the gateway SHALL send a `quality` event with `failed: true` and the end of the chunk as `throughMs`, SHALL discard the carried text, and SHALL continue with the next chunk. When more than 3 chunks are waiting, the oldest waiting chunk SHALL be treated as failed without calling the services. On a failed event the page SHALL keep the live finalized segments ending at or before `throughMs` that were not yet replaced, as kept segments in order. After 3 consecutive failed events the page SHALL show 精準模式暫時無法使用，已改用即時結果 in its status until a successful event arrives. A failure SHALL NOT end the stream.

#### Scenario: Text model times out

- **WHEN** the text-model request for chunk 4 times out twice
- **THEN** the browser receives a failed event for chunk 4, the live segments of that time range stay, and chunk 5 is processed normally

#### Scenario: Service out of credit

- **WHEN** three consecutive chunks fail
- **THEN** the status shows 精準模式暫時無法使用，已改用即時結果 and the session continues with live results


<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: The stream closes after the final quality event

After the browser ends the session, the gateway SHALL process the remaining audio and carried text as the last chunk, send its event with `final: true`, and only then close the connection, waiting at most 25 seconds; on timeout it SHALL send a failed final event. When revision is enabled, `revision` events MAY follow the final quality event before the connection closes. With the quality pass on, the page SHALL wait up to 70 seconds for the connection to close before finishing the session.

#### Scenario: Ending mid-sentence

- **WHEN** the user ends the meeting while a sentence is carried
- **THEN** the browser receives a `final: true` event containing that sentence before the connection closes

#### Scenario: Revision events after the final event

- **WHEN** revision is enabled and the user ends the meeting with sentences not yet revised
- **THEN** the browser receives the `final: true` quality event, then the `revision` event of those sentences, and then the connection closes


<!-- @trace
source: quality-revision
updated: 2026-11-14
code:
  - README.md
  - compose.yaml
  - webapp/revise_pass.py
  - .env.example
  - bench/qualitycheck.js
  - webapp/quality_pass.py
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/static/app.js
  - webapp/static/index.html
  - webapp/static/quality-view.js
  - webapp/review.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Kept segments are stored as the meeting segments

With the quality pass on, the segments the live page saves for a meeting SHALL be the kept segments in order, each with its `startMs`, `endMs`, source text, translation and language, using the existing save endpoint and schedule. Every kept segment SHALL get its sequence number when it is first kept, one more than the segment kept before it, and SHALL keep that number: the sequence number of a kept segment SHALL NOT change, also when other segments are merged. Every save SHALL also list the merges so far as pairs of sequence numbers: the segment merged into and the segment that was merged.

#### Scenario: Save during the meeting

- **WHEN** three quality events with 2, 0 and 3 sentences have arrived
- **THEN** the next save sends 5 segments with sequence numbers 1 to 5

#### Scenario: Save after a merge

- **WHEN** 5 segments are kept and a `revision` event merges the third into the second
- **THEN** the next save sends 4 segments with sequence numbers 1, 2, 4 and 5 and the merge `{"into": 2, "from": 3}`


<!-- @trace
source: revision-merge
updated: 2026-11-14
code:
  - bench/quality_e2e.mjs
  - webapp/review.py
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/static/themes.css
  - bench/smooth_e2e.mjs
  - chang01.png
  - webapp/static/subtitles.js
  - webapp/server.py
  - webapp/static/index.html
  - bench/README.md
  - bench/savecheck.js
  - README.md
  - webapp/revise_pass.py
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - webapp/static/app.js
  - webapp/static/overlay.css
  - webapp/static/overlay.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Quality pass logs contain no meeting text

Log lines written for quality pass requests SHALL contain only the chunk sequence number, audio duration, character counts, elapsed time and outcome, and SHALL NOT contain recognized text, translations or glossary terms.

#### Scenario: A chunk is processed

- **WHEN** a chunk is transcribed and translated
- **THEN** the log line for it contains its sequence number, duration and elapsed time and none of its text

<!-- @trace
source: quality-pass
updated: 2026-11-14
code:
  - bench/blindn.py
  - .env.example
  - README.en.md
  - webapp/quality_pass.py
  - docker/qwen-asr/healthcheck.py
  - bench/privacycheck.js
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/chunk_asr.py
  - compose.yaml
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - README.deploy.md
  - bench/privacy_e2e.mjs
  - webapp/server.py
  - webapp/static/index.html
  - README.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: The text model's answer accounts for its input

The gateway SHALL compare the amount of source text in a text-model answer (its sentences plus its carry) with the amount it was given (the carried text plus the newly recognized text), counted in words for text written mostly in Latin script and in letters and digits otherwise. An answer SHALL be unusable when the input holds at least 12 units and the answer holds fewer than 70% of them, or more than 150% of them plus 10. An unusable answer SHALL be asked for once more. When the second answer is unusable too, the gateway SHALL show no sentence for that chunk and SHALL keep the carried text and the new text together as the carried text of the next chunk, so that they are asked again with what follows; only when the chunk is the last of the stream, or that text is longer than 800 characters, SHALL the chunk fail (the live result of its range stays). The instructions to the text model SHALL state that no content may be deleted, summarized or shortened. For a translated stream they SHALL state that only filler sounds and repeated false starts may be removed; for a stream without translation the removals and limits of the transcript-only requirement "精準模式 without translation" apply instead.

#### Scenario: The carried sentence is dropped

- **WHEN** the carried text has 20 words, the new text has 10 words and the answer's sentences and carry hold only the 10 new words
- **THEN** the answer is unusable and the request is sent once more

#### Scenario: Fillers removed

- **WHEN** the input has 30 words and the answer holds 26 of them
- **THEN** the answer is accepted

#### Scenario: Both answers drop content

- **WHEN** two answers in a row hold fewer than 70% of the input and more audio follows
- **THEN** the event of that chunk has no sentences and is not a failure
- **AND** the next request carries the whole text as CARRY, once

#### Scenario: Both answers drop content at the end

- **WHEN** two answers in a row hold fewer than 70% of the input and the chunk is the last
- **THEN** the chunk is reported as failed

##### Example: usable or not

| Input units | Answer units | Usable |
| ----------- | ------------ | ------ |
| 30 | 26 | yes |
| 30 | 21 | yes |
| 30 | 20 | no |
| 30 | 10 | no |
| 30 | 55 | yes |
| 30 | 56 | no |
| 11 | 2 | yes |
| 12 | 8 | no |


<!-- @trace
source: transcript-polish
updated: 2026-11-19
code:
  - chang01.png
  - lab/realtime-translate/sessions/20261116-232831/input.wav
  - lab/realtime-translate/sessions/20261116-232831/output.wav
  - lab/realtime-translate/sessions/20261116-232831/transcript.txt
  - lab/realtime-translate/index.html
  - lab/realtime-translate/server.py
  - webapp/quality_pass.py
  - 螢幕擷取畫面 2026-11-17 225637.png
  - lab/realtime-translate/costs.jsonl
  - bench/rubric_transcript.md
  - lab/realtime-translate/sessions/20261117-174651/transcript.txt
  - lab/realtime-translate/sessions/20261117-174651/session.json
  - webapp/revise_pass.py
  - lab/realtime-translate/sessions/20261117-174651/input.wav
  - lab/realtime-translate/sessions/20261116-232831/session.json
  - gpt-realtime-translate_demoUI.png
  - lab/realtime-translate/sessions/20261117-174651/output.wav
tests:
  - webapp/test_server.py
-->

---
### Requirement: A sentence is carried and shown once

When the gateway holds back the last sentence of an answer because the pause after the chunk was not long, and the answer's own carry already begins with that sentence, the carried text SHALL contain the sentence once. A sentence of an answer that says the same as the sentence before it, or as the sentence shown last for the stream, SHALL NOT be shown again. Two sentences say the same when their letters and digits are equal after Unicode NFKC normalization and case folding.

#### Scenario: The model names the held sentence in carry too

- **WHEN** the pause is short and the answer has the sentence `我們下週要上線` both as its last sentence and as its carry
- **THEN** the next request has `CARRY: 我們下週要上線`, not the sentence twice

#### Scenario: A sentence already shown comes back

- **WHEN** an answer begins with the sentence shown last for the stream, given twice
- **THEN** neither copy is shown again and the sentences after them are shown

<!-- @trace
source: quality-completeness
updated: 2026-11-14
code:
  - bench/README.md
  - bench/omit_probe.py
  - .env.example
  - bench/omit_analyze.py
  - README.md
  - webapp/quality_pass.py
  - webapp/chunk_asr.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Quality sentences carry an id

Every sentence of a quality event SHALL carry an integer `id` that is unique within the stream and grows by one with each sentence, starting at 1, whether or not revision is enabled.

#### Scenario: Two events

- **WHEN** a stream's quality events hold 2 sentences and then 1 sentence
- **THEN** their ids are 1, 2 and 3


<!-- @trace
source: quality-revision
updated: 2026-11-14
code:
  - README.md
  - compose.yaml
  - webapp/revise_pass.py
  - .env.example
  - bench/qualitycheck.js
  - webapp/quality_pass.py
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/static/app.js
  - webapp/static/index.html
  - webapp/static/quality-view.js
  - webapp/review.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Shown sentences are revised with more context

When `TRANSLATE_QUALITY_REVISE` is `1` and the quality pass is on for a stream, the gateway SHALL revise the sentences it has sent, in order, in windows of 6: a window SHALL be revised once the 3 sentences after it have been sent, or when the stream ends. For each window the gateway SHALL ask the quality text model (`TRANSLATE_QUALITY_URL`, `TRANSLATE_QUALITY_MODEL`, with `TRANSLATE_QUALITY_REVISE_EXTRA` merged into the request in place of `TRANSLATE_QUALITY_EXTRA`) with: the notes returned by the previous window, up to 6 sentences before the window as revised, the numbered sentences of the window with their translations, the source text of up to 3 sentences after it, the live engine's text for the window's time span, the meeting's terms when given, and the translation language. The answer SHALL give, for every sentence of the window, its source text and translation, either on its own or merged with the sentences next to it into one sentence, and the updated notes. The gateway SHALL send a `revision` event holding only the sentences whose source or translation changed, each with its `id`, `source` and `target`; a sentence that other sentences were merged into SHALL keep the `id` of the first of them and SHALL also carry `merged`, the ids of the sentences merged into it, and `endMs`, the end of the last of them. When nothing changed no event SHALL be sent. Chinese text SHALL be converted to Traditional characters as in quality events. Revision SHALL NOT delay quality events. When `TRANSLATE_QUALITY_REVISE` is not `1` no revision request SHALL be made.

#### Scenario: A window is revised when three more sentences exist

- **WHEN** 8 sentences have been sent and revision is enabled
- **THEN** no revision request has been made
- **WHEN** the 9th sentence is sent
- **THEN** one revision request is made for sentences 1 to 6, with the source text of sentences 7 to 9 as what follows

#### Scenario: Only changed sentences are sent

- **WHEN** the answer for sentences 1 to 6 changes the source of sentence 3 and the translation of sentence 5 and repeats the others unchanged
- **THEN** one `revision` event is sent with exactly sentences 3 and 5

#### Scenario: Notes are carried to the next window

- **WHEN** the answer for the first window returns the notes `Patient: a woman`
- **THEN** the request for the second window contains `NOTES: Patient: a woman`

#### Scenario: Revision is off

- **WHEN** `TRANSLATE_QUALITY_REVISE` is not set and 20 sentences are sent
- **THEN** only chunk requests reach the text model and no `revision` event is sent

#### Scenario: Merged sentences are context for the next window

- **WHEN** the answer for sentences 1 to 6 merges sentences 2 and 3 and the next window is revised
- **THEN** the request for the next window lists 5 sentences before it, the merged sentence among them once

##### Example: the request for a window

- **GIVEN** sentence 2 is `跟先生的感情變得穩定。` / `Her relationship with her husband became stable.` and the live engine heard `跟先生的感情变得不稳定` in that span
- **WHEN** the window is revised and the answer gives sentence 2 as `跟先生的感情變得不穩定。` / `Her relationship with her husband became unstable.`
- **THEN** the request contained `2. SRC: 跟先生的感情變得穩定。` and `ALT:` followed by the live engine's text
- **AND** the `revision` event holds `{"id": 2, "source": "跟先生的感情變得不穩定。", "target": "Her relationship with her husband became unstable."}`

##### Example: a sentence cut in two is merged

- **GIVEN** sentence 2 is `所以我們決定` / `So we decided` ending at 9000 ms and sentence 3 is `在下個月開始。` / `Start next month.` ending at 12000 ms
- **WHEN** the answer gives one item with `"ids": [2, 3]`, `所以我們決定在下個月開始。` and `So we decided to start next month.`
- **THEN** the `revision` event holds `{"id": 2, "source": "所以我們決定在下個月開始。", "target": "So we decided to start next month.", "merged": [3], "endMs": 12000}`


<!-- @trace
source: revision-merge
updated: 2026-11-14
code:
  - bench/quality_e2e.mjs
  - webapp/review.py
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/static/themes.css
  - bench/smooth_e2e.mjs
  - chang01.png
  - webapp/static/subtitles.js
  - webapp/server.py
  - webapp/static/index.html
  - bench/README.md
  - bench/savecheck.js
  - README.md
  - webapp/revise_pass.py
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - webapp/static/app.js
  - webapp/static/overlay.css
  - webapp/static/overlay.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: A revision accounts for every sentence

A revision answer SHALL be used only when its items, each naming one sentence (`id`) or 2 consecutive sentences of the same language (`ids`), together name each sentence of the window exactly once, in order, every item has a non-empty source and translation, and the units of all its source text together (words for text in words, otherwise characters, as in the coverage check of chunks) are at least 80% and at most 125% plus 5 of the units of the window's source text. Any other answer, a failed request, or no answer within 60 seconds SHALL be asked for once more; when the second attempt fails too, the sentences of that window SHALL stay as they were, no event SHALL be sent for it, the notes SHALL stay as they were, and the next window SHALL be revised as usual. When more than 30 sentences are waiting to be revised, the gateway SHALL give up the oldest waiting windows until at most 30 sentences wait.

#### Scenario: The answer drops a sentence

- **WHEN** both answers for a window of 6 give only 5 sentences and name sentences 1 to 5
- **THEN** no `revision` event is sent for that window and the next window is revised

#### Scenario: The answer shortens the text

- **WHEN** both answers give sources that together hold less than 80% of the window's units
- **THEN** no `revision` event is sent for that window

#### Scenario: The second answer is usable

- **WHEN** the first request fails and the second answer is usable
- **THEN** its changed sentences are sent

#### Scenario: Sentences of two languages are not merged

- **WHEN** sentence 2 is Chinese and sentence 3 is Japanese and both answers give one item for sentences 2 and 3
- **THEN** no `revision` event is sent for that window

##### Example: usable or not

| Window units | Answer units | Sentences named by the items | Used |
| ------------ | ------------ | ---------------------------- | ---- |
| 100 | 100 | 1, 2, 3, 4, 5, 6 | yes |
| 100 | 80 | 1, 2, 3, 4, 5, 6 | yes |
| 100 | 79 | 1, 2, 3, 4, 5, 6 | no |
| 100 | 130 | 1, 2, 3, 4, 5, 6 | yes |
| 100 | 131 | 1, 2, 3, 4, 5, 6 | no |
| 100 | 100 | 1, 2, 3, 4, 5 | no |
| 100 | 100 | 1, 2, 2, 4, 5, 6 | no |
| 100 | 100 | 1, [2, 3], 4, 5, 6 | yes |
| 100 | 100 | 1, [2, 3, 4], 5, 6 | no |
| 100 | 100 | 1, [2, 4], 3, 5, 6 | no |


<!-- @trace
source: revision-merge
updated: 2026-11-14
code:
  - bench/quality_e2e.mjs
  - webapp/review.py
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/static/themes.css
  - bench/smooth_e2e.mjs
  - chang01.png
  - webapp/static/subtitles.js
  - webapp/server.py
  - webapp/static/index.html
  - bench/README.md
  - bench/savecheck.js
  - README.md
  - webapp/revise_pass.py
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - webapp/static/app.js
  - webapp/static/overlay.css
  - webapp/static/overlay.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Revision ends with the stream

After the final quality event the gateway SHALL revise the sentences not yet revised (in windows of at most 6; a remainder of at most 9 sentences as one window), asking for all of these windows at the same time and without waiting for a window that is still being revised, for at most 30 seconds in total, send their `revision` events, and then let the connection close. Sentences not revised in that time SHALL stay as they were. When the browser has left, revision SHALL stop without sending anything.

#### Scenario: A short meeting

- **WHEN** a stream ends after 4 sentences were sent
- **THEN** one revision request is made for sentences 1 to 4 after the final quality event, and the connection closes after its `revision` event

#### Scenario: The text model is slow at the end

- **WHEN** the revision of the last sentences takes longer than 30 seconds
- **THEN** the connection closes without a `revision` event for them

#### Scenario: Several windows are left at the end

- **WHEN** a stream ends with 15 sentences not yet revised and every revision answer takes 20 seconds
- **THEN** requests for sentences 1 to 6 and 7 to 15 are made at the same time and both `revision` events are sent before the connection closes

#### Scenario: A window is being revised when the stream ends

- **WHEN** sentences 1 to 6 are being revised and the stream ends with sentences 7 to 13 not yet revised
- **THEN** the request for sentences 7 to 13 is made before the answer for sentences 1 to 6 arrives


<!-- @trace
source: revision-merge
updated: 2026-11-14
code:
  - bench/quality_e2e.mjs
  - webapp/review.py
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/static/themes.css
  - bench/smooth_e2e.mjs
  - chang01.png
  - webapp/static/subtitles.js
  - webapp/server.py
  - webapp/static/index.html
  - bench/README.md
  - bench/savecheck.js
  - README.md
  - webapp/revise_pass.py
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - webapp/static/app.js
  - webapp/static/overlay.css
  - webapp/static/overlay.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: The page replaces revised sentences

On a `revision` event the live page SHALL replace the source text and translation of each kept segment whose `id` is in the event, keep its position and language, and redraw both panes. For a sentence that carries `merged`, the page SHALL also remove the kept segments with those ids and set the end of the segment's time span to `endMs`. A sentence whose `id` is not among the kept segments SHALL be ignored, and so SHALL an id in `merged` that is not among them. Revised segments SHALL be saved with the next save of the meeting's segments.

#### Scenario: A sentence is revised

- **WHEN** kept segments 1 to 3 are shown and a `revision` event holds id 2 with a new source and translation
- **THEN** segment 2 shows the new text at the same position, and segments 1 and 3 are unchanged

#### Scenario: An unknown id

- **WHEN** a `revision` event holds id 9 and only 3 segments are kept
- **THEN** nothing changes

#### Scenario: Two sentences are merged

- **WHEN** kept segments 1 to 4 are shown and a `revision` event holds id 2 with a new source and translation, `merged` `[3]` and `endMs` 12000
- **THEN** three segments are shown: 1, the merged text ending at 12000 ms, and 4


<!-- @trace
source: revision-merge
updated: 2026-11-14
code:
  - bench/quality_e2e.mjs
  - webapp/review.py
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/static/themes.css
  - bench/smooth_e2e.mjs
  - chang01.png
  - webapp/static/subtitles.js
  - webapp/server.py
  - webapp/static/index.html
  - bench/README.md
  - bench/savecheck.js
  - README.md
  - webapp/revise_pass.py
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - webapp/static/app.js
  - webapp/static/overlay.css
  - webapp/static/overlay.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: A revised source text is saved for unreviewed segments

When the live page saves a meeting's segments and a segment already stored has a different source text or translation, the gateway SHALL store the new source text and translation and add 1 to its version, provided the segment is unreviewed and has no edit history; the recognizer text stored when the segment was first saved (`asr_text`) and its live translation (`live_target`) SHALL stay as they were. A segment a reviewer has handled SHALL NOT change.

#### Scenario: The revision arrives after the first save

- **WHEN** segment 2 was saved as `跟先生的感情變得穩定。` and the page saves it again as `跟先生的感情變得不穩定。` with a new translation
- **THEN** the stored source and translation are the new ones, `asr_text` is still `跟先生的感情變得穩定。` and the version is 2

#### Scenario: A reviewer already corrected the segment

- **WHEN** a reviewer has edited segment 2 and the page saves it again with another source text
- **THEN** the stored segment is unchanged


<!-- @trace
source: quality-revision
updated: 2026-11-14
code:
  - README.md
  - compose.yaml
  - webapp/revise_pass.py
  - .env.example
  - bench/qualitycheck.js
  - webapp/quality_pass.py
  - bench/quality_e2e.mjs
  - bench/README.md
  - webapp/static/app.js
  - webapp/static/index.html
  - webapp/static/quality-view.js
  - webapp/review.py
tests:
  - webapp/test_server.py
-->

---
### Requirement: Revision logs contain no meeting text

For every revised window the gateway SHALL log one line with the number of sentences, the number changed, the number merged into another sentence, the time taken and the outcome (`ok`, `failed:<reason>` or `skipped`), and SHALL NOT log source text, translations or notes.

#### Scenario: A window is revised

- **WHEN** a window of 6 sentences is revised, 2 change and 1 of them takes in the sentence after it
- **THEN** one log line holds `sentences=6 changed=2 merged=1` and no text of the meeting


<!-- @trace
source: revision-merge
updated: 2026-11-14
code:
  - bench/quality_e2e.mjs
  - webapp/review.py
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/static/themes.css
  - bench/smooth_e2e.mjs
  - chang01.png
  - webapp/static/subtitles.js
  - webapp/server.py
  - webapp/static/index.html
  - bench/README.md
  - bench/savecheck.js
  - README.md
  - webapp/revise_pass.py
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - webapp/static/app.js
  - webapp/static/overlay.css
  - webapp/static/overlay.js
tests:
  - webapp/test_server.py
-->

---
### Requirement: Merged segments are stored as one

When a save of a meeting's segments lists a merge of segment `from` into segment `into` and both are stored, unreviewed, without edit history and without a speaker chosen by a person, the gateway SHALL, before storing the segments of that save, append the recognizer text (`asr_text`) and the live translation (`live_target`) of `from` to those of `into` (the recognizer texts joined without a space when the segment's language is Chinese or Japanese and with one space otherwise; the translations with one space), set the end of `into` to the later of the two ends, and delete `from`. When `from` is not stored the merge SHALL change nothing, and the end of `into` SHALL become the later of its stored end and the end sent with that save. When several segments are merged into one `into` and any of the stored ones cannot be merged, none of them SHALL be merged. When a merge cannot be made, the segments SHALL stay as they are and that save SHALL NOT change the text of `into`. A merge whose `from` is not greater than its `into` SHALL be refused with status 422.

#### Scenario: Both segments were saved before the merge

- **WHEN** segments 2 (`所以我們決定`, 6000 to 9000 ms) and 3 (`在下個月開始。`, 9000 to 12000 ms) are stored and a save sends segment 2 as `所以我們決定在下個月開始。` with the merge `{"into": 2, "from": 3}`
- **THEN** segment 3 is no longer stored, and segment 2 has the source `所以我們決定在下個月開始。`, the `asr_text` `所以我們決定在下個月開始。` and ends at 12000 ms

#### Scenario: The merge is sent again

- **WHEN** the same save is sent a second time
- **THEN** the stored segments are unchanged

#### Scenario: A reviewer already corrected the merged segment

- **WHEN** a reviewer has edited segment 3 and a save sends segment 2 with the merged text and the merge `{"into": 2, "from": 3}`
- **THEN** segments 2 and 3 are both stored as they were

#### Scenario: The merged segment was never saved

- **WHEN** only segments 1 and 2 are stored and a save sends segment 2 with the merged text and the merge `{"into": 2, "from": 3}`
- **THEN** segment 2 has the merged text as its source, ends where the save says it ends, and no segment 3 is stored

#### Scenario: One of three parts was handled by a reviewer

- **WHEN** segments 1, 2 and 3 are stored, a reviewer has confirmed segment 3, and a save lists the merges of 2 into 1 and of 3 into 1
- **THEN** all three segments are stored as they were

##### Example: joining the first-saved texts

| Language of `into` | `asr_text` of `into` | `asr_text` of `from` | `asr_text` after the merge |
| ------------------ | -------------------- | -------------------- | -------------------------- |
| zh | 所以我們決定 | 在下個月開始。 | 所以我們決定在下個月開始。 |
| ja | それで私たちは | 来月から始めます。 | それで私たちは来月から始めます。 |
| en | So we decided | to start next month. | So we decided to start next month. |

<!-- @trace
source: revision-merge
updated: 2026-11-14
code:
  - bench/quality_e2e.mjs
  - webapp/review.py
  - webapp/static/subtitles.css
  - bench/translate_e2e.mjs
  - webapp/static/themes.css
  - bench/smooth_e2e.mjs
  - chang01.png
  - webapp/static/subtitles.js
  - webapp/server.py
  - webapp/static/index.html
  - bench/README.md
  - bench/savecheck.js
  - README.md
  - webapp/revise_pass.py
  - bench/qualitycheck.js
  - webapp/static/quality-view.js
  - webapp/static/app.js
  - webapp/static/overlay.css
  - webapp/static/overlay.js
tests:
  - webapp/test_server.py
-->