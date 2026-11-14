# quality-pass Specification

## Purpose

Quality pass is an opt-in mode of the live page in which the gateway re-recognizes the meeting audio in pause-delimited chunks with a stronger offline recognizer and a text model that repairs, segments and translates it sentence by sentence. Its results replace the live transcript and translation for the same time range, so what the reader keeps and what the meeting stores is one complete, corrected sentence per segment.

## Requirements

### Requirement: Quality pass is opt-in and hidden until configured

`GET /api/config` SHALL include `quality`, true only when both a recognizer (`TRANSLATE_QUALITY_ASR_MODEL`, or one of the app's own engines chosen with `TRANSLATE_QUALITY_ASR` as the requirement below states) and `TRANSLATE_QUALITY_MODEL` are set and a service URL is available from `TRANSLATE_QUALITY_URL` or, when that is empty, `TRANSLATE_REFINE_URL`. The live page SHALL show the 精準模式 checkbox only when `quality` is true, unchecked by default, with the note 音訊與文字會傳送到外部服務, remembered in the browser, and disabled while a session is running. The gateway SHALL run the quality pass for a stream only when the stream header has `quality: true` and the service is configured; otherwise it SHALL NOT call the external services and the events sent to the browser SHALL be the same as without this capability.

#### Scenario: Not configured

- **WHEN** `TRANSLATE_QUALITY_MODEL` is empty and a signed-in user opens the live page
- **THEN** `/api/config` returns `quality: false` and the 精準模式 checkbox is not shown

#### Scenario: Configured but not chosen

- **WHEN** the service is configured and a stream header has no `quality` field
- **THEN** no request is sent to the external recognizer or text model for that stream


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

After the browser ends the session, the gateway SHALL process the remaining audio and carried text as the last chunk, send its event with `final: true`, and only then close the connection, waiting at most 25 seconds; on timeout it SHALL send a failed final event. With the quality pass on, the page SHALL wait up to 35 seconds for the connection to close before finishing the session.

#### Scenario: Ending mid-sentence

- **WHEN** the user ends the meeting while a sentence is carried
- **THEN** the browser receives a `final: true` event containing that sentence before the connection closes


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
### Requirement: Kept segments are stored as the meeting segments

With the quality pass on, the segments the live page saves for a meeting SHALL be the kept segments in order, each with its `startMs`, `endMs`, source text, translation and language, using the existing save endpoint and schedule. Sequence numbers SHALL only grow: the position of a kept segment SHALL NOT change after it was first saved.

#### Scenario: Save during the meeting

- **WHEN** three quality events with 2, 0 and 3 sentences have arrived
- **THEN** the next save sends 5 segments with sequence numbers 1 to 5


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

The gateway SHALL compare the amount of source text in a text-model answer (its sentences plus its carry) with the amount it was given (the carried text plus the newly recognized text), counted in words for text written mostly in Latin script and in letters and digits otherwise. An answer SHALL be unusable when the input holds at least 12 units and the answer holds fewer than 70% of them, or more than 150% of them plus 10. An unusable answer SHALL be asked for once more. When the second answer is unusable too, the gateway SHALL show no sentence for that chunk and SHALL keep the carried text and the new text together as the carried text of the next chunk, so that they are asked again with what follows; only when the chunk is the last of the stream, or that text is longer than 800 characters, SHALL the chunk fail (the live result of its range stays). The instructions to the text model SHALL state that no content may be deleted, summarized or shortened, and that only filler sounds and repeated false starts may be removed.

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