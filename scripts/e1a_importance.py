"""Which behavioural features carry the E1-a signal?

docs/04-evaluation.md states the contribution point as a question: can the
combination of features and time context narrow "top 3.6% of hosts" down to
"top 0.01%"? Having shown that it can, the next thing a reader needs is WHICH
features did it - otherwise the result is a number with no mechanism behind it,
and nobody can tell whether it would survive a different network.

Permutation importance, not a tree's internal split counts. Split counts reward
high-cardinality columns regardless of whether they predict anything;
permutation asks the only question that matters - shuffle this column and see
how much the metric falls.

The metric permuted against is weighted PR-AUC, not accuracy (ADR-0008).

TWO THINGS THE FIRST VERSION GOT WRONG
--------------------------------------
1. It subsampled the test negatives to 400,000, rescaled the weights, and then
   printed the resulting PR-AUC as if it were the model's score. Precision is a
   ratio of sums, so E[tp/(tp+fp)] is not E[tp]/E[tp+fp]: with few sampled
   negatives near the top of the ranking, fp is often zero there and precision
   reads 1.0. Cut 12 came out at 0.674 against the 0.230 the real evaluation
   reports - inflated three-fold.

   The subsample is still used, because permutation on the full 9.2M-row test
   set needs 38 features x repeats full sorts per split and ran for three and a
   half hours without finishing one split. What changed is the reporting: the
   TRUE baseline is read from the evaluation JSON, the subsample baseline is
   labelled as the reference the deltas are measured against, and the two are
   printed side by side. Both baselines are the same model on the same split, so
   the ranking of the drops is comparable even though the absolute level is not.

2. It hardcoded one model. The protocol SELECTS a model per split on validation,
   and at cut 15 that was the balanced-weight variant while this script fitted
   the true-weight one - so it reported the importances of a model nobody would
   deploy (PR-AUC 0.00114 against the selected model's 0.762). The selection is
   read back from the evaluation's own JSON now.

Usage:
  python scripts/e1a_importance.py --results eval/results/e1a-detection-dense-nolife.json
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score

DAY = 86400.0


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--features", default=os.path.join(here, "analysis", "lanl", "auth-features2-n100.csv"))
    ap.add_argument("--out", default=os.path.join(here, "eval", "results", "e1a-importance.json"))
    ap.add_argument("--results", default=os.path.join(here, "eval", "results",
                                                      "e1a-detection-dense-nolife.json"),
                    help="the evaluation whose selected model per split is reproduced here")
    ap.add_argument("--neg-sample", type=int, default=300000)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--seed", type=int, default=20260908)
    args = ap.parse_args()

    # Which model won on validation, per split. Re-deriving it here would be a
    # second implementation of the selection rule and a second chance to differ
    # from it.
    selected = {}
    if os.path.exists(args.results):
        res = json.load(open(args.results, encoding="utf-8"))
        for s in res.get("splits", []):
            sel = s.get("selected")
            if sel:
                selected[float(s["cut_day"])] = sel["model"]
    if not selected:
        sys.exit(f"no selections found in {args.results} - run scripts/run_e1a.py first")
    print(f"selected models from {os.path.basename(args.results)}:")
    for k, v in sorted(selected.items()):
        print(f"  cut {k:>4.0f}  {v}")

    print(f"reading {args.features}")
    df = pd.read_csv(args.features)
    for c in df.columns:
        if c in ("t", "grp"):
            df[c] = df[c].astype("int64")
        elif c == "label":
            df[c] = df[c].astype("int8")
        elif df[c].dtype == "float64":
            df[c] = df[c].astype("float32")
    df["day"] = df["t"] / DAY

    feat = [c for c in df.columns if c not in ("t", "label", "w", "day", "grp")]
    lifetime = [c for c in feat if "_life_" in c or c == "pair_seen"]
    feat = [c for c in feat if c not in lifetime]
    print(f"  rows {len(df):,}  features {len(feat)} (lifetime columns dropped: {len(lifetime)})")

    rng = np.random.default_rng(args.seed)
    report = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "generator": "scripts/e1a_importance.py",
        "metric": "weighted PR-AUC drop under permutation",
        "features_file": os.path.abspath(args.features),
        "dropped_lifetime": lifetime,
        "caveat": "explanatory statistic. pr_auc_full_test is the reportable number and agrees with the evaluation JSON. pr_auc_subsample_reference is the level the permutation deltas are measured against - it is inflated by negative subsampling and must not be quoted as performance.",
        "selected_from": os.path.abspath(args.results),
        "cuts": [],
    }

    for cut in sorted(selected):
        tr = df[df.day <= cut]
        te_full = df[df.day > cut]
        te = te_full
        if tr.label.sum() < 20 or te.label.sum() < 20:
            print(f"\n=== cut {cut}: skipped (too few positives)")
            continue

        spec = selected[cut]
        lr = float(spec.split("lr=")[1].split(",")[0]) if "lr=" in spec else 0.1
        leaves = int(spec.split("leaves=")[1].split(",")[0].rstrip(")")) if "leaves=" in spec else 15
        wmode = spec.split("w=")[1].rstrip(")") if "w=" in spec else "true"

        print(f"\n=== cut {cut}:  train {len(tr):,} ({int(tr.label.sum())} pos)   "
              f"test {len(te):,} ({int(te.label.sum())} pos)   model {spec}")

        Xtr = tr[feat].to_numpy(np.float32); ytr = tr.label.to_numpy(int); wtr = tr.w.to_numpy(float)
        Xte = te[feat].to_numpy(np.float32); yte = te.label.to_numpy(int); wte = te.w.to_numpy(float)

        if wmode == "balanced":
            npos = max(1.0, float((ytr == 1).sum())); nneg = max(1.0, float((ytr == 0).sum()))
            wfit = np.ones_like(wtr); wfit[ytr == 1] = nneg / npos
        else:
            wfit = wtr

        m = HistGradientBoostingClassifier(max_iter=400, learning_rate=lr, max_leaf_nodes=leaves,
                                           l2_regularization=1.0, early_stopping=False, random_state=0)
        m.fit(Xtr, ytr, sample_weight=wfit)

        true_base = float(average_precision_score(yte, m.predict_proba(Xte)[:, 1], sample_weight=wte))

        # Now switch to a subsample for the permutation loop. Same model, same
        # split; only the level shifts, and the level is not what is being read
        # off this table.
        pos = te_full[te_full.label == 1]
        neg_all = te_full[te_full.label == 0]
        take = min(args.neg_sample, len(neg_all))
        idx = rng.choice(len(neg_all), size=take, replace=False)
        neg = neg_all.iloc[idx].copy()
        neg["w"] = neg["w"].to_numpy(float) * (len(neg_all) / take)
        te_s = pd.concat([pos, neg])
        Xte = te_s[feat].to_numpy(np.float32)
        yte = te_s.label.to_numpy(int)
        wte = te_s.w.to_numpy(float)

        base = float(average_precision_score(yte, m.predict_proba(Xte)[:, 1], sample_weight=wte))
        print(f"  PR-AUC on the full test set (the reported number) : {true_base:.5f}")
        print(f"  PR-AUC on the {take:,}-negative subsample used below: {base:.5f}"
              f"   <- deltas are relative to this, not to the line above")

        drops = []
        for j, name in enumerate(feat):
            vals = []
            for r in range(args.repeats):
                Xp = Xte.copy()
                Xp[:, j] = Xp[rng.permutation(len(Xp)), j]
                s = m.predict_proba(Xp)[:, 1]
                vals.append(base - float(average_precision_score(yte, s, sample_weight=wte)))
            drops.append({"feature": name, "mean_drop": float(np.mean(vals)),
                          "sd": float(np.std(vals))})
        drops.sort(key=lambda d: -d["mean_drop"])

        print(f"  {'feature':<24}{'PR-AUC drop':>14}{'share':>9}")
        total = sum(max(0.0, d["mean_drop"]) for d in drops) or 1.0
        for d in drops[:12]:
            print(f"  {d['feature']:<24}{d['mean_drop']:>14.5f}{max(0.0, d['mean_drop']) / total * 100:>8.1f}%")

        report["cuts"].append({"cut_day": cut, "pr_auc_full_test": true_base,
                               "pr_auc_subsample_reference": base,
                               "neg_subsample": int(take), "model": spec,
                               "train_pos": int(tr.label.sum()), "test_pos": int(te.label.sum()),
                               "importances": drops})

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
    print(f"\nreport: {args.out}")


if __name__ == "__main__":
    main()
