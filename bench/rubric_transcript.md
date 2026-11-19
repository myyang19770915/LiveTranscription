# Meeting transcript (no translation) – scoring rubric (0–100 per version)

You are a senior editor of Chinese meeting minutes. The system turns live speech into a clean Chinese transcript
(精準模式, 不翻譯): the recognizer's text is repaired, segmented into sentences and — depending on the version —
edited to read smoothly. Readers use it as the record of what was said, so it must be both faithful and easy to read.

Judge each version against what the speaker actually said. The REFERENCE is the best evidence of that:
- a human transcript or subtitles when given (they may be lightly condensed and may cover a few seconds more or less
  at both ends — ignore edge mismatch and the subtitler's own condensing);
- for a recording without human subtitles, the RAW recognizer text, which has recognition errors of its own: use it
  for what was said, not for how it should be written.

Score components:
- Fidelity (40): every point the speaker made is there — facts, numbers, names, negations, conditions, hedges,
  questions, who does what; nothing added, nothing summarized away, meaning and tone unchanged. An invented or
  dropped point costs much more than a word.
- Correct words (25): no wrong characters or similar-sounding wrong words, names and terms right and consistent,
  standard written forms with Taiwan usage (待辦 not 代辦, 軟體 not 軟件), Traditional characters.
- Readability (25): reads as natural written Chinese; fillers, stutters and repeated words gone; sentences flow and
  connect logically; punctuation correct. A verbatim but hard-to-read transcript loses here.
- Segmentation (10): each item a complete thought, not cut mid-clause, not a wall of text.

Calibration: 90+ = could be filed as the meeting record after a glance; 80 = good, a few slips a careful reader
notices; 70 = usable but several real errors or awkward stretches; <60 = misleading or hard to read.

Score all versions of a case side by side, with the same standard. Return JSON only, one object per case:
{"case": "...", "versions": {"X": {"score": N, "components": {"fidelity": N, "words": N, "readability": N, "segmentation": N}},
                              "Y": {...}},
 "better": "X|Y|tie", "why": "two or three sentences",
 "issues": [{"version": "X|Y", "item": N, "category": "fidelity|words|readability|segmentation", "severity": "major|minor",
             "said": "what the speaker said", "got": "what the version says", "note": "why"}]}
List every major issue and the most instructive minor ones (at most 12 per case).
