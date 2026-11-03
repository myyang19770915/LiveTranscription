"""Objective part of the benchmark: ASR error rate against the subtitle window, plus a review sheet
(segments with source / final translation, and the reference subtitles) for the human-style judge.
Usage: python evaluate.py RUN_TAG  -> bench/results/RUN_TAG/<case>.md and summary.json"""
import json, re, sys, unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPLAY = HERE.parent / 'artifacts' / 'replay'
tag = sys.argv[1]
OUT = HERE / 'results' / tag; OUT.mkdir(parents=True, exist_ok=True)

def ts(s):
    h, m, rest = s.split(':') if s.count(':') == 2 else ('0', *s.split(':'))
    return int(h) * 3600 + int(m) * 60 + float(rest)

def vtt(path, start, end):
    """Text of cues inside [start, end]; rolling auto-caption lines are de-duplicated."""
    out, last = [], None
    for block in path.read_text(encoding='utf-8').split('\n\n'):
        m = re.search(r'([\d:.]+) --> ([\d:.]+)', block)
        if not m or not (start - 1 <= ts(m.group(1)) < end):
            continue
        for line in block.split('\n')[1:]:
            line = re.sub(r'<[^>]+>', '', line).strip()
            if line and '-->' not in line and line != last:
                out.append(line); last = line
    return out

def norm(text, lang):
    text = unicodedata.normalize('NFKC', text).lower()
    if lang == 'en':
        return re.findall(r"[a-z0-9']+", text)
    return [c for c in text if c.isalnum()]

def distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]

def to_traditional(text):
    try:
        from opencc import OpenCC
        return OpenCC('s2twp').convert(text)
    except ImportError:
        return text

summary = {}
for c in json.loads((HERE / 'cases.json').read_text(encoding='utf-8')):
    raw = REPLAY / f"{tag}_{c['name']}.json"
    if not raw.exists():
        continue
    data = json.loads(raw.read_text(encoding='utf-8'))
    subs = HERE / 'data' / c['name']
    window = (c['start'], c['start'] + c['duration'])
    refs = {p.name.split('.')[1]: vtt(p, *window) for p in sorted(subs.glob('sub.*.vtt'))}
    src_lang = {'en': 'en', 'ja': 'ja', 'zh': 'zh'}[c['language']]
    src_ref = next((refs[k] for k in refs if k.split('-')[0] == src_lang and 'orig' not in k), None) or \
              next((refs[k] for k in refs if k.split('-')[0] == src_lang), None)
    finals = sorted((s for s in data['segments'] if s['state'] == 'finalized'), key=lambda s: s['start'])
    hyp = data['transcript']
    if src_ref:
        ref = ' '.join(src_ref)
        r, h = norm(to_traditional(ref) if src_lang == 'zh' else ref, src_lang), norm(to_traditional(hyp) if src_lang == 'zh' else hyp, src_lang)
        err = round(distance(r, h) / max(len(r), 1), 3)
    else:
        err = None
    learned = data.get('learned', '')
    summary[c['name']] = {'asr_error': err, 'segments': len(finals), 'chars': len(hyp), 'learned': learned}
    lines = [f"# {c['name']} ({c['language']}→{c['target']})", '',
             f"- ASR {'WER' if src_lang == 'en' else 'CER'} vs subtitles: {err}", f"- learned terms: {learned or '-'}", '',
             '## System output (finalized segments)', '']
    for i, s in enumerate(finals, 1):
        lines += [f"[{i}] SRC: {s['source']}", f"[{i}] OUT: {s['target']}", '']
    for k, v in refs.items():
        lines += [f'## Reference subtitles: {k}', '', '\n'.join(v), '']
    (OUT / f"{c['name']}.md").write_text('\n'.join(lines), encoding='utf-8')
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=1))
