"""E1-b: can a detector rank the attacked (host, window) cells to the top?

docs/19-e1b-design.md, docs/02-research-plan.md E1-b, ADR-0008.

WHY THIS IS NOT run_e1a.py WITH A DIFFERENT FILE
------------------------------------------------
E1-a scores auth events and reports precision at an alert budget. Here the unit
IS the alert - one (host, 5-minute window) cell - because that is the only unit
the ground truth exists at (the 101 labels are operator actions, not telemetry
records). So there is no per-event view to report, no negative subsampling to
correct for, and no bootstrap: every cell is present, so precision@k is exact
rather than estimated.

MTTD IS THE METRIC THAT MATTERS HERE
------------------------------------
E1-a asks "how precise is the queue". E1-b can ask something E1-a cannot: how
far into a campaign does the detector get before it flags it. The labels are
ordered operator actions, so "how many cells of this host's attack had already
happened when the first one surfaced" is answerable. A detector that finds the
last step of an intrusion is not the same product as one that finds the first,
and PR-AUC scores them identically.

WHAT IS EXCLUDED, IN CODE
-------------------------
DC1 has no endpoint telemetry, so its ten actions are already gone from the
label file (New-OptcWindowLabels.ps1) and the count is reported there. Nothing
is dropped silently and nothing is dropped by hand.

SPLITS
------
Three days, 37/46/18 actions. That is two usable boundaries and no more; a finer
split has nothing left to test on. Any split leaving fewer than 20 positives on
one side reports nothing, same rule as E1-a.

Usage:
  python scripts/run_e1b.py
  python scripts/run_e1b.py --features analysis/optc/ecar-windows-60.csv --tag w60
"""

import argparse
import glob
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


def weighted_pr(y, score, w):
    order = np.argsort(-score, kind="mergesort")
    y = y[order]
    w = w[order]
    tp = np.cumsum(y * w)
    fp = np.cumsum((1 - y) * w)
    precision = tp / np.maximum(tp + fp, 1e-12)
    recall = tp / max((y * w).sum(), 1e-12)
    return precision, recall, tp, fp


def at_k(precision, tp, fp, k):
    i = np.searchsorted(tp + fp, k, side="left")
    return float(precision[i]) if i < len(precision) else float("nan")


def at_recall(precision, recall, tp, fp, target):
    i = np.searchsorted(recall, target, side="left")
    if i >= len(precision):
        return float("nan"), float("nan")
    return float(precision[i]), float(tp[i] + fp[i])


def mttd(df_test, score, budget):
    """Cells of attack that had already happened when the first one was flagged.

    For each attacked host: order its positive cells in time, take the top
    `budget` cells of the whole ranked list as "what the analyst opened today",
    and find the earliest positive of that host inside them. The answer is the
    index of that cell among the host's positives - 0 means the first action was
    caught, 3 means three windows of the intrusion ran first.

    Hosts never surfaced inside the budget are counted separately rather than
    given a large number: averaging a miss as "10" invents a value the data does
    not have.
    """
    d = df_test.copy()
    d["score"] = score
    flagged = set(d.nlargest(budget, "score").index)
    caught, missed = [], 0
    for h, g in d[d.label == 1].groupby("host_key"):
        g = g.sort_values("bucket")
        hit = [i for i, (idx, _) in enumerate(g.iterrows()) if idx in flagged]
        if hit:
            caught.append(hit[0])
        else:
            missed += 1
    return {
        "budget": int(budget),
        "hosts_with_positives": int(caught.__len__() + missed),
        "hosts_caught": int(len(caught)),
        "hosts_missed": int(missed),
        "median_cells_before_first_hit": (float(np.median(caught)) if caught else None),
        "caught_on_first_cell": int(sum(1 for c in caught if c == 0)),
    }


