## MODIFIED Requirements

### Requirement: Generating minutes

A team member SHALL be able to start minutes generation for a meeting that has stored segments. The whole meeting SHALL be sent to the configured minutes model in one request, as numbered lines `[seq] source text` in order, together with the meeting date, topic and the team's members; a segment that has a speaker SHALL be sent as `[seq] name：source text`, where name is the speaker's shown name, and the instructions SHALL say that these names come from voice recognition and can be wrong. The meeting SHALL NOT be split into parts. The minutes model is set by `MINUTES_URL`, `MINUTES_MODEL` and `MINUTES_KEY`, falling back to the cloud refinement model (`TRANSLATE_REFINE_*`). Generation SHALL run in the background, SHALL report its status (running, done or failed), and SHALL refuse a second start while one is running (409). A failed model call SHALL end generation as failed with a message and SHALL keep every existing item.

#### Scenario: Generation finishes

- **WHEN** a member starts generation for a meeting with 42 segments
- **THEN** one model request carries segments 1 to 42, the status is running until it answers, then done with the number of items stored and dropped

#### Scenario: Segments with speakers

- **WHEN** segment 3 reads 我來處理報價 and its speaker is named 林怡安, and segment 4 has no speaker
- **THEN** the request carries `[3] 林怡安：我來處理報價` and `[4]` followed by segment 4's text alone

#### Scenario: Second start while running

- **WHEN** generation is running and a member starts it again
- **THEN** the system responds 409 and the running generation continues

#### Scenario: Model unavailable

- **WHEN** the model call fails
- **THEN** the status is failed with a message and the meeting's existing items are unchanged

#### Scenario: Minutes model not configured

- **WHEN** neither `MINUTES_URL` nor `TRANSLATE_REFINE_URL` is set and a member starts generation
- **THEN** the system responds 400 with 紀要功能尚未設定 and does not start


<!-- @trace
source: speaker-diarization
updated: 2026-11-08
code:
  - bench/diarize/run_moss.py
  - bench/diarize/score.py
  - 20261029_185428.mp4
  - README.md
  - webapp/diarize.py
  - bench/diarize/tcpp_parse.py
  - meeting-2026-11-01T00-16-53.txt
  - webapp/static/speakers.js
  - bench/diarize/segment_eval.mjs
  - webapp/static/review.html
  - bench/diarize/Dockerfile.eval
  - webapp/server.py
  - compose.yaml
  - bench/diarize/prep.py
  - bench/diarize/segment_eval.py
  - bench/speakers_e2e.mjs
  - docker/diarize/Dockerfile
  - bench/README.md
  - bench/diarize/run_tcpp.sh
  - webapp/meeting_audio.py
  - bench/diarize/metrics.py
  - bench/diarize/run_sherpa.py
  - docker/diarize/server.py
  - docs/roadmap.md
  - webapp/minutes.py
  - webapp/review.py
  - webapp/static/review.js
  - 20261108_143903.mp4
  - webapp/team_access.py
  - .env.example
  - webapp/migrations/012_speakers.sql
  - webapp/static/speakers.css
tests:
  - docker/diarize/test_server.py
  - webapp/test_server.py
-->

---
