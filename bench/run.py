"""Benchmark: record ASR tracks (3 at a time), then replay each through the real UI sequentially.
Usage: [ASR_ENGINE=mai|hybrid] python run.py RUN_TAG [case ...]   -> artifacts/replay/<RUN_TAG>_<case>.json/.md
RUN_TAG starting with "cloud" turns 雲端精修 on, starting with "quality" turns 精準模式 on; TRACK_PREFIX=mai_ replays tracks from mai_record.py; REPLAY_LIVE=1 replays in 即時翻譯 mode."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
WEBAPP = HERE.parent / 'webapp'
sys.path.insert(0, str(WEBAPP))
import replay_browser  # noqa: E402

tag, only = sys.argv[1], set(sys.argv[2:])
cases = [c for c in json.loads((HERE / 'cases.json').read_text(encoding='utf-8')) if not only or c['name'] in only]
cases = [c for c in cases if (HERE / 'data' / c['name'] / 'clip.wav').exists()]
tracks = replay_browser.OUT / 'tracks'; tracks.mkdir(parents=True, exist_ok=True)

def args(c):
    return SimpleNamespace(wav=str(HERE / 'data' / c['name'] / 'clip.wav'), start=0.0, duration=float(c['duration']),
                           language=c['language'], context='', track=os.getenv('TRACK_PREFIX', '') + c['name'],
                           engine=os.getenv('ASR_ENGINE', 'local'), cloud_refine=tag.startswith('cloud'),
                           quality=tag.startswith('quality'), target=c['target'])

with ThreadPoolExecutor(3) as pool:
    list(pool.map(lambda c: replay_browser.record_track(args(c), tracks), cases))
print('tracks ready', flush=True)
for c in cases if tag != 'record' else []:
    subprocess.run([sys.executable, str(WEBAPP / 'replay_browser.py'), args(c).wav, '--start', '0', '--duration', str(c['duration']),
                    '--name', f"{tag}_{c['name']}", '--language', c['language'], '--target', c['target'], '--track', args(c).track, '--engine', args(c).engine,
                    *(['--cloud-refine'] if tag.startswith('cloud') else []), *(['--quality'] if tag.startswith('quality') else []),
                    *(['--live'] if os.getenv('REPLAY_LIVE') else [])], check=False)
