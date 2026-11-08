# tentative-transcript Specification

## Purpose

Shows the cloud engine's not-yet-confirmed recognition (MAI intermediate text, about 0.7 s behind speech) on the live page and in subtitles and drafts, so cloud recognition feels as immediate as the local engine while finalized translation, exports and stored segments keep using confirmed text only.

## Requirements

### Requirement: Tentative transcript from the cloud engine

When the cloud engine (MAI) is recognizing, the gateway SHALL forward its intermediate recognition as a `tentative` field on recognition events: the text not yet confirmed by a delta, converted to Traditional script for Chinese. When a delta arrives, any leading text of the tentative text equal to the delta SHALL be removed before it is sent again; when an item completes or the cloud session reconnects, the tentative text SHALL be sent as empty. The live page SHALL show the tentative text after the confirmed transcript in a distinct colour, SHALL include it in the source being translated now (draft translations and the subtitles' current speech), and SHALL NOT include it in finalized translations, exports or stored segments. Events without `tentative` (the local engine) SHALL behave as before.

#### Scenario: Intermediate text arrives before its delta

- **WHEN** the cloud engine sends intermediate 这个会议, then delta 这个会议, then intermediate 支持实时, then delta 支持实时翻译, then the item completes
- **THEN** the browser receives, in order, an event with empty text and `tentative` 這個會議, the delta with `tentative` empty, an event with `tentative` 支持實時, and the completion with `tentative` empty

#### Scenario: Tentative text on the page

- **WHEN** a recognition event with `tentative` 正在講的暫定字 arrives during a session
- **THEN** the transcript panel shows 正在講的暫定字 after the confirmed text in the tentative style, the subtitles' current speech ends with it, and the exported transcript does not contain it; an event with an empty `tentative` removes it

##### Example: Tentative text and deltas

| Event | Confirmed transcript | Tentative shown |
| --- | --- | --- |
| intermediate 这个会议 | （empty） | 這個會議 |
| delta 这个会议 | 這個會議 | （empty） |
| intermediate 支持实时 | 這個會議 | 支持實時 |
| delta 支持实时翻译 | 這個會議支持實時翻譯 | （empty） |
| completed | 這個會議支持實時翻譯。 | （empty） |

<!-- @trace
source: mai-intermediate
updated: 2026-11-08
code:
  - README.md
  - 20261108_143903.mp4
  - webapp/mai_asr.py
  - webapp/static/index.html
  - meeting-2026-11-01T00-16-53.txt
  - webapp/server.py
  - webapp/static/app.js
  - 20261029_185428.mp4
  - bench/translate_e2e.mjs
  - webapp/static/refine.css
tests:
  - webapp/test_server.py
-->