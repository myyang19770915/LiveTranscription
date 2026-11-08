"""Diarization scoring: DER (frame based, 10 ms, optimal speaker mapping, collar around reference boundaries) and
turn accuracy (each reference single-speaker turn >= 1 s, labelled with the hypothesis speaker that overlaps it
most, after the same mapping; weighted by duration) - the latter is what a reader of a transcript sees."""
import numpy as np

FRAME = 0.01


def to_matrix(turns, labels, n):
    m = np.zeros((len(labels), n), dtype=bool)
    for s, e, spk in turns:
        a, b = int(round(s / FRAME)), int(round(e / FRAME))
        m[labels.index(spk), max(0, a):min(n, b)] = True
    return m


def best_map(ref, hyp):
    """Hungarian on overlap (scipy if present, else brute force for small sets, else greedy)."""
    ov = ref.astype(np.int64) @ hyp.T.astype(np.int64)
    try:
        from scipy.optimize import linear_sum_assignment
        r, c = linear_sum_assignment(-ov)
        return dict(zip(c.tolist(), r.tolist()))
    except ImportError:
        pairs, used_r, used_c, mp = sorted(((ov[i, j], i, j) for i in range(ov.shape[0]) for j in range(ov.shape[1])), reverse=True), set(), set(), {}
        for v, i, j in pairs:
            if i not in used_r and j not in used_c:
                mp[j] = i; used_r.add(i); used_c.add(j)
        return mp


def score(ref_turns, hyp_turns, collar=0.25):
    end = max([e for _, e, _ in ref_turns] + [e for _, e, _ in hyp_turns] + [0])
    n = int(np.ceil(end / FRAME)) + 1
    rl, hl = sorted({t[2] for t in ref_turns}), sorted({t[2] for t in hyp_turns})
    ref, hyp = to_matrix(ref_turns, rl, n), to_matrix(hyp_turns, hl, n)
    mask = np.ones(n, dtype=bool)
    c = int(round(collar / FRAME))
    for s, e, _ in ref_turns:
        for t in (s, e):
            k = int(round(t / FRAME)); mask[max(0, k - c):k + c] = False
    mp = best_map(ref, hyp)
    mapped = np.zeros_like(ref)
    for j, i in mp.items():
        mapped[i] |= hyp[j]
    nref, nhyp = ref.sum(0), hyp.sum(0)
    correct = (ref & mapped).sum(0)
    total = nref[mask].sum()
    miss = np.maximum(nref - nhyp, 0)[mask].sum()
    fa = np.maximum(nhyp - nref, 0)[mask].sum()
    conf = (np.minimum(nref, nhyp) - correct)[mask].sum()
    # turn accuracy
    good = tot = 0.0
    inv = {v: k for k, v in mp.items()}
    for s, e, spk in ref_turns:
        if e - s < 1.0:
            continue
        a, b = int(round(s / FRAME)), int(round(e / FRAME))
        cover = hyp[:, a:b].sum(1)
        tot += e - s
        if cover.sum() and mp.get(int(cover.argmax())) == rl.index(spk):
            good += e - s
    return {"der": (miss + fa + conf) / max(total, 1), "miss": miss / max(total, 1), "fa": fa / max(total, 1),
            "conf": conf / max(total, 1), "turn_acc": good / max(tot, 1e-9), "ref_spk": len(rl), "hyp_spk": len(hl)}
