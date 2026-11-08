"""MOSS-Transcribe-Diarize on every data/clips/*.wav; writes hyp/<tag>/<clip>.json with turns, raw text, timing.
Usage: python run_moss.py TAG cpu|cuda [threads] [clip-glob]"""
import json, os, sys, time
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoProcessor
from moss_transcribe_diarize import parse_transcript
from moss_transcribe_diarize.inference_utils import build_transcription_messages, generate_transcription

tag, dev = sys.argv[1], sys.argv[2]
if len(sys.argv) > 3:
    torch.set_num_threads(int(sys.argv[3]))
pattern = sys.argv[4] if len(sys.argv) > 4 else "*.wav"
device = torch.device(dev)
dtype = torch.bfloat16 if dev == "cuda" else torch.float32
t0 = time.time()
model = AutoModelForCausalLM.from_pretrained("moss-model", trust_remote_code=True, dtype="auto",
                                             attn_implementation="sdpa").to(dtype=dtype).to(device).eval()
processor = AutoProcessor.from_pretrained("moss-model", trust_remote_code=True)
print("load", round(time.time() - t0, 1), flush=True)
out = Path("hyp") / tag; out.mkdir(parents=True, exist_ok=True)
for wav in sorted(Path(os.environ.get("CLIPS", "data/clips")).glob(pattern)):
    if (out / f"{wav.stem}.json").exists():
        continue
    import soundfile as sf
    dur = sf.info(str(wav)).duration
    t0 = time.time()
    if dev == "cuda":
        torch.cuda.reset_peak_memory_stats()
    res = generate_transcription(model, processor, build_transcription_messages(str(wav)), max_new_tokens=32768,
                                 do_sample=False, device=device, dtype=dtype)
    el = time.time() - t0
    turns = [[s.start, s.end, str(s.speaker)] for s in parse_transcript(res["text"]) if s.end is not None and s.start is not None]
    peak = torch.cuda.max_memory_allocated() / 2**30 if dev == "cuda" else None
    (out / f"{wav.stem}.json").write_text(json.dumps({"turns": turns, "seconds": el, "audio": dur, "peak_gb": peak,
                                                     "text": res["text"]}, ensure_ascii=False))
    print(tag, wav.stem, f"{el:.1f}s for {dur:.0f}s", "peak", peak, flush=True)
