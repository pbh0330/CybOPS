"""E1-b feature-group ablation.

docs/19 section 15.4: the full-coverage result says histgb on 30 window
features beats the rules in every cell, and nothing yet says WHICH features do
the work. This drops one group at a time (and, separately, keeps one group
alone), refits the same histgb that run_e1b.py uses, and reports the two
numbers docs/04 requires side by side: PR-AUC and hosts caught at budget 100.

Same protocol as run_e1b.py - day cut, test scored once, no subsampling - and
the same model with the same hyperparameters, so the "all" row here must match
the histgb row of the matching e1b-detection-*.json. If it does not, this
script is measuring something else and the ablation is void.

Groups follow the extractor's column families (Export-EcarWindows.ps1):

    volume      n and the per-object-type counts
    actions     a_* action counts
    images      distinct images, first-seen images on this host, their share
    dirs        distinct directories touched
    network     distinct destinations, new destinations, external share
    principals  distinct principals, SYSTEM share
    pids        distinct pids
    selfnorm    n_z, dsts_z - the cell against the host's own running mean
    time        hour, dow

`time` deserves a warning before the numbers arrive. With a day cut the test
day has a weekday the training days never showed, and the red team keeps
office hours. If dropping `time` costs a lot, that is not the model learning
attacks, it is the model learning when the exercise ran.

Usage:
    python scripts/run_e1b_ablation.py --features analysis/optc/ecar-windows-900.v3b.csv --tag w900-v3
"""

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_e1b import evaluate, mttd  # noqa: E402

GROUPS = {
    "volume": ["n", "n_file", "n_proc", "n_flow", "n_module", "n_other"],
    "actions": ["a_create", "a_write", "a_delete", "a_read", "a_rename",
                "a_start", "a_terminate", "a_open", "a_msg"],
    "images": ["images", "new_images", "new_image_share"],
    "dirs": ["dirs"],
    "network": ["dsts", "new_dsts", "new_dst_share", "external_share"],
    "principals": ["principals", "system_share"],
    "pids": ["pids"],
    "selfnorm": ["n_z", "dsts_z"],
    "time": ["hour", "dow"],
}


def fit_score(Xtr, ytr, Xte):
    npos, nneg = max(1, ytr.sum()), max(1, len(ytr) - ytr.sum())
    w = np.ones(len(ytr))
    w[ytr == 1] = nneg / npos
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.1, max_leaf_nodes=15,
                                       l2_regularization=1.0, early_stopping=False, random_state=0)
    m.fit(Xtr, ytr, sample_weight=w)
    return m.predict_proba(Xte)[:, 1]


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--features", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out_path = args.out or os.path.join(here, "eval", "results", f"e1b-ablation-{args.tag}.json")

    side = os.path.splitext(args.features)[0] + ".summary.json"
    with open(side, encoding="utf-8-sig") as fh:
        win = int(json.load(fh)["window_sec"])

    df = pd.read_csv(args.features)
    feat = [c for c in df.columns if c not in ("bucket", "label", "w", "host_key", "day")]
    grouped = sorted(c for g in GROUPS.values() for c in g)
    if grouped != sorted(feat):
        sys.exit(f"feature columns and GROUPS disagree:\n  csv only {sorted(set(feat) - set(grouped))}"
                 f"\n  groups only {sorted(set(grouped) - set(feat))}")
    df["day"] = pd.to_datetime(df.bucket * win, unit="s", utc=True).dt.tz_convert("Etc/GMT+4").dt.date.astype(str)
    days = sorted(df.day.unique())
    print(f"{args.features}: {len(df):,} cells, {int(df.label.sum()):,} positives, window {win} s")

    results = {
        "generator": "scripts/run_e1b_ablation.py",
        "features_file": args.features,
        "window_sec": win,
        "model": "histgb, same hyperparameters as run_e1b.py",
        "groups": GROUPS,
        "splits": [],
    }

    for i in range(len(days) - 1):
        cut = days[i]
        tr, te = df[df.day <= cut], df[df.day > cut]
        ntr, nte = int(tr.label.sum()), int(te.label.sum())
        if ntr < 20 or nte < 20:
            continue
        ytr, yte = tr.label.to_numpy(int), te.label.to_numpy(int)
        wte = np.ones(len(te))
        print(f"\n=== cut {cut}: train {len(tr):,} ({ntr} pos)  test {len(te):,} ({nte} pos)")
        split = {"cut_day": cut, "train_pos": ntr, "test_pos": nte, "rows": []}

        def run(label, cols):
            s = fit_score(tr[cols].to_numpy(float), ytr, te[cols].to_numpy(float))
            ev = evaluate(label, yte, s, wte)
            m100 = mttd(te, s, 100)
            row = {"variant": label, "n_features": len(cols), "pr_auc": ev["pr_auc"],
                   "roc_auc": ev["roc_auc"], "precision@100": ev["precision@100"],
                   "hosts_caught@100": m100["hosts_caught"],
                   "hosts_with_positives": m100["hosts_with_positives"],
                   "median_cells_before_first_hit@100": m100["median_cells_before_first_hit"]}
            split["rows"].append(row)
            print(f"  {label:<20} {len(cols):>2} feat  PR-AUC {ev['pr_auc']:.4f}  ROC {ev['roc_auc']:.3f}  "
                  f"P@100 {ev['precision@100']:.2f}  hosts@100 {m100['hosts_caught']}/{m100['hosts_with_positives']}")
            return row

        base = run("all", feat)
        print("  -- drop one group")
        for g, cols in GROUPS.items():
            r = run(f"drop {g}", [c for c in feat if c not in cols])
            r["delta_pr_auc"] = r["pr_auc"] - base["pr_auc"]
            r["delta_hosts"] = r["hosts_caught@100"] - base["hosts_caught@100"]
        print("  -- keep one group only")
        for g, cols in GROUPS.items():
            run(f"only {g}", cols)
        results["splits"].append(split)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    print(f"\nreport: {out_path}")


if __name__ == "__main__":
    main()
