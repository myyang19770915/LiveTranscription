import json, sys
from pathlib import Path
sys.argv = ['x', '_trackcer']  # evaluate.py's helpers only; its run loop is cut off below
exec(open(Path(__file__).resolve().parent / 'evaluate.py', encoding='utf-8').read().split('summary = {}')[0])
T = HERE.parent / 'artifacts' / 'replay' / 'tracks'
def final_text(p):
    out = ''
    for e in json.loads(p.read_text(encoding='utf-8')):
        d = json.loads(e['raw'])
        if isinstance(d.get('displayText'), str): out = d['displayText']
        elif isinstance(d.get('msg'), dict): out += d['msg'].get('text', '')
    return out
for c in json.loads((HERE / 'cases.json').read_text(encoding='utf-8')):
    subs = HERE / 'data' / c['name']; lang = c['language']
    refs = {p.name.split('.')[1]: vtt(p, c['start'], c['start'] + c['duration']) for p in sorted(subs.glob('sub.*.vtt'))}
    ref = next((refs[k] for k in refs if k.split('-')[0] == lang and 'orig' not in k), None) or next((refs[k] for k in refs if k.split('-')[0] == lang), None)
    r = norm(to_traditional(' '.join(ref)) if lang == 'zh' else ' '.join(ref), lang)
    row = [c['name']]
    for pre in ('', 'mai_'):
        h = final_text(T / f"{pre}{c['name']}_{lang}_0_240.json")
        h = norm(to_traditional(h) if lang == 'zh' else h, lang)
        row.append(f"{distance(r, h) / len(r):.3f}")
    print(*row, sep='\t')
