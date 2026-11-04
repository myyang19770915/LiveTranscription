"""Translate one span with and without the following-speech context."""
import json, sys, httpx
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'webapp'))
import yuqiao_session  # noqa: E402
cases = json.loads(open(sys.argv[1], encoding='utf-8').read())
for body in cases:
    r = httpx.post('http://localhost:18082/api/translate', json=body, headers=yuqiao_session.headers(), timeout=60)
    print(body.get('following', '')[:20] or '-', '=>', r.json().get('translatedText'))
