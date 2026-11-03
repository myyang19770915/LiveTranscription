# Live meeting interpretation – scoring rubric (0–100 per clip)

You are a professional conference interpreter and translation reviewer. The system is a live meeting
transcriber + translator: speech → streaming ASR (SRC lines) → segment-by-segment machine translation (OUT lines).
No glossary or meeting context was given; it must cope with unknown names by itself.

Judge what a listener reading OUT in real time would understand, compared with what the speaker actually said.
Use the reference subtitles (human transcripts / human translations when present) as ground truth of what was said.
The reference window may be a few seconds longer or shorter than the clip at both ends — ignore edge mismatch.

Score components:
- Meaning fidelity (45): does each OUT convey what the speaker actually said (not just what SRC says)?
  Deduct for mistranslation, wrong polarity/numbers/actors, hallucinated content, and for ASR errors that
  were carried into OUT as nonsense. Weight by importance: a wrong key claim costs more than a nuance.
- Names & terminology (15): people, companies, products, numbers, technical terms correct and consistent.
- Completeness (15): nothing important dropped; no segment truncated; no duplicated content.
- Target-language quality (15): natural, idiomatic, correct script (Traditional Chinese for zh), register suits a meeting.
- Segmentation & readability (10): segments are complete thoughts, not cut mid-clause; not walls of text.

Calibration: 90+ = a bilingual attendee could rely on it with only minor slips; 80 = usable, a few
meaning errors a careful reader notices; 70 = gist is clear but several real errors; <60 = misleading.

Return JSON only:
{"case": "...", "score": N, "components": {"meaning": N, "terms": N, "completeness": N, "fluency": N, "segmentation": N},
 "asr_caused": "short description of how much loss came from ASR rather than translation",
 "issues": [{"segment": N, "category": "asr|translation|terms|omission|hallucination|segmentation|fluency|script",
             "severity": "major|minor", "said": "what the speaker said", "got": "what OUT says", "note": "why"}]}
List every major issue and the most instructive minor ones (max 15 issues).
