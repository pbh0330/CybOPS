"""Tabulate E1-b across window sizes.

The window size is not a hyperparameter to be tuned away. It changes what a
positive IS: at 60 s an operator action lands in one cell, at 900 s it shares a
cell with fifteen minutes of ordinary work. So the three runs are three
different experiments and the table has to show the units alongside the scores,
or the reader compares a PR-AUC over 180,000 cells with one over 12,000 and
concludes that longer windows are better.

Coverage travels with every row. eCAR ships per-host-range files and not all of
them are on disk, so some labelled cells have no telemetry at all. A recall
number without that share next to it invites the reader to blame the model for
a missing download.

Usage:
    python scripts/summarise_e1b.py
    python scripts/summarise_e1b.py --glob "eval/results/e1b-detection-w*.json"
"""

import argparse
import glob
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fmt(v, spec="{:.4f}", dash="-"):
    return dash if v is None else spec.format(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default=os.path.join(HERE, "eval", "results", "e1b-detection-*.json"))
    args = ap.parse_args()

    reports = []
    for path in sorted(glob.glob(args.glob)):
        with open(path, encoding="utf-8-sig") as fh:
            reports.append((os.path.basename(path), json.load(fh)))
    if not reports:
        raise SystemExit("no E1-b reports matched " + args.glob)

    print()
    print("E1-b window sensitivity")
    print("-" * 96)
    print("{:<10} {:>7} {:>10} {:>8} {:>10} {:>9} {:>8}".format(
        "tag", "window", "cells", "pos", "labelled", "coverage", "splits"))
    for name, r in sorted(reports, key=lambda kv: kv[1].get("window_sec") or 0):
        splits = r.get("splits") or []
        scored = [s for s in splits if not s.get("skipped")]
        print("{:<10} {:>6}s {:>10,} {:>8} {:>10} {:>9} {:>8}".format(
            r.get("tag", "?"), r.get("window_sec", 0), r.get("n_cells", 0), r.get("n_positives", 0),
            r.get("labelled_cells_expected", "-"),
            fmt(r.get("label_coverage"), "{:.0%}"),
            "{}/{}".format(len(scored), len(splits))))

    print()
    print("scored splits")
    print("-" * 96)
    any_scored = False
    for name, r in sorted(reports, key=lambda kv: kv[1].get("window_sec") or 0):
        for sp in (r.get("splits") or []):
            if sp.get("skipped"):
                continue
            any_scored = True
            print("  {:<10} {:>5}s  cut {}  train_pos {:>4}  test_pos {:>4}  "
                  "PR-AUC {}  P@100 {}  MTTD {}".format(
                      r.get("tag", "?"), r.get("window_sec", 0), sp.get("cut_day"),
                      sp.get("train_pos", 0), sp.get("test_pos", 0),
                      fmt(sp.get("pr_auc")), fmt(sp.get("p_at_100"), "{:.2%}"),
                      fmt(sp.get("mttd_cells"), "{:.1f}")))
    if not any_scored:
        print("  none. Every split was refused for having fewer than 20 positives on one side.")
        print("  That is the rule from docs/19-e1b-design.md section 6 doing its job, not a failure:")
        print("  with the phase 3-5 downloads incomplete there is no day boundary with enough")
        print("  labelled cells on both sides. The number to watch is the coverage column above.")

    print()


if __name__ == "__main__":
    main()
