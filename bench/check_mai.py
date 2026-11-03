import asyncio, base64, json, sys, time, wave
from pathlib import Path
from urllib.parse import urlsplit
from websockets.asyncio.client import connect
env = {}
for line in open(Path(__file__).resolve().parent.parent / '.env', encoding='utf-8'):
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1); env[k.strip()] = v.strip()
host = urlsplit(env['AZURE_MAI_ENDPOINT']).hostname.split('.')[0]
url = f'wss://{host}.services.ai.azure.com/mai/v1/realtime?intent=transcription'
async def main(wav, lang):
    w = wave.open(wav); pcm = w.readframes(w.getnframes())
    async with connect(url, additional_headers={'api-key': env['AZURE_MAI_API_KEY']}) as ws:
        print(json.loads(await ws.recv())['type'])
        tr = {'model': env['AZURE_MAI_DEPLOYMENT']}
        if lang: tr['language'] = lang
        await ws.send(json.dumps({'type': 'session.update', 'session': {'type': 'transcription', 'audio': {'input': {
            'format': {'type': 'audio/pcm', 'rate': 16000}, 'transcription': tr, 'turn_detection': None}}}}))
        t0 = time.time()
        async def send():
            step = 3200  # 100 ms
            for i in range(0, len(pcm), step):
                await ws.send(json.dumps({'type': 'input_audio_buffer.append', 'audio': base64.b64encode(pcm[i:i+step]).decode()}))
                await asyncio.sleep(0.1)
            await ws.send(json.dumps({'type': 'input_audio_buffer.commit'}))
        task = asyncio.create_task(send())
        while True:
            e = json.loads(await asyncio.wait_for(ws.recv(), 30))
            t = e['type']
            if t.endswith('delta'): print(f'{time.time()-t0:5.1f} D', e['delta'])
            elif t.endswith('intermediate'): pass
            elif t.endswith('completed'): print(f'{time.time()-t0:5.1f} COMPLETED', e['transcript']); break
            else: print(t, str(e)[:300])
        await task
asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ''))
