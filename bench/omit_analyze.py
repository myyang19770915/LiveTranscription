"""Attribute lost content per chunk: recognizer (few characters for the speech heard) or text model (output shorter than input)."""
import json, re, sys, unicodedata

def units(text, lang):
    text = unicodedata.normalize('NFKC', text or '').lower()
    return re.findall(r"[a-z0-9']+", text) if lang == 'en' else [c for c in text if c.isalnum()]

for path, lang in zip(sys.argv[1::2], sys.argv[2::2]):
    d = json.load(open(path, encoding='utf-8'))
    rows = d['rows']
    heard = sum(len(units(''.join(r.get('heard', [])[-1:]), lang)) for r in rows)
    kept = sum(len(units(s['source'], lang)) for s in d['kept'])
    print(f"\n== {path.split('/')[-1]}: chunks {len(rows)}, failed {d['failed']}, recognizer {heard} units, kept {kept} units ({kept / max(heard, 1):.0%})")
    rates = sorted(len(units(''.join(r.get('heard', [])[-1:]), lang)) / r['speech'] for r in rows if r['speech'] >= 2)
    median = rates[len(rates) // 2]
    print(f"   recognizer units per second of speech: median {median:.1f}, lowest {[round(x, 1) for x in rates[:4]]}")
    for i, r in enumerate(rows, 1):
        new = ''.join(r.get('heard', [])[-1:])
        rate = len(units(new, lang)) / max(r['speech'], 0.1)
        flags = []
        if r['speech'] >= 2 and rate < median * 0.55:
            flags.append(f"RECOGNIZER LOW {rate:.1f}/s")
        for asked, answer in zip(r.get('asked', []), r.get('answer', [])):
            given = len(units(asked['carry'] + ' ' + asked['new'], lang))
            back = len(units(' '.join(s.get('src', '') for s in answer.get('sentences', [])) + ' ' + (answer.get('carry') or ''), lang))
            if given >= 8 and back < given * 0.85:
                flags.append(f"MODEL DROPPED {given}->{back}")
            elif back > given * 1.2 + 3:
                flags.append(f"MODEL ADDED {given}->{back}")
        if not r.get('asked') and new.strip():
            flags.append('NOT ASKED')
        if flags:
            print(f"   chunk {i:2} {r['start'] / 1000:6.1f}-{r['end'] / 1000:6.1f}s speech {r['speech']:4.1f}s cut={r['cut']}: {'; '.join(flags)}")
            if any('MODEL' in f for f in flags):
                a, q = r['answer'][-1], r['asked'][-1]
                print('      IN  carry:', q['carry'][:150]); print('      IN  new  :', q['new'][:260])
                print('      OUT sent :', ' | '.join(s.get('src', '') for s in a.get('sentences', []))[:300]); print('      OUT carry:', (a.get('carry') or '')[:150])
            else:
                print('      heard:', new[:200])
