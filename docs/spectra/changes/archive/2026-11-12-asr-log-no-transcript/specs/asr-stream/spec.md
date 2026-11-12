## ADDED Requirements

### Requirement: Request logs without transcript text

The per-request log of the ASR service (`logs/requests/<requestId>.log`) SHALL NOT contain recognized text by default: no partial or final transcript, no accumulated text, no repeated-pattern text from hallucination detection, and no content of text messages the client sends. It SHALL record only metadata such as character counts, timings, latency, reset reasons by kind, and connection events. When the environment variable `ASR_LOG_TEXT` is `1`, the log SHALL additionally contain the newly recognized text of each result, never the accumulated text again, except for streams whose header carries `"retain": false`, whose logs SHALL never contain recognized text. The gateway SHALL send `"retain": false` in the header of every 即時翻譯 (translate-only) stream and SHALL NOT send it for meeting streams.

#### Scenario: Translate-only stream leaves no text in the log

- **WHEN** a 即時翻譯 session streams speech through the local engine and receives recognized text
- **THEN** the ASR request log of that stream contains none of the recognized text, whether or not `ASR_LOG_TEXT` is `1`

#### Scenario: Meeting stream logs metadata only by default

- **WHEN** a meeting streams speech through the local engine with `ASR_LOG_TEXT` unset
- **THEN** the ASR request log of that stream contains the character counts and timings of each result and none of the recognized text

##### Example: what a result line records

| ASR_LOG_TEXT | header retain | Recognized "你好世界" logged as |
| ------------ | ------------- | ------------------------------- |
| unset | (absent) | `chars=4` |
| 1 | (absent) | `chars=4 text='你好世界'` |
| 1 | false | `chars=4` |
| unset | false | `chars=4` |

#### Scenario: Gateway marks translate-only streams

- **WHEN** the browser starts a local-engine stream with `mode` `translate`
- **THEN** the header the gateway sends to the ASR service carries `"retain": false`, and a meeting stream's header carries no `retain` field

### Requirement: Request log retention

The ASR service SHALL delete files ending in `.log` under `logs/requests/` whose last modification is older than `ASR_LOG_RETENTION_DAYS` days (default 14), once when the service starts and then every 24 hours while it runs. `ASR_LOG_RETENTION_DAYS=0` SHALL disable deletion; a value that is not a non-negative integer SHALL be logged as an error and the default SHALL be used. Files not ending in `.log` and subdirectories SHALL NOT be deleted.

#### Scenario: Old request logs are removed

- **WHEN** the service starts with `ASR_LOG_RETENTION_DAYS` unset and `logs/requests/` holds logs modified 15 days and 13 days ago
- **THEN** the 15-day-old log is deleted and the 13-day-old log is kept

##### Example: retention decisions

| ASR_LOG_RETENTION_DAYS | File | Age | Result |
| ---------------------- | ---- | --- | ------ |
| (unset) | a.log | 15 days | deleted |
| (unset) | b.log | 13 days | kept |
| (unset) | notes.txt | 30 days | kept |
| 0 | a.log | 400 days | kept |
| 30 | a.log | 15 days | kept |
| abc | a.log | 15 days | deleted (default 14 used, error logged) |
