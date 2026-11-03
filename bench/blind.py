"""Copy two runs' review sheets into a blind folder as <case>.X.md / <case>.Y.md in random order.
Usage: python blind.py RUN_A RUN_B OUT  -> writes the mapping to OUT/mapping.json (judges never read it)."""
import json, random, re, shutil, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
a, b, out = sys.argv[1], sys.argv[2], HERE / 'results' / sys.argv[3]
out.mkdir(parents=True, exist_ok=True)
rng, mapping = random.Random(sys.argv[4] if len(sys.argv) > 4 else 20261102), {}
for sheet in sorted((HERE / 'results' / a).glob('*.md')):
    case = sheet.stem
    order = [a, b] if rng.random() < 0.5 else [b, a]
    mapping[case] = dict(zip('XY', order))
    for label, run in mapping[case].items():
        text = (HERE / 'results' / run / f'{case}.md').read_text(encoding='utf-8')
        # The run name must not leak into the sheet.
        text = re.sub(r'^# .*$', f'# {case} version {label}', text, count=1, flags=re.M)
        (out / f'{case}.{label}.md').write_text(text, encoding='utf-8')
(out / 'mapping.json').write_text(json.dumps(mapping, indent=1), encoding='utf-8')
print(json.dumps(mapping))
