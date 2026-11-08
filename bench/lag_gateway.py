"""How much later an engine delivers the words (asr-latency): stream a bench clip through /ws/transcribe in
翻譯模式 (no meeting, nothing stored) with a given packet size and record every recognition event with the audio
already sent (sent_s) and the seconds since the start (t). With --compare, line the two tracks up on 8-character
pieces of normalized text and print how much later this run delivered the same words (median / p10 / p90).
Chinese and Japanese clips with manual subtitles also get lagcheck's figure: text behind speech at cue ends.
Usage: YUQIAO_SESSION=<token> python bench/lag_gateway.py <case> <local|mai|hybrid> <chunk_ms> <seconds> <out.jsonl> [--compare other.jsonl]
"""
import argparse, asyncio, json, re, statistics, sys, time, uuid, wave
from pathlib import Path
import websockets

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'webapp'))
import yuqiao_session  # noqa: E402

SUBS = {'en': 'sub.en.vtt', 'ja': 'sub.ja.vtt', 'zh': 'sub.zh-TW.vtt'}
EOS = 'YOUDAO_ONETIME_ASR_STREAM_EOS'
sys.stdout.reconfigure(encoding='utf-8')


def norm(text):
    return re.sub(r'[\W_]+', '', text.lower())


async def record(case, engine, chunk_ms, seconds, url):
    with wave.open(str(HERE / 'data' / case['name'] / 'clip.wav')) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2
        pcm = w.readframes(int(seconds * 16000))
    step = max(1, int(chunk_ms / 1000 * 16000)) * 2
    sent_s, rows = 0.0, []
    async with websockets.connect(url, max_size=None, additional_headers=yuqiao_session.headers()) as ws:
        await ws.send(json.dumps({'requestId': str(uuid.uuid4()), 'meeting_id': '', 'mode': 'translate', 'language': case['language'],
                                  'use_vad': False, 'system_prompt': '', 'engine': engine, 'refine': False}))
        began = time.monotonic()

        async def send():
            nonlocal sent_s
            for i in range(0, len(pcm), step):
                await ws.send(pcm[i:i + step])
                sent_s = (i + step) / 32000
                delay = began + sent_s - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
            await ws.send(EOS)

        sender = asyncio.create_task(send())
        last_rx = time.monotonic()
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1)
            except websockets.ConnectionClosed:
                break
            except asyncio.TimeoutError:
                if sender.done() and time.monotonic() - last_rx > 8:
                    break
                continue
            last_rx = time.monotonic()
            data = json.loads(raw)
            msg = data.get('msg') if isinstance(data.get('msg'), dict) else {}
            rows.append({'sent_s': round(sent_s, 3), 't': round(last_rx - began, 3), 'text': msg.get('text', ''), 'status': data.get('status')})
        await sender
    return rows


def arrivals(rows):
    """(normalized text so far, seconds since start) per event, plus the whole normalized text."""
    out, text = [], ''
    for row in rows:
        text += norm(row.get('text') or '')
        out.append((len(text), row['t']))
    return out, text


def later_than(rows, other):
    """Seconds this track delivered each 8-character piece after the other track did."""
    mine, my_text = arrivals(rows)
    theirs, their_text = arrivals(other)
    out, cursor = [], 0
    for n, t in mine:
        key = my_text[max(0, n - 8):n]
        if len(key) < 8:
            continue
        found = their_text.find(key, cursor)
        if found < 0 or found - cursor > 300:
            continue
        cursor = found + 8
        there = next((t2 for n2, t2 in theirs if n2 >= cursor), None)
        if there is not None:
            out.append(t - there)
    return out


def behind_speech(rows, case, seconds):
    """lagcheck's figure: audio sent when a subtitle cue's last words arrived, minus the cue's end."""
    sub = HERE / 'data' / case['name'] / SUBS.get(case['language'], '')
    if case['language'] == 'en' or not sub.exists():
        return []
    cues = []
    for block in sub.read_text(encoding='utf-8').split('\n\n'):
        m = re.search(r'(\d+):(\d+):([\d.]+) --> (\d+):(\d+):([\d.]+)\n(.+)', block, re.S)
        if m:
            cues.append((int(m[4]) * 3600 + int(m[5]) * 60 + float(m[6]) - case['start'], norm(m[7])))
    text, marks = '', []
    for row in rows:
        text += norm(row.get('text') or '')
        marks.append((len(text), row['sent_s']))
    out, cursor = [], 0
    for end, words in cues:
        if not 0 < end <= seconds or len(words) < 6:
            continue
        key = words[-4:]
        found = text.find(key, cursor)
        if found < 0 or found - cursor > 400:
            continue
        cursor = found + len(key)
        out.append(next(s for n, s in marks if n >= cursor) - end)
    return out


def summary(values):
    if not values:
        return 'n=0'
    q = statistics.quantiles(values, n=10) if len(values) >= 3 else [min(values), max(values)]
    return f'median {statistics.median(values):.2f}s p10 {q[0]:.2f} p90 {q[-1]:.2f} n={len(values)}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('case'); ap.add_argument('engine'); ap.add_argument('chunk_ms', type=float); ap.add_argument('seconds', type=float); ap.add_argument('out')
    ap.add_argument('--compare', help='another track from this tool: print how much later this run delivered the same words')
    ap.add_argument('--url', default='ws://localhost:18082/ws/transcribe')
    a = ap.parse_args()
    cases = {c['name']: c for c in json.loads((HERE / 'cases.json').read_text(encoding='utf-8'))}
    case = cases[a.case]
    rows = asyncio.run(record(case, a.engine, a.chunk_ms, a.seconds, a.url))
    Path(a.out).write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n', encoding='utf-8')
    errors = sum(1 for r in rows if r['status'] == 'error')
    text = ''.join(r['text'] for r in rows)
    print(f"{a.case} {a.engine} chunk={a.chunk_ms:g}ms events={len(rows)} chars={len(text)} errors={errors} first_text_at={next((r['t'] for r in rows if r['text']), None)}")
    lag = behind_speech(rows, case, a.seconds)
    if lag:
        print(f'  behind speech (manual subtitles): {summary(lag)}')
    if a.compare:
        other = [json.loads(line) for line in Path(a.compare).read_text(encoding='utf-8').splitlines() if line.strip()]
        print(f'  later than {Path(a.compare).name}: {summary(later_than(rows, other))}')


if __name__ == '__main__':
    main()
