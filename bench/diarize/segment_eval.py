"""Segment-level speaker accuracy of a diarized meeting recorded with segment_eval.mjs (run in the app container):
  docker exec -w /app asr_confucius4-r2t2-app-1 python /bench/segment_eval.py <meeting id> /bench/<reference>.json

The reference is the clip's turns [[start_s, end_s, speaker], ...]. The recording starts a moment after the clip, so the
offset is found first (the shift, within +-5 s, at which the diarization's turns agree best with the reference). Each
segment's true speaker is the reference speaker who talks most in its span moved 1 s earlier (segments are stamped when
text appears); a segment is "clear" when that speaker is the same for 0.5-2 s and holds at least 70% of the span. The
diarization's labels are mapped to reference speakers by overlap. Reports the share of segments whose speaker is right
for the text alignment used by the app (diarize.assign) and for time overlap alone.
"""
import asyncio
import json
import sys

sys.path.insert(0, "/app")
import db        # noqa: E402
import diarize   # noqa: E402


def overlap_by(turns_a, turns_b):
    """{(label_a, label_b): ms} of time both talk."""
    out = {}
    for a in turns_a:
        for b in turns_b:
            shared = min(a[1], b[1]) - max(a[0], b[0])
            if shared > 0:
                out[(a[2], b[2])] = out.get((a[2], b[2]), 0) + shared
    return out


def mapping(turns, ref):
    """Greedy one-to-one label mapping by shared time (diarization label -> reference speaker)."""
    pairs = sorted(overlap_by(turns, ref).items(), key=lambda kv: -kv[1])
    out, used = {}, set()
    for (label, speaker), _ in pairs:
        if label not in out and speaker not in used:
            out[label] = speaker
            used.add(speaker)
    return out, sum(v for (label, speaker), v in overlap_by(turns, ref).items() if out.get(label) == speaker)


def dominant(ref, start, end):
    talk = {}
    for s, e, who in ref:
        shared = min(end, e) - max(start, s)
        if shared > 0:
            talk[who] = talk.get(who, 0) + shared
    if not talk:
        return None, 0
    who = max(talk, key=talk.get)
    return who, talk[who] / max(1, end - start)


async def main(meeting_id, reference):
    async with db.connect() as conn:
        job = await (await conn.execute("SELECT status, turns FROM diarizations WHERE meeting_id = %s", (meeting_id,))).fetchone()
        segments = await (await conn.execute("SELECT seq, start_ms, end_ms, source, speaker FROM segments WHERE meeting_id = %s ORDER BY seq",
                                             (meeting_id,))).fetchall()
    if not job or job["status"] != "done":
        sys.exit(f"diarization not done: {job and job['status']}")
    turns = [diarize.Turn(*t) for t in job["turns"]]
    raw = [[round(s * 1000), round(e * 1000), who] for s, e, who in json.load(open(reference))]
    offset = max(range(-5000, 5001, 100), key=lambda o: mapping(turns, [[s + o, e + o, w] for s, e, w in raw])[1])
    ref = [[s + offset, e + offset, w] for s, e, w in raw]
    labels, _ = mapping(turns, ref)
    rows = {"all": [0, 0, 0], "clear": [0, 0, 0]}
    for seg in segments:
        truths = {dominant(ref, seg["start_ms"] - lag, seg["end_ms"] - lag)[0] for lag in (500, 1000, 1500, 2000)}
        truth, share = dominant(ref, seg["start_ms"] - 1000, seg["end_ms"] - 1000)
        if truth is None:
            continue
        text = labels.get(diarize.speaker_of(seg["start_ms"], seg["end_ms"], seg["source"], turns))
        time_only = labels.get(diarize.speaker_of(seg["start_ms"], seg["end_ms"], "", turns))
        groups = ["all"] + (["clear"] if len(truths) == 1 and share >= 0.7 else [])
        for group in groups:
            rows[group][0] += 1
            rows[group][1] += text == truth
            rows[group][2] += time_only == truth
    print(f"offset {offset} ms, segments {len(segments)}, diarization speakers {len({t.label for t in turns})}, reference {len({w for *_, w in raw})}")
    for group, (n, text, time_only) in rows.items():
        if n:
            print(f"{group:5} n={n:3}  text alignment {text / n:6.1%}  time overlap only {time_only / n:6.1%}")


asyncio.run(main(sys.argv[1], sys.argv[2]))
