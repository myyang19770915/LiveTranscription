"""Health check of the qwen-asr service: three seconds of a synthetic voice-like sound through the transcription API.

The first transcription after a start takes about 30 seconds (the model warms up), longer than 精準模式 waits for
a chunk. Checking with a real request makes that happen right after the start instead of in a meeting's first chunk,
and reports the service healthy only once it answers in time.
"""
import array
import io
import json
import math
import sys
import urllib.request
import wave

buffer = io.BytesIO()
with wave.open(buffer, "wb") as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(16000)
    # Silence is answered without running the model; a buzzing tone with a syllable rhythm is not.
    samples = array.array("h", (int(9000 * (0.5 + 0.5 * math.sin(2 * math.pi * 4 * n / 16000))
                                    * sum(math.sin(2 * math.pi * 140 * k * n / 16000) / k for k in range(1, 9)) / 2) for n in range(48000)))
    out.writeframes(samples.tobytes())
boundary = "yuqiao-health"
parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{sys.argv[1]}\r\n'.encode(),
         f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="silence.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
         + buffer.getvalue() + b"\r\n", f"--{boundary}--\r\n".encode()]
request = urllib.request.Request("http://127.0.0.1:8000/v1/audio/transcriptions", b"".join(parts),
                                 {"Content-Type": f"multipart/form-data; boundary={boundary}"})
json.load(urllib.request.urlopen(request, timeout=float(sys.argv[2])))
