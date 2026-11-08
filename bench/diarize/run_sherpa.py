"""sherpa-onnx diarization on every data/clips/*.wav; writes hyp/<tag>/<clip>.json [[start,end,spk],...] + timing.
Usage: python run_sherpa.py TAG EMB_MODEL THRESHOLD|oracle [THREADS]"""
import json, os, sys, time
from pathlib import Path
import sherpa_onnx, soundfile as sf

tag, emb, thr = sys.argv[1], sys.argv[2], sys.argv[3]
threads = int(sys.argv[4]) if len(sys.argv) > 4 else 8
out = Path("hyp") / tag; out.mkdir(parents=True, exist_ok=True)
for wav in sorted(Path(os.environ.get("CLIPS", "data/clips")).glob("*.wav")):
    ref = json.loads(wav.with_suffix(".json").read_text())
    n = len({t[2] for t in ref}) if thr == "oracle" else -1
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model="models/seg.onnx"), num_threads=threads),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=f"models/{emb}", num_threads=threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=n, threshold=0.5 if thr == "oracle" else float(thr)),
        min_duration_on=0.3, min_duration_off=0.5)
    sd = sherpa_onnx.OfflineSpeakerDiarization(cfg)
    audio, sr = sf.read(str(wav), dtype="float32")
    assert sr == sd.sample_rate
    t0 = time.time()
    res = sd.process(audio).sort_by_start_time()
    el = time.time() - t0
    turns = [[r.start, r.end, f"S{r.speaker}"] for r in res]
    (out / f"{wav.stem}.json").write_text(json.dumps({"turns": turns, "seconds": el, "audio": len(audio) / sr}))
    print(tag, wav.stem, f"{el:.1f}s for {len(audio)/sr:.0f}s", flush=True)
