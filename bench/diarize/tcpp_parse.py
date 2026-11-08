"""Turn transcribe-cli outputs (tcpp-out/<TAG>/*.txt + times.txt) into hyp/<TAG>/<clip>.json. Usage: tcpp_parse.py TAG CLIPS"""
import json
import re
import sys
import wave
from pathlib import Path

tag, clips = sys.argv[1], Path(sys.argv[2])
src, out = Path("tcpp-out") / tag, Path("hyp") / tag
out.mkdir(parents=True, exist_ok=True)
times = dict(line.split() for line in (src / "times.txt").read_text().splitlines())
for f in src.glob("*.txt"):
    if f.name == "times.txt":
        continue
    turns = [[float(a), float(b), s] for a, b, s in re.findall(r"\[\s*([\d.]+) ->\s*([\d.]+)\] (S\d+):", f.read_text(encoding="utf-8"))]
    with wave.open(str(clips / f"{f.stem}.wav")) as w:
        seconds = w.getnframes() / w.getframerate()
    (out / f"{f.stem}.json").write_text(json.dumps({"turns": turns, "seconds": float(times[f.stem]), "audio": seconds}))
