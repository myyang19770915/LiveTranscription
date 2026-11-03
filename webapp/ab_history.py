"""A/B the translation context on fixed source spans from a replay report.

Usage: python ab_history.py REPLAY.json OUT.json [--context GLOSSARY]
Each finalized span is translated three ways: alone, with the previous source,
and with the previous source plus its translation from the same arm.
"""
import argparse, json, sys, urllib.request

ARMS = ("none", "prev_source", "prev_source+translation")


def translate(app, text, glossary, history="", history_translation=""):
    body = json.dumps({"text": text, "source": "zh", "target": "ja", "glossary": glossary,
                       "history": history, "history_translation": history_translation}).encode()
    request = urllib.request.Request(app + "api/translate", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)["translatedText"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("replay"); ap.add_argument("out")
    ap.add_argument("--context", default=""); ap.add_argument("--app", default="http://localhost:18082/")
    a = ap.parse_args()
    data = json.load(open(a.replay, encoding="utf-8"))
    sources = [s["source"] for s in sorted((s for s in data["segments"] if s["state"] == "finalized"), key=lambda s: s["start"])]
    rows = []
    for i, source in enumerate(sources):
        row = {"source": source}
        for arm in ARMS:
            previous = rows[-1] if rows else None
            history = previous["source"] if previous and arm != "none" else ""
            history_translation = previous[arm] if previous and arm == "prev_source+translation" else ""
            row[arm] = translate(a.app, source, a.context, history, history_translation)
        rows.append(row)
        print(f"{i + 1}/{len(sources)}", file=sys.stderr, flush=True)
    json.dump(rows, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