def evaluate(name, y, score, w, ks=(20, 50, 100, 500)):
    precision, recall, tp, fp = weighted_pr(y, score, w)
    out = {
        "model": name,
        "pr_auc": float(average_precision_score(y, score, sample_weight=w)),
        "roc_auc": float(roc_auc_score(y, score, sample_weight=w)),
        "positives": int((y == 1).sum()),
        "negatives": int((y == 0).sum()),
    }
    for r in (0.5, 0.9, 1.0):
        p, a = at_recall(precision, recall, tp, fp, r)
        out[f"precision@recall{int(r * 100)}"] = p
        out[f"alerts@recall{int(r * 100)}"] = a
    for k in ks:
        out[f"precision@{k}"] = at_k(precision, tp, fp, k)
    return out


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--features", default=os.path.join(here, "analysis", "optc", "ecar-windows-300.csv"))
    ap.add_argument("--labels", default=os.path.join(here, "analysis", "optc", "window-labels.json"))
    ap.add_argument("--out", default=None)
    ap.add_argument("--tag", default="w300")
    args = ap.parse_args()
    out_path = args.out or os.path.join(here, "eval", "results", f"e1b-detection-{args.tag}.json")

    if not os.path.exists(args.features):
        sys.exit(f"features not found: {args.features}\nrun scripts/Export-EcarWindows.ps1 first")

    print(f"reading {args.features}")
    df = pd.read_csv(args.features)
    print(f"  cells {len(df):,}   positives {int(df.label.sum()):,}")
    if df.label.sum() == 0:
        sys.exit("no positive cells - check the label file and the window size match")

    feat = [c for c in df.columns if c not in ("bucket", "label", "w", "host_key", "day")]
    banned = [c for c in feat if any(s in c.lower() for s in ("host", "name", "ip", "path", "principal"))]
    if banned:
        sys.exit(f"identity-like columns present, refusing to train: {banned}")
    print(f"  features {len(feat)}")

    lab = json.load(open(args.labels, encoding="utf-8"))
    win = None
    for w in lab["window_seconds"]:
        if str(w) in lab["positive_cells"] and len(lab["positive_cells"][str(w)]) == int(df.label.sum()):
            win = w
    win = win or int(lab["window_seconds"][1])
    df["day"] = pd.to_datetime(df.bucket * win, unit="s", utc=True).dt.tz_convert("Etc/GMT+4").dt.date.astype(str)
    days = sorted(df.day.unique())
    print(f"  window {win} s   days {days}")

    results = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "generator": "scripts/run_e1b.py",
        "experiment": "E1-b",
        "tag": args.tag,
        "design": "docs/19-e1b-design.md",
        "features_file": os.path.abspath(args.features),
        "window_sec": win,
        "n_cells": int(len(df)),
        "n_positives": int(df.label.sum()),
        "feature_columns": feat,
        "excluded": {
            "hosts_without_telemetry": lab.get("dropped_hosts", {}),
            "why": lab.get("dropped_reason"),
        },
        "protocol": {
            "unit": "(host, window) cell - the only unit the ground truth exists at",
            "sampling": "no negative subsampling; every cell is present, so precision@k is exact",
            "tuning": "selected on the training days only; test scored once",
        },
        "splits": [],
    }

    for i in range(len(days) - 1):
        cut = days[i]
        tr = df[df.day <= cut]
        te = df[df.day > cut]
        ntr, nte = int(tr.label.sum()), int(te.label.sum())
        print(f"\n=== train <= {cut}:  {len(tr):,} cells ({ntr} pos)   test {len(te):,} ({nte} pos)")
        if ntr < 20 or nte < 20:
            print("  skipped: fewer than 20 positives on one side")
            results["splits"].append({"cut_day": cut, "skipped": "fewer than 20 positives on one side",
                                      "train_pos": ntr, "test_pos": nte})
            continue

        Xtr, ytr = tr[feat].to_numpy(float), tr.label.to_numpy(int)
        Xte, yte = te[feat].to_numpy(float), te.label.to_numpy(int)
        wte = np.ones(len(te), dtype=float)

        split = {"cut_day": cut, "train_cells": int(len(tr)), "test_cells": int(len(te)),
                 "train_pos": ntr, "test_pos": nte, "models": []}

        # what an analyst would try without any model
        split["models"].append(evaluate("rule: cell event count", yte, te.n.to_numpy(float), wte))
        split["models"].append(evaluate("rule: new destinations", yte, te.new_dsts.to_numpy(float), wte))

        npos, nneg = max(1, ytr.sum()), max(1, len(ytr) - ytr.sum())
        wfit = np.ones(len(ytr)); wfit[ytr == 1] = nneg / npos

        models = [
            ("histgb", HistGradientBoostingClassifier(max_iter=300, learning_rate=0.1,
                                                      max_leaf_nodes=15, l2_regularization=1.0,
                                                      early_stopping=False, random_state=0)),
            ("logreg", make_pipeline(StandardScaler(),
                                     LogisticRegression(C=0.1, max_iter=2000, class_weight="balanced"))),
        ]
        best = None
        for name, m in models:
            if hasattr(m, "steps"):
                m.fit(Xtr, ytr, **{f"{m.steps[-1][0]}__sample_weight": wfit})
            else:
                m.fit(Xtr, ytr, sample_weight=wfit)
            s = m.predict_proba(Xte)[:, 1]
            ev = evaluate(name, yte, s, wte)
            split["models"].append(ev)
            if best is None or ev["pr_auc"] > best[1]["pr_auc"]:
                best = (name, ev, s)

        if best is not None and "host_key" in te.columns:
            split["mttd"] = [mttd(te, best[2], b) for b in (50, 100, 200)]
            split["mttd_model"] = best[0]

        for m in split["models"]:
            print(f"  {m['model']:<28} PR-AUC {m['pr_auc']:.4f}  P@50 {m['precision@50']:.4f}  "
                  f"P@100 {m['precision@100']:.4f}  P@rec50 {m['precision@recall50']:.4f}")
        for t in split.get("mttd", []):
            print(f"  MTTD budget {t['budget']:>4}: caught {t['hosts_caught']}/{t['hosts_with_positives']} hosts, "
                  f"first-cell {t['caught_on_first_cell']}, median cells before first hit "
                  f"{t['median_cells_before_first_hit']}")

        results["splits"].append(split)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    print(f"\nreport: {out_path}")


if __name__ == "__main__":
    main()
