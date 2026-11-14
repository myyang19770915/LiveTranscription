## MODIFIED Requirements

### Requirement: Service readiness endpoint

`GET /api/services` SHALL require a signed-in session and SHALL check, concurrently and with a 2-second limit each, the local speech recognition service (its `/health` URL, derived from `ASR_WS_URL` by changing `ws` to `http` and the path to `/health`, or `ASR_HEALTH_URL` when set), the translation service (`TRANSLATE_HEALTH_URL` when set, otherwise `TRANSLATE_URL` + `/health`) and the database (`SELECT 1`). A service SHALL count as ready only on HTTP 200 (or a successful query); connection errors, timeouts and other status codes SHALL count as not ready. The response SHALL be HTTP 200 with `ready` (true only when every service is ready) and `services`, a list in the fixed order asr, translate, database, each with `key`, `name` (語音辨識, 翻譯, 資料庫) and `ok`. The response SHALL NOT contain model names, URLs or error details. `/api/health` SHALL stay unchanged.

#### Scenario: All services ready

- **WHEN** a signed-in user calls `/api/services` and all three checks succeed
- **THEN** the response is 200 with `ready` true and three entries with `ok` true

#### Scenario: Not signed in

- **WHEN** a request without a session calls `/api/services`
- **THEN** the response is 401

##### Example: Responses

| ASR | Translation | Database | `ready` | `ok` values in order |
| --- | ----------- | -------- | ------- | -------------------- |
| 200 | 200 | ok | true | true, true, true |
| connection refused | 200 | ok | false | false, true, true |
| 200 | 503 (model loading) | ok | false | true, false, true |
| timeout | 503 | query fails | false | false, false, false |

##### Example: Health URL

| `ASR_WS_URL` | `ASR_HEALTH_URL` | Checked URL |
| ------------ | ---------------- | ----------- |
| `ws://asr:8272/asr_stream_api_v1` | (unset) | `http://asr:8272/health` |
| `wss://asr.example:443/stream` | (unset) | `https://asr.example:443/health` |
| `ws://asr:8272/asr_stream_api_v1` | `http://asr:9000/ready` | `http://asr:9000/ready` |

##### Example: Translation health URL

| `TRANSLATE_URL` | `TRANSLATE_HEALTH_URL` | Checked URL |
| --------------- | ---------------------- | ----------- |
| `http://translate:5000` | (unset) | `http://translate:5000/health` |
| `http://gateway:4001` | `http://gateway:4001/health/liveliness` | `http://gateway:4001/health/liveliness` |
