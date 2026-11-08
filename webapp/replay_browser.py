"""Replay a meeting clip through the real web UI (headless Chromium) and report
how the translation pane evolved: drafts, finals, rewrites, latency and source coverage.
Usage: python replay_browser.py meeting_16k.wav --start S --duration S --name rpa [--language zh_ja]
The clip is first recorded once through ASR in real time (replay_asr.py) into
artifacts/replay/tracks/; later runs reuse that track, so translation changes are compared
on identical ASR input. Writes artifacts/replay/<name>.json (timeline) and <name>.md.
"""
import argparse, hashlib, json, re, statistics, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'artifacts' / 'replay'


def record_track(a, tracks):
    # The meeting context is an ASR prompt, so it changes recognition and needs its own track.
    tag = '_ctx' + hashlib.sha1(a.context.encode()).hexdigest()[:8] if a.context else ''
    # Cloud ASR is another recognizer; with 雲端精修 its Chinese punctuation also comes from the cloud model.
    if a.engine != 'local':
        tag += f'_{a.engine}' + ('p' if a.cloud_refine else '')
    # Different recordings need their own track even with the same language and window.
    prefix = f'{a.track}_' if a.track else ''
    track = tracks / f'{prefix}{a.language}_{a.start:g}_{a.duration:g}{tag}.json'
    if not track.exists():
        rows = tracks / (track.stem + '.jsonl')
        subprocess.run([sys.executable, str(HERE / 'replay_asr.py'), a.wav, str(rows), '--start', str(a.start),
                        '--duration', str(a.duration), '--language', a.language, '--context', a.context,
                        '--engine', a.engine, *(['--refine'] if a.cloud_refine else [])], check=True)
        events = [json.loads(line) for line in rows.read_text(encoding='utf-8').splitlines()]
        track.write_text(json.dumps([{'t': e['t'], 'raw': e['raw']} for e in events], ensure_ascii=False), encoding='utf-8')
    return track


