"""E1-a: can behavioural features beat the trivial baseline's precision?

docs/02-research-plan.md E1-a, docs/04-evaluation.md 2.1, ADR-0008, ADR-0011.

THE QUESTION IS NOT "CAN WE DETECT THE RED TEAM"
----------------------------------------------
That is already solved and worthless. `src in {C17693, C22409, C19932, C18025}`
gets recall 100%. Recall is free because the labels only ever have four source
hosts. What that rule cannot do is be precise: 48,079 rows to find 702, i.e.
67 false positives per true positive.

So the entire experiment is precision at fixed recall, using features that do
NOT contain host or account identity. Identity is not in the input file at all
(scripts/Export-AuthFeatures.ps1), so it cannot leak in here.

WEIGHTS ARE NOT OPTIONAL
------------------------
Negatives were subsampled 1-in-500 during extraction. Every metric below is
computed with sample weights, which recovers the numbers that would have come
from scoring all 1.05 billion rows. Reporting unweighted precision on a
1-in-500 sample would inflate it by roughly 500x, which is exactly the kind of
number that gets into a paper and then cannot be reproduced.

SPLIT
-----
Not a single time cut. 75% of the labels fall in three days, so one cut point
decides the result (docs/04). Campaign blocks by day, and the split point is
swept so the sensitivity is reported rather than hidden.

Usage:
  python scripts/run_e1a.py
  python scripts/run_e1a.py --features analysis/lanl/auth-features.csv
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC

DAY = 86400.0

# The four source hosts that carry every label. Used ONLY to reproduce the
# mandatory trivial baseline row, never as a model input.
TRIVIAL_RECALL = 1.0
TRIVIAL_PRECISION = 0.0146
TRIVIAL_ROWS = 48079
TRIVIAL_TP = 702


def weighted_pr(y, score, w):
    """Precision-recall points at every threshold, with sample weights.

    sklearn's average_precision_score takes sample_weight, but precision@k
    does not exist there and k has to mean "k real alerts", not "k sampled
    rows" - so the curve is built here and both come off the same sort.
    """
    order = np.argsort(-score, kind="mergesort")
    y = y[order]
    w = w[order]
    tp = np.cumsum(y * w)
    fp = np.cumsum((1 - y) * w)
    total_pos = (y * w).sum()
    precision = tp / np.maximum(tp + fp, 1e-12)
    recall = tp / max(total_pos, 1e-12)
    return precision, recall, tp, fp


def precision_at_recall(precision, recall, target):
    idx = np.searchsorted(recall, target, side="left")
    if idx >= len(precision):
        return float("nan")
    return float(precision[idx])


def alerts_at_recall(tp, fp, recall, target):
    idx = np.searchsorted(recall, target, side="left")
    if idx >= len(tp):
        return float("nan")
    return float(tp[idx] + fp[idx])


def precision_at_k(precision, tp, fp, k):
    """Precision once k weighted alerts have been raised.

    k is a number of real alerts an analyst would work through, so the
    cumulative weighted alert count is what has to reach k.
    """
    alerts = tp + fp
    idx = np.searchsorted(alerts, k, side="left")
    if idx >= len(precision):
        return float("nan")
    return float(precision[idx])


def evaluate(name, y, score, w, ks=(100, 1000, 10000)):
    precision, recall, tp, fp = weighted_pr(y, score, w)
    out = {
        "model": name,
        "pr_auc": float(average_precision_score(y, score, sample_weight=w)),
        "roc_auc": float(roc_auc_score(y, score, sample_weight=w)),
        "positives": float((y * w).sum()),
        "negatives": float(((1 - y) * w).sum()),
    }
    for r in (0.5, 0.9, 1.0):
        out[f"precision@recall{int(r * 100)}"] = precision_at_recall(precision, recall, r)
        out[f"alerts@recall{int(r * 100)}"] = alerts_at_recall(tp, fp, recall, r)
    for k in ks:
        out[f"precision@{k}"] = precision_at_k(precision, tp, fp, k)
    return out


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--features", default=os.path.join(here, "analysis", "lanl", "auth-features.csv"))
    ap.add_argument("--out", default=os.path.join(here, "eval", "results", "e1a-detection.json"))
    ap.add_argument("--splits", default="20,25,30,35",
                    help="day boundaries to sweep; train < d <= test")
    args = ap.parse_args()

    if not os.path.exists(args.features):
        sys.exit(f"features not found: {args.features}\nrun scripts/Export-AuthFeatures.ps1 first")

    print(f"reading {args.features}")
    df = pd.read_csv(args.features)
    print(f"  rows {len(df):,}   positives {int(df.label.sum()):,}")

    df["day"] = df["t"] / DAY
    feat_cols = [c for c in df.columns if c not in ("t", "label", "w", "day")]
    print(f"  features {len(feat_cols)}: {', '.join(feat_cols)}")

    # Identity is not present. Assert it rather than trust it - this is the one
    # mistake that would make every number below meaningless (ADR-0011).
    banned = [c for c in feat_cols if any(s in c.lower() for s in ("comp", "user", "host", "id"))]
    if banned:
        sys.exit(f"identity-like columns present, refusing to train: {banned}")

    results = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "generator": "scripts/run_e1a.py",
        "experiment": "E1-a",
        "refs": ["docs/02-research-plan.md", "docs/04-evaluation.md 2.1", "ADR-0008", "ADR-0011"],
        "features_file": os.path.abspath(args.features),
        "n_rows": int(len(df)),
        "n_positives": int(df.label.sum()),
        "feature_columns": feat_cols,
        "trivial_baseline": {
            "rule": "src in {C17693, C22409, C19932, C18025}",
            "recall": TRIVIAL_RECALL,
            "precision": TRIVIAL_PRECISION,
            "rows_selected": TRIVIAL_ROWS,
            "true_positives": TRIVIAL_TP,
            "note": "mandatory row (docs/04-evaluation.md). uses host identity, which the models below are not allowed to see.",
        },
        "splits": [],
    }

    for cut in [float(s) for s in args.splits.split(",")]:
        tr = df[df.day <= cut]
        te = df[df.day > cut]
        n_tr_pos = int(tr.label.sum())
        n_te_pos = int(te.label.sum())
        print(f"\n=== split at day {cut}:  train {len(tr):,} ({n_tr_pos} pos)  test {len(te):,} ({n_te_pos} pos)")
        if n_tr_pos < 20 or n_te_pos < 20:
            print("  skipped: too few positives on one side to say anything")
            results["splits"].append({"cut_day": cut, "skipped": "fewer than 20 positives on one side",
                                      "train_pos": n_tr_pos, "test_pos": n_te_pos})
            continue

        Xtr, ytr, wtr = tr[feat_cols].to_numpy(float), tr.label.to_numpy(int), tr.w.to_numpy(float)
        Xte, yte, wte = te[feat_cols].to_numpy(float), te.label.to_numpy(int), te.w.to_numpy(float)

        models = []

        # Rule baseline that does NOT use identity: the most obvious behavioural
        # signal anyone would try first. If the learned models cannot beat this,
        # the learning is not what is doing the work.
        rule = (te.src_hr_dst.to_numpy(float) * (1.0 + te.src_hr_failrate.to_numpy(float)))
        models.append(("rule: hr_dst x (1+hr_failrate)", rule))

        # Linear SVM. docs/04 records a prior study where linear SVM was the
        # strongest baseline; if it wins here too that is the finding.
        svm = make_pipeline(StandardScaler(), LinearSVC(C=0.01, class_weight="balanced", max_iter=5000))
        svm.fit(Xtr, ytr, linearsvc__sample_weight=wtr)
        models.append(("linear svm", svm.decision_function(Xte)))

        lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, class_weight="balanced"))
        lr.fit(Xtr, ytr, logisticregression__sample_weight=wtr)
        models.append(("logistic regression", lr.predict_proba(Xte)[:, 1]))

        gb = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.1, random_state=0)
        gb.fit(Xtr, ytr, sample_weight=wtr)
        models.append(("gradient boosting", gb.predict_proba(Xte)[:, 1]))

        split = {"cut_day": cut, "train_rows": int(len(tr)), "test_rows": int(len(te)),
                 "train_pos": n_tr_pos, "test_pos": n_te_pos, "models": []}
        for name, sc in models:
            m = evaluate(name, yte, np.asarray(sc, float), wte)
            split["models"].append(m)
            print(f"  {name:<32} PR-AUC {m['pr_auc']:.5f}   "
                  f"P@rec50 {m['precision@recall50']:.4f}   "
                  f"P@rec90 {m['precision@recall90']:.4f}   "
                  f"P@1000 {m['precision@1000']:.4f}")

        if hasattr(gb, "feature_importances_"):
            pass  # HistGB has no direct importances; permutation is a later step
        results["splits"].append(split)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    print(f"\nreport: {args.out}")


if __name__ == "__main__":
    main()
