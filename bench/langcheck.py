"""Compare ASR outputs from artifacts/langtest/ (replay_asr.py rows) with each clip's reference subtitles.
Usage: python langcheck.py [cases_lang.json]"""
import json, sys
from pathlib import Path
sys.argv = ['x', '_langcheck'] + sys.argv[1:]
exec(open(Path(__file__).resolve().parent / 'evaluate.py', encoding='utf-8').read().split('summary = {}')[0])  # helpers only
LT = HERE.parent / 'artifacts' / 'langtest'
cases = json.loads(Path(sys.argv[2] if len(sys.argv) > 2 else HERE / 'cases_lang.json').read_text(encoding='utf-8'))

def final_text(path):
    text = ''
    for line in path.read_text(encoding='utf-8').splitlines():
        data = json.loads(json.loads(line)['raw'])
        if isinstance(data.get('displayText'), str):
            text = data['displayText']
    return text

for c in cases:
    subs = HERE / 'data' / c['name']
    refs = [vtt(p, c['start'], c['start'] + c['duration']) for p in sorted(subs.glob('sub.*.vtt'))]
    ref = ' '.join(refs[0]) if refs else ''
    lang = 'en' if c['language'] == 'id' else 'zh'  # word error rate for Indonesian, character rate otherwise
    print(f"\n######## {c['name']}  reference: {ref[:300] or '(none)'}")
    for path in sorted(LT.glob(f"{c['name']}_*.jsonl")):
        hyp = final_text(path)
        err = ''
        if ref:
            r, h = norm(to_traditional(ref) if lang == 'zh' else ref, lang), norm(to_traditional(hyp) if lang == 'zh' else hyp, lang)
            err = f"{distance(r, h) / max(len(r), 1):.3f}"
        print(f"--- {path.stem}  err={err}  chars={len(hyp)}\n{hyp[:300]}")
