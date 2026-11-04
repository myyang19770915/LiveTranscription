"""Download a 16 kHz mono clip plus manual/auto subtitles for each benchmark video.
Usage: python fetch.py [cases.json]"""
import json, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
YT = shutil.which('yt-dlp') or sys.exit('yt-dlp not found: pip install -r bench/requirements.txt')
CASES = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else HERE / 'cases.json').read_text(encoding='utf-8'))
DATA = HERE / 'data'

for c in CASES:
    out = DATA / c['name']; out.mkdir(parents=True, exist_ok=True)
    wav = out / 'clip.wav'
    if not wav.exists():
        # Whole-file download then a local cut: section downloads stall on long videos.
        for p in out.glob('audio.*'):
            p.unlink()
        subprocess.run([YT, '-q', '--no-part', '-f', 'bestaudio[ext=m4a]/bestaudio', '-o', str(out / 'audio.%(ext)s'),
                        f"https://www.youtube.com/watch?v={c['id']}"], check=True)
        src = next(p for p in out.glob('audio.*'))
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', str(c['start']), '-t', str(c['duration']), '-i', str(src),
                        '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', str(wav)], check=True)
        src.unlink()
    langs = ','.join(c['subs'])
    subprocess.run([YT, '-q', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', langs, '--sub-format', 'vtt',
                    '-o', str(out / 'sub'), f"https://www.youtube.com/watch?v={c['id']}"])
    print(c['name'], sorted(p.name for p in out.iterdir()), flush=True)
