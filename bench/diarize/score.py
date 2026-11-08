"""Score every hyp/<tag>/ against the reference turns in $CLIPS (default data/clips). Usage: python ../score.py [tag ...]"""
import json, os, sys
from pathlib import Path
from metrics import score

tags = sys.argv[1:] or sorted(p.name for p in Path("hyp").iterdir())
print(f"{'tag':34} {'clip':10} {'DER':>6} {'miss':>6} {'FA':>6} {'conf':>6} {'turnAcc':>7} {'spk':>5} {'RTF':>6}")
for tag in tags:
    rows = []
    for h in sorted((Path("hyp") / tag).glob("*.json")):
        ref = json.loads((Path(os.environ.get("CLIPS", "data/clips")) / h.name).read_text())
        hy = json.loads(h.read_text())
        s = score([tuple(t) for t in ref], [tuple(t) for t in hy["turns"]])
        s["rtf"] = hy["seconds"] / hy["audio"]
        rows.append(s)
        print(f"{tag:34} {h.stem:10} {s['der']:6.1%} {s['miss']:6.1%} {s['fa']:6.1%} {s['conf']:6.1%} {s['turn_acc']:7.1%} "
              f"{s['hyp_spk']:2}/{s['ref_spk']:<2} {s['rtf']:6.3f}")
    if rows:
        m = lambda k: sum(r[k] for r in rows) / len(rows)
        print(f"{tag:34} {'MEAN':10} {m('der'):6.1%} {m('miss'):6.1%} {m('fa'):6.1%} {m('conf'):6.1%} {m('turn_acc'):7.1%} "
              f"{'':5} {m('rtf'):6.3f}\n")
