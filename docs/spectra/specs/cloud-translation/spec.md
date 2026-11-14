# cloud-translation Specification

## Purpose

The translation model behind drafts, finals, single-sentence translation and term discovery can be a keyed OpenAI-compatible service outside this machine instead of the local llama.cpp model. This capability covers how requests change when it is.

## Requirements

### Requirement: Translation requests go to a keyed external service when configured

When `TRANSLATE_KEY` is set, the gateway SHALL send every request it would send to the local translation model (streamed drafts and finals, the repair request, `/api/translate`, and `/api/terms`) to `TRANSLATE_URL` + `/v1/chat/completions` with `Authorization: Bearer <TRANSLATE_KEY>`, SHALL remove the llama.cpp-only fields `repeat_penalty`, `chat_template_kwargs` and `top_p`, and SHALL merge the JSON object in `TRANSLATE_EXTRA` into the request body. An invalid `TRANSLATE_EXTRA` SHALL be ignored with a warning. When `TRANSLATE_KEY` is empty, requests SHALL be exactly as before and SHALL carry no Authorization header. `/api/config` SHALL report `cloudTranslate` true only when `TRANSLATE_KEY` is set.

#### Scenario: Draft with an external model

- **WHEN** `TRANSLATE_KEY` is `k`, `TRANSLATE_EXTRA` is `{"thinking": {"type": "disabled"}}` and the page asks for a draft translation
- **THEN** the upstream request has `Authorization: Bearer k` and `thinking` `{"type": "disabled"}`
- **AND** it has no `repeat_penalty`, `chat_template_kwargs` or `top_p`

#### Scenario: Local model unchanged

- **WHEN** `TRANSLATE_KEY` is empty and the page asks for a draft translation
- **THEN** the upstream request has no Authorization header and still has `chat_template_kwargs`
- **AND** `/api/config` reports `cloudTranslate` false

#### Scenario: Cloud refinement still uses its own service

- **WHEN** `TRANSLATE_KEY` is set and a refinement request arrives with cloud refinement configured
- **THEN** the request goes to `TRANSLATE_REFINE_URL` with `TRANSLATE_REFINE_KEY`, as before


<!-- @trace
source: cloud-translation
updated: 2026-11-14
code:
  - bench/privacy_e2e.mjs
  - bench/privacycheck.js
  - README.md
  - webapp/quality_pass.py
  - webapp/server.py
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - webapp/chunk_asr.py
  - bench/blindn.py
  - bench/README.md
  - compose.yaml
  - .env.example
  - docker/qwen-asr/healthcheck.py
  - webapp/static/index.html
  - README.en.md
  - README.deploy.md
tests:
  - webapp/test_server.py
-->

---
### Requirement: Term discovery asks an external model for a JSON object

When `TRANSLATE_KEY` is set, `/api/terms` SHALL request `response_format` `{"type": "json_object"}` instead of a JSON schema, and SHALL append to the system message an instruction to answer with a JSON object together with the expected schema. The answer SHALL be parsed and filtered exactly as the local model's answer is.

#### Scenario: Terms with an external model

- **WHEN** `TRANSLATE_KEY` is set and `/api/terms` is called
- **THEN** the upstream request has `response_format` `{"type": "json_object"}` and its system message contains the word JSON and the schema
- **AND** the terms in the model's answer are returned as `found`

<!-- @trace
source: cloud-translation
updated: 2026-11-14
code:
  - bench/privacy_e2e.mjs
  - bench/privacycheck.js
  - README.md
  - webapp/quality_pass.py
  - webapp/server.py
  - webapp/static/privacy-note.js
  - webapp/static/app.js
  - webapp/chunk_asr.py
  - bench/blindn.py
  - bench/README.md
  - compose.yaml
  - .env.example
  - docker/qwen-asr/healthcheck.py
  - webapp/static/index.html
  - README.en.md
  - README.deploy.md
tests:
  - webapp/test_server.py
-->