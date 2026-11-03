"""Record an MAI-Transcribe-2-Streaming track in the app's gateway format (artifacts/replay/tracks/mai_<case>_...json).
MAI writes no punctuation for zh/ja and has no server VAD, so a local energy VAD commits at zh/ja pauses and the
bridge appends 。 (long pause) or ，/、 (short pause) after the committed text, marking speech_end like the gateway.
English is punctuated by MAI itself, and a commit makes it end the sentence there ("despite."), so it only commits at the end."""
import array, asyncio, base64, json, math, sys, time, wave
from pathlib import Path
from urllib.parse import urlsplit
import opencc
from websockets.asyncio.client import connect

HERE = Path(__file__).resolve().parent
TRACKS = HERE.parent / 'artifacts' / 'replay' / 'tracks'
env = {}
for line in open(HERE.parent / '.env', encoding='utf-8'):
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1); env[k.strip()] = v.strip()
URL = f"wss://{urlsplit(env['AZURE_MAI_ENDPOINT']).hostname.split('.')[0]}.services.ai.azure.com/mai/v1/realtime?intent=transcription"
S2TW = opencc.OpenCC('s2tw')
FRAME = 320 * 2  # 20 ms
COMMIT_SIL, LONG_SIL = 0.4, 0.8

async def record(case):
    name, lang = case['name'], case['language']
    out = TRACKS / f"mai_{name}_{lang}_0_{case['duration']:g}.json"
    if out.exists(): return name, 'cached'
    w = wave.open(str(HERE / 'data' / name / 'clip.wav')); pcm = w.readframes(int(case['duration'] * 16000))
    rms = [math.sqrt(sum(x * x for x in array.array('h', pcm[i:i + FRAME])) / 320) for i in range(0, len(pcm) - FRAME + 1, FRAME)]
    srt = sorted(rms); thr = max(150, 2.5 * srt[len(srt) // 7])
    pauses = []
    events, state = [], {'raw': '', 'sil': 0.0, 'speech': False, 'commits': 0}
    def emit(t, text, speech_end=False):
        state['raw'] += text
        display = S2TW.convert(state['raw']) if lang == 'zh' else state['raw']
        msg = {'text': S2TW.convert(text) if lang == 'zh' else text, 'reset': False, 'speech_end': speech_end, 'language': lang}
        events.append({'t': round(t, 3), 'raw': json.dumps({'status': 'success', 'msg': msg, **({'displayText': display} if text else {})}, ensure_ascii=False)})
    async with connect(URL, additional_headers={'api-key': env['AZURE_MAI_API_KEY']}, max_size=None) as ws:
        assert json.loads(await ws.recv())['type'] == 'session.created'
        await ws.send(json.dumps({'type': 'session.update', 'session': {'type': 'transcription', 'audio': {'input': {
            'format': {'type': 'audio/pcm', 'rate': 16000}, 'transcription': {'model': env['AZURE_MAI_DEPLOYMENT'], 'language': lang},
            'turn_detection': None}}}}))
        while json.loads(await ws.recv())['type'] != 'session.updated': pass
        t0 = time.monotonic()
        events.append({'t': 0.0, 'raw': json.dumps({'status': 'connected', 'msg': ''})})
        async def send():
            for n, i in enumerate(range(0, len(pcm), FRAME * 5)):  # 100 ms appends, real time
                await ws.send(json.dumps({'type': 'input_audio_buffer.append', 'audio': base64.b64encode(pcm[i:i + FRAME * 5]).decode()}))
                for f in range(i // FRAME, min(len(rms), i // FRAME + 5)):
                    if rms[f] >= thr: state['speech'], state['sil'] = True, 0.0
                    else:
                        state['sil'] += 0.02
                        if lang in ('zh', 'ja') and state['speech'] and state['sil'] >= COMMIT_SIL:
                            state['speech'] = False; state['commits'] += 1
                            # The pause length is known before 'completed' returns (~1 s later): look 0.7 s ahead.
                            ahead = rms[f + 1:f + 1 + int((LONG_SIL - COMMIT_SIL) / 0.02)]
                            pauses.append(all(x < thr for x in ahead))
                            await ws.send(json.dumps({'type': 'input_audio_buffer.commit'}))
                await asyncio.sleep(max(0, t0 + (n + 1) * 0.1 - time.monotonic()))
            state['commits'] += 1; pauses.append(True)
            await ws.send(json.dumps({'type': 'input_audio_buffer.commit'}))
        sender = asyncio.create_task(send()); done = 0
        while not (sender.done() and done >= state['commits']):
            try: e = json.loads(await asyncio.wait_for(ws.recv(), 20))
            except asyncio.TimeoutError: break
            t, kind = time.monotonic() - t0, e.get('type', '')
            if kind.endswith('transcription.delta') and e.get('delta'): emit(t, e['delta'])
            elif kind.endswith('transcription.completed'):
                done += 1
                long_pause = pauses[0] if pauses else False
                tail = state['raw'].rstrip()[-1:]
                if lang not in ('zh', 'ja') or not tail or tail in '。！？!?，、,.': pauses and pauses.pop(0)
                if lang in ('zh', 'ja') and tail and tail not in '。！？!?，、,.':
                    emit(t, '。' if (pauses.pop(0) if pauses else False) else ('、' if lang == 'ja' else '，'), True)
                else: emit(t, '', True)
            elif kind in ('error',) or kind.endswith('failed'): print(name, 'ERROR', e); break
        await sender
    out.write_text(json.dumps(events, ensure_ascii=False), encoding='utf-8')
    return name, f"{state['commits']} commits, {len(state['raw'])} chars, thr={thr:.0f}"

async def main():
    cases = [c for c in json.loads((HERE / 'cases.json').read_text(encoding='utf-8')) if len(sys.argv) < 2 or c['name'] in sys.argv[1:]]
    for r in await asyncio.gather(*(record(c) for c in cases), return_exceptions=True): print(r)
asyncio.run(main())
