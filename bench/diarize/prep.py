"""Cut evaluation clips from argmax's AliMeeting / AISHELL-4 parquet shards (Hugging Face datasets
argmaxinc/ali-meetings and argmaxinc/aishell-4, test split): the first MINUTES of up to N meetings per shard, as 16 kHz
mono wav plus reference turns json [[start_s, end_s, speaker], ...].

Usage (in bench/diarize/work, inside the evaluation image): python ../prep.py MINUTES N OUT name=shard.parquet ...
  e.g. python ../prep.py 10 2 data/clips ali=data/ali0.parquet aishell=data/aishell0.parquet
"""
import io
import json
import sys
from pathlib import Path

import pyarrow.parquet as pq
import soundfile as sf

minutes, per, out = float(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
for spec in sys.argv[4:]:
    name, shard = spec.split("=", 1)
    pf = pq.ParquetFile(shard)
    done = 0
    for group in range(pf.num_row_groups):
        for row in pf.read_row_group(group).to_pylist():
            if done >= per:
                break
            audio, rate = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32", always_2d=True)
            audio = audio.mean(1)
            if rate != 16000:
                import soxr
                audio, rate = soxr.resample(audio, rate, 16000), 16000
            cut = minutes * 60
            audio = audio[: int(cut * rate)]
            turns = [[float(s), min(float(e), cut), str(p)]
                     for s, e, p in zip(row["timestamps_start"], row["timestamps_end"], row["speakers"]) if float(s) < cut]
            stem = f"{name}{done:02d}"
            sf.write(out / f"{stem}.wav", audio, rate, subtype="PCM_16")
            (out / f"{stem}.json").write_text(json.dumps(turns))
            print(stem, row["audio"].get("path"), f"{len(audio) / rate:.0f}s", "speakers", len({t[2] for t in turns}), flush=True)
            done += 1
        if done >= per:
            break
