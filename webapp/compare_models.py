"""Translate the same finalized source spans with several translation endpoints, using the
production payload and the same single repair pass, so models are compared on identical input.
Run inside the app container (it imports server.py):
  cat artifacts/replay/v2_rpa_excel.json | docker exec -i asr_confucius4-r2t2-app-1 \
    python compare_models.py e2b=http://translate:5000 qwen=http://candidate:5000 --glossary "LINE、n8n" > out.jsonl
Each output line: {"name", "source", "<endpoint>": {"text", "issues", "repaired", "ms"}}.
"""
import argparse, asyncio, json, sys, time
import httpx
from server import TranslationRequest, resolve_translation_direction, source_text, translation_payload
from translation_quality import violations


async def translate(client, url, model, body):
    started = time.monotonic()
    payload = {**translation_payload(body), "stream": False, "model": model}
    choice = (await client.post(f"{url}/v1/chat/completions", json=payload)).json()["choices"][0]
    text = choice["message"]["content"].strip()
    source = source_text(body)
    issues, repaired = violations(source, text, "ja", body.glossary), False
    if issues:
        payload["messages"][0]["content"] += "\nMandatory checks: " + " ".join(issues)
        text = (await client.post(f"{url}/v1/chat/completions", json=payload)).json()["choices"][0]["message"]["content"].strip()
        issues, repaired = violations(source, text, "ja", body.glossary), True
    return {"text": text, "issues": issues, "repaired": repaired, "ms": round((time.monotonic() - started) * 1000)}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("endpoints", nargs="+", help="name=http://host:port")
    ap.add_argument("--glossary", default="")
    a = ap.parse_args()
    replay = json.load(sys.stdin)
    spans = [s["source"] for s in replay["segments"] if s["state"] == "finalized"]
    endpoints = [e.split("=", 1) for e in a.endpoints]
    async with httpx.AsyncClient(timeout=120) as client:
        models = {}
        for name, url in endpoints:
            models[name] = (await client.get(f"{url}/v1/models")).json()["data"][0]["id"]
        for source in spans:
            body = TranslationRequest(text=source, source="zh_ja", target="zh", detected_language="zh", glossary=a.glossary)
            resolved, target = resolve_translation_direction(body)
            body = body.model_copy(update={"source": resolved, "target": target})
            row = {"source": source}
            for name, url in endpoints:  # sequential: endpoints may share one GPU
                row[name] = await translate(client, url, models[name], body)
            print(json.dumps(row, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
