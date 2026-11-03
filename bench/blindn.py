"""Blind N runs: <case>.X.md / .Y.md / .Z.md in random order per case.
Usage: python blindn.py OUT SEED RUN_A RUN_B [RUN_C ...]  -> OUT/mapping.json (judges never read it)."""
import json, random, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
out, runs = HERE / 'results' / sys.argv[1], sys.argv[3:]
out.mkdir(parents=True, exist_ok=True)
rng, mapping = random.Random(sys.argv[2]), {}
for sheet in sorted((HERE / 'results' / runs[0]).glob('*.md')):
    case, order = sheet.stem, runs[:]
    rng.shuffle(order)
    mapping[case] = dict(zip('XYZW', order))
    for label, run in mapping[case].items():
        text = (HERE / 'results' / run / f'{case}.md').read_text(encoding='utf-8')
        text = re.sub(r'^# .*$', f'# {case} version {label}', text, count=1, flags=re.M)
        (out / f'{case}.{label}.md').write_text(text, encoding='utf-8')
(out / 'mapping.json').write_text(json.dumps(mapping, indent=1), encoding='utf-8')
print(json.dumps(mapping))
