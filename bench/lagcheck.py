"""How far recognized text trails its audio: sets the review page's playback padding (timeline.js).

For each manual subtitle cue, find the first track event whose accumulated text contains the cue's
last few characters/words; lag = audio sent at that event (sent_s) - cue end. A segment's endMs is
stamped at text arrival, so its speech ended about `lag` earlier; its start is the previous segment's
endMs, whose speech also ended `lag` earlier. Usage: python bench/lagcheck.py
"""
import json, re, statistics, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRACKS = HERE.parent / 'artifacts' / 'replay' / 'tracks'
SUBS = {'en': 'sub.en.vtt', 'ja': 'sub.ja.vtt', 'zh': 'sub.zh-TW.vtt'}
# Clips are cut from the video at case['start']; subtitles keep the video's clock.
STARTS = {c['name']: c['start'] for c in json.loads((HERE / 'cases.json').read_text(encoding='utf-8'))}
sys.stdout.reconfigure(encoding='utf-8')


def norm(text):
    return re.sub(r'[\W_]+', '', text.lower())


def cues(path, offset):
    out = []
    for block in path.read_text(encoding='utf-8').split('\n\n'):
        m = re.search(r'(\d+):(\d+):([\d.]+) --> (\d+):(\d+):([\d.]+)\n(.+)', block, re.S)
        if m:
            end = int(m[4]) * 3600 + int(m[5]) * 60 + float(m[6]) - offset
            out.append((end, norm(m[7])))
    return out


def lags(track, subs, cjk):
    text, arrivals = '', []
    for line in track.read_text(encoding='utf-8').splitlines():
        row = json.loads(line)
        text += norm(row.get('text') or '')
        arrivals.append((len(text), row['sent_s']))
    out, cursor = [], 0
    for end, words in subs:
        if not 0 < end <= 240 or len(words) < 6:
            continue
        key = words[-4:] if cjk else words[-8:]
        found = text.find(key, cursor)
        if found < 0 or found - cursor > 400:   # not recognized nearby: skip rather than misalign
            continue
        cursor = found + len(key)
        sent = next(s for n, s in arrivals if n >= cursor)
        out.append(sent - end)
    return out


results = {}
for track in sorted(TRACKS.glob('*_0_240*.jsonl')):
    case = track.name.split('_0_240')[0].rsplit('_', 1)[0]
    lang = case.split('_')[0]
    sub = HERE / 'data' / case / SUBS.get(lang, '')
    if lang not in SUBS or not sub.exists():
        continue
    engine = 'mai' if '_mai' in track.name else 'local'
    found = lags(track, cues(sub, STARTS.get(case, 0)), lang != 'en')
    results.setdefault((engine, lang), []).extend(found)
    print(f'{track.name:40} cues {len(found):3}  median {statistics.median(found) if found else float("nan"):5.2f}s')

print()
for (engine, lang), values in sorted(results.items()):
    q = statistics.quantiles(values, n=10) if len(values) > 10 else [float('nan')] * 9
    print(f'{engine:5} {lang}: n={len(values):3}  p10 {q[0]:5.2f}  median {statistics.median(values):5.2f}  p90 {q[8]:5.2f} s')
everything = [v for values in results.values() for v in values]
print(f'all: n={len(everything)} median {statistics.median(everything):.2f}s p90 {statistics.quantiles(everything, n=10)[8]:.2f}s')
