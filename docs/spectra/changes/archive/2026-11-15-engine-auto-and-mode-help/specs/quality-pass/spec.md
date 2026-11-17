## MODIFIED Requirements

### Requirement: Quality pass is opt-in and hidden until configured

`GET /api/config` SHALL include `quality`, true only when both a recognizer (`TRANSLATE_QUALITY_ASR_MODEL`, or one of the app's own engines chosen with `TRANSLATE_QUALITY_ASR` as the requirement below states) and `TRANSLATE_QUALITY_MODEL` are set and a service URL is available from `TRANSLATE_QUALITY_URL` or, when that is empty, `TRANSLATE_REFINE_URL`. The live page SHALL show the 精準模式 checkbox only when `quality` is true, unchecked by default, with the two-line explanation that meeting-setup-layout specifies (its second line states 傳送音訊與文字到外部服務), remembered in the browser, and disabled while a session is running. The gateway SHALL run the quality pass for a stream only when the stream header has `quality: true` and the service is configured; otherwise it SHALL NOT call the external services and the events sent to the browser SHALL be the same as without this capability.

#### Scenario: Not configured

- **WHEN** `TRANSLATE_QUALITY_MODEL` is empty and a signed-in user opens the live page
- **THEN** `/api/config` returns `quality: false` and the 精準模式 checkbox is not shown

#### Scenario: Configured but not chosen

- **WHEN** the service is configured and a stream header has no `quality` field
- **THEN** no request is sent to the external recognizer or text model for that stream
