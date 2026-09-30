"""End-to-end WebSocket smoke test using a user-supplied PCM WAV file."""

import argparse
import asyncio
import json
import sys
import uuid
import wave

import websockets

sys.stdout.reconfigure(encoding="utf-8")


async def run(uri: str, audio_path: str, language: str = "zhen", realtime: bool = False) -> None:
    with wave.open(audio_path, "rb") as audio:
        if audio.getparams()[:3] != (1, 2, 16000):
            raise ValueError("Expected mono, 16-bit, 16 kHz PCM WAV audio")
        pcm = audio.readframes(audio.getnframes())

    texts: list[str] = []
    display_text = ""
    async with websockets.connect(uri, ping_interval=None) as socket:
        await socket.send(json.dumps({
            "requestId": str(uuid.uuid4()),
            "language": language,
            "use_vad": False,
        }))
        for offset in range(0, len(pcm), 5120):
            chunk = pcm[offset:offset + 5120]
            await socket.send(chunk)
            if realtime:
                await asyncio.sleep(len(chunk) / 32000)
        await socket.send("YOUDAO_ONETIME_ASR_STREAM_EOS")

        try:
            while True:
                response = json.loads(await asyncio.wait_for(socket.recv(), 10))
                message = response.get("msg", {})
                text = message.get("text", "") if isinstance(message, dict) else ""
                if text:
                    texts.append(text)
                    print(f"PART: {text}", flush=True)
                if isinstance(response.get("displayText"), str):
                    display_text = response["displayText"]
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            pass

    transcript = "".join(texts)
    if not transcript:
        raise RuntimeError("ASR returned no transcript")
    print(f"FINAL: {transcript}")
    if display_text:
        print(f"DISPLAY: {display_text}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--uri", default="ws://127.0.0.1:18082/ws/transcribe")
    parser.add_argument("--audio", required=True, help="Mono, 16-bit, 16 kHz PCM WAV file")
    parser.add_argument("--language", default="zhen")
    parser.add_argument("--realtime", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.uri, args.audio, args.language, args.realtime))
