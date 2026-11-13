## Purpose

Quality pass is an opt-in mode of the live page in which the gateway re-recognizes the meeting audio in pause-delimited chunks with a stronger offline recognizer and a text model that repairs, segments and translates it sentence by sentence. Its results replace the live transcript and translation for the same time range, so what the reader keeps and what the meeting stores is one complete, corrected sentence per segment.

## ADDED Requirements

### Requirement: Quality pass is opt-in and hidden until configured

`GET /api/config` SHALL include `quality`, true only when both `TRANSLATE_QUALITY_ASR_MODEL` and `TRANSLATE_QUALITY_MODEL` are set and a service URL is available from `TRANSLATE_QUALITY_URL` or, when that is empty, `TRANSLATE_REFINE_URL`. The live page SHALL show the 精準模式 checkbox only when `quality` is true, unchecked by default, with the note 音訊與文字會傳送到外部服務, remembered in the browser, and disabled while a session is running. The gateway SHALL run the quality pass for a stream only when the stream header has `quality: true` and the service is configured; otherwise it SHALL NOT call the external services and the events sent to the browser SHALL be the same as without this capability.

#### Scenario: Not configured

- **WHEN** `TRANSLATE_QUALITY_MODEL` is empty and a signed-in user opens the live page
- **THEN** `/api/config` returns `quality: false` and the 精準模式 checkbox is not shown

#### Scenario: Configured but not chosen

- **WHEN** the service is configured and a stream header has no `quality` field
- **THEN** no request is sent to the external recognizer or text model for that stream

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

### Requirement: Quality events replace live content on the page

The gateway SHALL send the result of each chunk to the browser on the recognition WebSocket as an event with a `quality` object containing `seq`, `throughMs`, `final` and `sentences`. On such an event the live page SHALL append the sentences to its kept segments and SHALL stop showing live transcript text and live finalized translations whose audio time is at or before the `endMs` of the last kept sentence. The transcript pane SHALL show the source texts of the kept sentences, one paragraph each, followed by the live text after that time; the translation pane SHALL show the kept translations followed by later live translations and the draft. The floating subtitles, the screen view, copy and export SHALL use the same kept segments. While the quality pass is on, the page SHALL NOT run background refinement or term-learning re-translation.

#### Scenario: A quality event arrives

- **WHEN** the page shows live translations ending at 9000 ms and 14000 ms and a quality event arrives with two sentences ending at 10000 ms
- **THEN** the translation pane shows the two sentences followed by the live translation ending at 14000 ms

#### Scenario: Export after the session

- **WHEN** a session with the quality pass ends after its final event
- **THEN** the segment pairs of the exported file are the kept sentences in order

### Requirement: Live events carry the audio clock while the quality pass is on

While the quality pass runs for a stream, every recognition event the gateway sends to the browser SHALL carry `audioMs`, the amount of stream audio received so far, also in 即時翻譯 mode where no recording is kept. Without the quality pass, events of a 即時翻譯 stream SHALL NOT carry `audioMs`, as before.

#### Scenario: Live translation with the quality pass

- **WHEN** a 即時翻譯 stream with `quality: true` has received 3000 ms of audio and the recognizer sends text
- **THEN** the event sent to the browser has `audioMs` 3000

#### Scenario: Live translation without it

- **WHEN** a 即時翻譯 stream without `quality` receives recognizer text
- **THEN** the event sent to the browser has no `audioMs`

### Requirement: The privacy notice names the quality pass

When the 精準模式 checkbox is shown and checked, the live page's privacy notice SHALL show the label 精準模式 and the sentence 音訊與文字會傳送到外部服務, whatever the recognition engine, and the 雲端精修 checkbox SHALL be disabled and SHALL count as off.

#### Scenario: Checked before a meeting

- **WHEN** the user checks 精準模式 with the local engine selected
- **THEN** the privacy notice shows 精準模式 and 音訊與文字會傳送到外部服務, and the stream header of the next session has `quality: true` and `refine: false`

### Requirement: A failed chunk keeps the live result

When the transcription or the text-model request for a chunk fails, times out, or returns an unusable answer after one retry, the gateway SHALL send a `quality` event with `failed: true` and the end of the chunk as `throughMs`, SHALL discard the carried text, and SHALL continue with the next chunk. When more than 3 chunks are waiting, the oldest waiting chunk SHALL be treated as failed without calling the services. On a failed event the page SHALL keep the live finalized segments ending at or before `throughMs` that were not yet replaced, as kept segments in order. After 3 consecutive failed events the page SHALL show 精準模式暫時無法使用，已改用即時結果 in its status until a successful event arrives. A failure SHALL NOT end the stream.

#### Scenario: Text model times out

- **WHEN** the text-model request for chunk 4 times out twice
- **THEN** the browser receives a failed event for chunk 4, the live segments of that time range stay, and chunk 5 is processed normally

#### Scenario: Service out of credit

- **WHEN** three consecutive chunks fail
- **THEN** the status shows 精準模式暫時無法使用，已改用即時結果 and the session continues with live results

### Requirement: The stream closes after the final quality event

After the browser ends the session, the gateway SHALL process the remaining audio and carried text as the last chunk, send its event with `final: true`, and only then close the connection, waiting at most 25 seconds; on timeout it SHALL send a failed final event. With the quality pass on, the page SHALL wait up to 35 seconds for the connection to close before finishing the session.

#### Scenario: Ending mid-sentence

- **WHEN** the user ends the meeting while a sentence is carried
- **THEN** the browser receives a `final: true` event containing that sentence before the connection closes

### Requirement: Kept segments are stored as the meeting segments

With the quality pass on, the segments the live page saves for a meeting SHALL be the kept segments in order, each with its `startMs`, `endMs`, source text, translation and language, using the existing save endpoint and schedule. Sequence numbers SHALL only grow: the position of a kept segment SHALL NOT change after it was first saved.

#### Scenario: Save during the meeting

- **WHEN** three quality events with 2, 0 and 3 sentences have arrived
- **THEN** the next save sends 5 segments with sequence numbers 1 to 5

### Requirement: Quality pass logs contain no meeting text

Log lines written for quality pass requests SHALL contain only the chunk sequence number, audio duration, character counts, elapsed time and outcome, and SHALL NOT contain recognized text, translations or glossary terms.

#### Scenario: A chunk is processed

- **WHEN** a chunk is transcribed and translated
- **THEN** the log line for it contains its sequence number, duration and elapsed time and none of its text
