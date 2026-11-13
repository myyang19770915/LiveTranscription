"""Replay a 16 kHz mono PCM16 wav through the app's /ws/transcribe gateway.
Usage: python replay_asr.py meeting_16k.wav OUT.jsonl [--start S] [--duration S] [--speed X]
Each JSONL row is one gateway event plus the audio position already sent (sent_s),
the ASR-processed position (asr_s, 0.16 s per ASR step), seconds since the first audio
was sent (t) and the untouched gateway message (raw). Recorded at --speed 1, the rows
are an ASR event track that replay_browser.py can play back into the real UI.
"""
import argparse, asyncio, json, time, uuid, wave
import websockets

import yuqiao_session

CHUNK_S = 0.16
EOS = 'YOUDAO_ONETIME_ASR_STREAM_EOS'


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wav'); ap.add_argument('out')
    ap.add_argument('--url', default='ws://localhost:18082/ws/transcribe')
    ap.add_argument('--language', default='zh')
    ap.add_argument('--start', type=float, default=0); ap.add_argument('--duration', type=float, default=0)
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--context', default='')
    ap.add_argument('--engine', default='local', help='local, mai or hybrid (see /api/config)')
    ap.add_argument('--refine', action='store_true', help='雲端精修 on: MAI Chinese is punctuated by the cloud model')
    ap.add_argument('--quality', action='store_true', help='精準模式 on: quality events are recorded with the ASR events (needs TRANSLATE_QUALITY_*)')
    ap.add_argument('--target', default='en', help='translation target for --quality')
    a = ap.parse_args()
    with wave.open(a.wav) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2
        w.setpos(int(a.start * 16000))
        frames = int((a.duration or w.getnframes() / 16000 - a.start) * 16000)
        pcm = w.readframes(frames)
    step = int(CHUNK_S * 16000) * 2
    sent_s, steps, last_rx = a.start, 0, time.monotonic()
    meeting_id = yuqiao_session.create_meeting(a.url, a.language, a.engine)
    async with websockets.connect(a.url, max_size=None, additional_headers=yuqiao_session.headers()) as ws:
        await ws.send(json.dumps({'requestId': str(uuid.uuid4()), 'meeting_id': meeting_id, 'language': a.language, 'use_vad': a.language == 'zh_ja',
                                  'system_prompt': a.context, 'engine': a.engine, 'refine': a.refine,
                                  **({'quality': True, 'target': a.target} if a.quality else {})}))
        began = time.monotonic()

        async def send():
            nonlocal sent_s
            for i in range(0, len(pcm), step):
                await ws.send(pcm[i:i + step])
                sent_s = a.start + (i + step) / 32000
                delay = began + (i + step) / 32000 / a.speed - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
            await ws.send(EOS)  # Same as the UI's stop button: flush the ASR tail.

        sender = asyncio.create_task(send())
        with open(a.out, 'w', encoding='utf-8') as out:
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1)
                except websockets.ConnectionClosed:
                    break
                except asyncio.TimeoutError:
                    # With --quality the gateway closes only after the final quality event (up to 25 s after EOS).
                    if sender.done() and time.monotonic() - last_rx > (40 if a.quality else 8):
                        break
                    continue
                last_rx = time.monotonic()
                data = json.loads(raw)
                if not data:
                    continue
                msg = data.get('msg') if isinstance(data.get('msg'), dict) else {}
                steps += 1
                row = {'sent_s': round(sent_s, 2), 'asr_s': round(a.start + steps * CHUNK_S, 2), 'wall': round(time.monotonic(), 3),
                       'text': msg.get('text', ''), 'reset': bool(msg.get('reset')), 'speech_end': bool(msg.get('speech_end')),
                       'cost_ms': msg.get('total_cost_ms'), 't': round(last_rx - began, 3), 'raw': raw}
                if data.get('status') == 'error':
                    row['error'] = data.get('msg')
                out.write(json.dumps(row, ensure_ascii=False) + '\n')
        await sender


if __name__ == '__main__':
    asyncio.run(main())
