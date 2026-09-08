"""How much of the OpTC manifest is actually on disk, by phase.

The one number that matters for E1-b is phase 4 (24Sep19, Day 2). Every
labelled cell that currently has telemetry sits on Day 1, because Day 1 is
phase 2 and phase 2 is the only eCAR phase that finished. No day-boundary
split exists until phase 4 moves off zero.

"done" counts a file whose size on disk is at least the manifest size. That is
a size check, not an identity check: a file can be exactly the right length and
still be the wrong bytes (2026-09-06). Run scripts/Test-GzipIntegrity.ps1
before deriving anything from newly arrived files.

Usage:
    python scripts/optc_progress.py
    python scripts/optc_progress.py --root D:/somewhere/optc
"""

import argparse
import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PHASE_NAME = {
    1: "ecar-bro (all day folders)",
    2: "ecar 23Sep19-red (Day 1)",
    3: "ecar 25Sept (Day 3)",
    4: "ecar 24Sep19 (Day 2)",
    5: "ecar 23Sep-night",
    6: "bro",
}


def collect(node, out):
    if isinstance(node, dict):
        if "rel_path" in node and "phase" in node:
            out.append(node)
        for v in node.values():
            collect(v, out)
    elif isinstance(node, list):
        for v in node:
            collect(v, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=os.path.join(HERE, "configs", "manifests", "optc.json"))
    ap.add_argument("--root", default=os.path.join("F:", os.sep, "mc-cycop-data", "raw", "optc"))
    args = ap.parse_args()

    with open(args.manifest, encoding="utf-8-sig") as fh:
        manifest = json.load(fh)

    rows = []
    collect(manifest, rows)

    seen = set()
    agg = defaultdict(lambda: [0, 0, 0, 0])   # files, done, want, have
    for r in rows:
        key = (r["rel_path"], r["phase"])
        if key in seen:
            continue
        seen.add(key)
        path = os.path.join(args.root, r["rel_path"].replace("/", os.sep))
        have = os.path.getsize(path) if os.path.exists(path) else 0
        want = r.get("bytes", 0)
        a = agg[r["phase"]]
        a[0] += 1
        a[1] += 1 if want > 0 and have >= want else 0
        a[2] += want
        a[3] += have

    print()
    print("{:<6} {:<28} {:>6} {:>6} {:>10} {:>10} {:>6}".format(
        "phase", "what", "files", "done", "want GB", "have GB", "pct"))
    print("-" * 78)
    tw = th = 0
    for ph in sorted(agg):
        files, done, want, have = agg[ph]
        tw += want
        th += have
        print("{:<6} {:<28} {:>6} {:>6} {:>10.1f} {:>10.1f} {:>5.0f}%".format(
            ph, PHASE_NAME.get(ph, "?"), files, done, want / 1e9, have / 1e9,
            100 * have / max(1, want)))
    print("-" * 78)
    print("{:<6} {:<28} {:>6} {:>6} {:>10.1f} {:>10.1f} {:>5.0f}%".format(
        "", "total", sum(a[0] for a in agg.values()), sum(a[1] for a in agg.values()),
        tw / 1e9, th / 1e9, 100 * th / max(1, tw)))

    p4 = agg.get(4)
    if p4 and p4[3] == 0:
        print()
        print("phase 4 is at zero. Until it moves, every labelled cell with telemetry is")
        print("on Day 1 and E1-b has no day boundary to split on (docs/19 section 10).")
    print()


if __name__ == "__main__":
    main()
