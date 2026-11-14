"""Where does content go missing in the quality pass? Run one public benchmark clip through QualityPass offline and log,
for every chunk, what the recognizer returned and what the text model returned. Output: JSON rows on stdout.
Usage (in the app container; REALTIME=1 feeds the audio at the pace it was spoken, which MAI needs):
  docker exec -i [-e REALTIME=1] [-e TRANSLATE_QUALITY_ASR=mai] <app container> python - <wav> <seconds> <language> <target> < bench/omit_probe.py > rows.json
Then: python bench/omit_analyze.py rows.json <language>"""
import asyncio, json, sys, wave

sys.path.insert(0, '/app')
import quality_pass as q

path, seconds, language, target = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
rows, current = [], {}


async def main():
    with wave.open(path) as w:
        pcm = w.readframes(int(seconds * 16000))
    events = []

    async def send(payload):
        events.append(payload)
    quality = q.QualityPass(send, language, target, "", engine_language={"zh": "Chinese", "en": "English", "ja": "Japanese"}[language])
    heard_once, refine_once, process = quality._transcribe, quality._refine, quality._process

    async def transcribe(chunk):
        text = await heard_once(chunk)
        current.setdefault("heard", []).append(text)
        return text

    post = quality.client.post

    async def logged_post(url, **kw):   # every text-model answer, also the ones the coverage check refuses
        response = await post(url, **kw)
        if url.endswith("/chat/completions"):
            try:
                current.setdefault("raw", []).append(response.json()["choices"][0]["message"]["content"])
            except Exception:
                current.setdefault("raw", []).append("?")
        return response
    quality.client.post = logged_post

    async def refine(new, pause, alt, last):
        current.setdefault("tried", []).append({"carry": quality.carry, "new": new, "pause": pause})
        answer = await refine_once(new, pause, alt, last)
        current.setdefault("asked", []).append({"carry": quality.carry, "new": new, "pause": pause, "last": last})
        current.setdefault("answer", []).append(json.loads(json.dumps(answer)))   # a copy: the pass edits the lists afterwards
        return answer

    async def one(chunk):
        current.clear()
        current.update(start=chunk.start_ms, end=chunk.end_ms, speech=round(chunk.speech, 1), cut=chunk.pause)
        try:
            return await process(chunk)
        finally:
            current["carry_after"] = quality.carry
            rows.append(json.loads(json.dumps(current, ensure_ascii=False)))
    quality._transcribe, quality._refine, quality._process = transcribe, refine, one
    import os, time
    realtime, began = os.getenv("REALTIME") == "1", time.monotonic()
    for at in range(0, len(pcm), 6400):
        quality.feed(pcm[at:at + 6400])
        if realtime:   # a recognizer that listens along (MAI) must hear the audio at the pace it was spoken
            await asyncio.sleep(max(0, began + (at + 6400) / 32000 - time.monotonic()))
        else:
            await quality.idle.wait()
    await quality.finish()
    kept = [s for e in events for s in e["quality"].get("sentences") or []]
    failed = sum(bool(e["quality"].get("failed")) for e in events)
    json.dump({"rows": rows, "kept": kept, "failed": failed}, sys.stdout, ensure_ascii=False)

asyncio.run(main())