def report(name, start, data):
    finals = [s for s in data['segments'] if s['state'] == 'finalized']
    requests = data.get('requests', [])
    draft_ms = [r['ms'] for r in requests if r['kind'] == 'draft' and 'ms' in r and not r.get('error')]
    final_ms = [r['ms'] for r in requests if r['kind'] == 'final' and 'ms' in r and not r.get('error')]
    renders = data['log']
    first = next((r['t'] for r in renders if r['translated'] or r['draft']), None)
    # A finalized span must start exactly where the previous one ended; gaps mean dropped source.
    gaps, cursor = [], 0
    for s in sorted(finals, key=lambda s: s['start']):
        if s['start'] != cursor:
            gaps.append((cursor, s['start']))
        cursor = s['end']
    tail = len(data['transcript']) - cursor
    drafts_per_segment = {}
    for r in renders:
        if r['draft']:
            drafts_per_segment.setdefault(r['offset'], set()).add(r['draft'])
    unfinished = [s for s in finals if not re.search(r'[。！？!?.」』）)]\s*$', s['target'])]
    ordered = sorted(finals, key=lambda s: s['start'])
    # Source cut mid-sentence (the last span is cut by the clip end, so it is excluded).
    cut = [s for s in ordered[:-1] if not re.search(r'[。！？!?；;.]\s*$', s['source'].strip())]
    # Clause ends (comma) are intended for long run-on speech; a span with no mark at all is a hard cut.
    hard = [s for s in cut if not re.search(r'[，,、]\s*$', s['source'].strip())]
    wrong_language = [s for s in finals if re.search(r'[一-鿿]', s['source']) and not re.search(r'[぀-ヿ]', s['target'])]
    p = lambda xs, q: round(statistics.quantiles(xs, n=20)[q - 1]) if len(xs) >= 2 else (xs[0] if xs else None)
    lines = [f'# Replay {name}', '',
             f'- 片段起點：{start:.0f}s（{int(start // 3600):02d}:{int(start % 3600 // 60):02d}:{int(start % 60):02d}），音訊結束於 {data.get("audioEnded", 0) / 1000:.0f}s',
             f'- 原文 {len(data["transcript"])} 字，定稿 {len(finals)} 句，畫面更新 {len(renders)} 次',
             f'- 首次出現譯文：{first / 1000 if first else "-"}s',
             f'- 翻譯請求：暫譯 {len(draft_ms)} 次（中位 {p(draft_ms, 10)} ms / p95 {p(draft_ms, 19)} ms），定稿 {len(final_ms)} 次（中位 {p(final_ms, 10)} ms / p95 {p(final_ms, 19)} ms），失敗或中止 {sum(1 for r in requests if r.get("error"))} 次',
             f'- 每句暫譯版本數：平均 {statistics.mean(len(v) for v in drafts_per_segment.values()):.1f}，最多 {max((len(v) for v in drafts_per_segment.values()), default=0)}' if drafts_per_segment else '- 每句暫譯版本數：-',
             f'- 原文覆蓋：缺口 {len(gaps)} 處 {gaps[:5]}，未定稿尾段 {tail} 字',
             f'- 定稿譯文缺句末標點：{len(unfinished)} / {len(finals)}',
             f'- 定稿原文非句末結束：{len(cut)} / {max(len(finals) - 1, 0)}（其中無標點硬切 {len(hard)}；不含片段結尾）',
             f'- 定稿譯文不是日文：{len(wrong_language)} / {len(finals)}', '',
             '## 逐句對照', '']
    for i, s in enumerate(sorted(finals, key=lambda s: s['start']), 1):
        versions = sorted(drafts_per_segment.get(s['start'], []), key=len)
        lines += [f'### {i}. [{s["start"]}–{s["end"]}] v{s["version"]}', '', f'**原文**：{s["source"]}', '', f'**定稿**：{s["target"]}', '']
        if versions:
            lines += ['暫譯歷程：', *[f'- {v}' for v in versions], '']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wav'); ap.add_argument('--start', type=float, required=True); ap.add_argument('--duration', type=float, required=True)
    ap.add_argument('--name', required=True); ap.add_argument('--language', default='zh_ja'); ap.add_argument('--target', default='ja')
    ap.add_argument('--context', default=''); ap.add_argument('--app', default='http://localhost:18082/')
    ap.add_argument('--track', default='', help='recording name; keeps tracks of different wavs apart')
    ap.add_argument('--cloud-refine', action='store_true', help='turn 雲端精修 on (needs TRANSLATE_REFINE_* configured)')
    ap.add_argument('--engine', default='local', help='ASR engine for recording the track: local, mai or hybrid')
    ap.add_argument('--save-meeting', action='store_true', help='store the replay as a meeting (segments, no recording) for the review page')
    ap.add_argument('--live', action='store_true', help='replay in 即時翻譯 mode (subtitle-sized segments) instead of 開會')
    a = ap.parse_args()
    tracks = OUT / 'tracks'; tracks.mkdir(parents=True, exist_ok=True)
    track = json.loads(record_track(a, tracks).read_text(encoding='utf-8'))
    cfg_path, raw = OUT / f'{a.name}.config.json', OUT / f'{a.name}.json'
    cfg_path.write_text(json.dumps({'app': a.app, 'replay': {'track': track, 'duration': a.duration, 'language': a.language,
                                                              'target': a.target, 'context': a.context, 'cloudRefine': a.cloud_refine,
                                                              'saveMeeting': a.save_meeting, 'live': a.live}},
                                    ensure_ascii=False), encoding='utf-8')
    subprocess.run(['node', str(HERE / 'replay_page.mjs'), str(cfg_path), str(raw)], check=True)
    cfg_path.unlink()
    data = json.loads(raw.read_text(encoding='utf-8'))
    (OUT / f'{a.name}.md').write_text(report(a.name, a.start, data), encoding='utf-8')
    print(f'wrote {raw} and {OUT / (a.name + ".md")}')


if __name__ == '__main__':
    main()
