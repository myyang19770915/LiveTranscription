import httpx, time, sys
from pathlib import Path
env = {}
for line in open(Path(__file__).resolve().parent.parent / '.env', encoding='utf-8'):
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1); env[k.strip()] = v.strip()
# litellm
u, m, key = env['litellm_url'].rstrip('/'), env['litellm_model'], env['litellm_key']
t = time.time()
r = httpx.post(f'{u}/v1/chat/completions', headers={'Authorization': f'Bearer {key}'}, timeout=60,
               json={'model': m, 'messages': [{'role': 'user', 'content': 'Translate to Traditional Chinese (Taiwan), output only the translation: The odds are probably not in your favor.'}], 'max_tokens': 200})
print('litellm', r.status_code, round(time.time()-t, 2), 's', r.text[:400])
# azure
wav = sys.argv[1]
t = time.time()
with open(wav, 'rb') as f:
    r = httpx.post(env['AZURE_MAI_ENDPOINT'], headers={'api-key': env['AZURE_MAI_API_KEY']}, timeout=120,
                   files={'file': ('a.wav', f, 'audio/wav')}, data={'model': env['AZURE_MAI_DEPLOYMENT']})
print('azure', r.status_code, round(time.time()-t, 2), 's', r.text[:600])
