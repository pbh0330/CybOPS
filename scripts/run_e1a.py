"""E1-a: can behavioural features beat the trivial baseline's precision?

docs/02-research-plan.md E1-a, docs/04-evaluation.md 2.1, ADR-0008, ADR-0011.

THE QUESTION IS NOT "CAN WE DETECT THE RED TEAM"
------------------------------------------------
That is already solved and worthless. `src in {C17693, C22409, C19932, C18025}`
gets recall 100%, because the labels only ever have four source hosts. What
that rule cannot do is be precise: 48,079 rows to find 702, i.e. 67 false
positives per true positive.

So the entire experiment is precision at fixed recall, using features that do
NOT contain host or account identity. Identity is not in the input file at all
(scripts/Export-AuthFeatures*.ps1), and this script refuses to run if anything
identity-shaped appears.

TUNING HAPPENS INSIDE THE TRAINING SPLIT. FULL STOP.
----------------------------------------------------
Asked to make the numbers better, the fastest way is to try settings until the
test score goes up. That does make the number go up and it makes it worthless -
the test split stops being a measurement and becomes a thing that was fitted.

So: hyperparameters are selected by forward-chaining validation *within* the
training days only. The test split is scored once, at the end, with whatever
won. Nothing after that point is allowed to change the model.

WEIGHTS ARE NOT OPTIONAL
------------------------
Negatives were subsampled 1-in-N during extraction. Every metric is computed
with sample weights, which recovers the numbers that scoring all 1.05 billion
rows would have given. Unweighted precision on a 1-in-500 sample is inflated by
roughly 500x.

Usage:
  python scripts/run_e1a.py
  python scripts/run_e1a.py --features analysis/lanl/auth-features2.csv --tag pass2
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC

DAY = 86400.0

TRIVIAL = {
    "rule": "src in {C17693, C22409, C19932, C18025}",
    "recall": 1.0,
    "precision": 0.0146,
    "rows_selected": 48079,
    "true_positives": 702,
    "note": "mandatory row (docs/04-evaluation.md 2.1). uses host identity, which every model below is forbidden to see.",
}


# ---------------------------------------------------------------- metrics

def weighted_pr(y, score, w):
    """PR curve with sample weights, plus the raw cumulative counts.

    sklearn has average_precision_score(sample_weight=...) but no precision@k,
    and k has to mean "k real alerts" rather than "k sampled rows" - so both
    come off one sort here.
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


def at_recall(precision, recall, tp, fp, target):
    idx = np.searchsorted(recall, target, side="left")
    if idx >= len(precision):
        return float("nan"), float("nan")
    return float(precision[idx]), float(tp[idx] + fp[idx])


def at_k(precision, tp, fp, k):
    idx = np.searchsorted(tp + fp, k, side="left")
    if idx >= len(precision):
        return float("nan")
    return float(precision[idx])


def bootstrap_at_k(y, score, w, k, n_boot=200, seed=0):
    """Confidence interval for precision@k under negative subsampling.

    This is not decoration. Negatives were kept 1-in-500, so each carries
    weight 500, and a weighted alert budget of k = 1,000 is reached after about
    two sampled negative rows. The point estimate is unbiased but it rests on
    those two rows: whether the thousand real negatives they stand for actually
    sit above or below the true positives is not observed. Reporting 4.03% with
    no interval would be claiming precision the sample cannot support.

    Resampling is over negatives only - the 702 positives are the whole
    population, not a sample of one.

    A resampling bootstrap that re-sorts the array each iteration costs
    O(n log n) x n_boot, which on 1.7M rows and 200 draws is thousands of full
    sorts and the run never finishes. Sorting is done ONCE; each draw then gives
    every negative a Poisson(1) multiplier, which is the standard Poisson
    bootstrap and leaves the ordering untouched. O(n) per draw.
    """
    rng = np.random.default_rng(seed)
    if (y == 1).sum() == 0 or (y == 0).sum() == 0:
        return (float("nan"), float("nan"))

    order = np.argsort(-score, kind="mergesort")
    ys = y[order].astype(float)
    ws = w[order]
    neg = ys == 0
    n_neg = int(neg.sum())
    if n_neg == 0:
        return (float("nan"), float("nan"))

    vals = []
    base_tp = ys * ws
    for _ in range(n_boot):
        mult = np.ones_like(ws)
        mult[neg] = rng.poisson(1.0, size=n_neg)
        tp = np.cumsum(base_tp)
        fp = np.cumsum((1.0 - ys) * ws * mult)
        prec = tp / np.maximum(tp + fp, 1e-12)
        vals.append(at_k(prec, tp, fp, k))
    vals = np.array([v for v in vals if not np.isnan(v)])
    if len(vals) == 0:
        return (float("nan"), float("nan"))
    return (float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5)))


def evaluate(name, y, score, w, ks=(100, 1000, 10000), boot=True):
    precision, recall, tp, fp = weighted_pr(y, score, w)
    out = {
        "model": name,
        "pr_auc": float(average_precision_score(y, score, sample_weight=w)),
        "roc_auc": float(roc_auc_score(y, score, sample_weight=w)),
        "positives": float((y * w).sum()),
        "negatives": float(((1 - y) * w).sum()),
    }
    for r in (0.5, 0.9, 1.0):
        p, a = at_recall(precision, recall, tp, fp, r)
        out[f"precision@recall{int(r * 100)}"] = p
        out[f"alerts@recall{int(r * 100)}"] = a
    for k in ks:
        out[f"precision@{k}"] = at_k(precision, tp, fp, k)
        if boot:
            lo, hi = bootstrap_at_k(y, score, w, k)
            out[f"precision@{k}_ci95"] = [lo, hi]
    # The trivial rule has no ranking, so its precision is the same at every
    # budget up to the 48,079 rows it selects. That is the number to beat at k.
    out["trivial_precision_at_any_k"] = TRIVIAL["precision"]
    return out


def host_hour_view(grp, y, score, w):
    """Collapse per-event scores to one alert per (source host, hour).

    Why this exists, and why it is reported as a SECOND view and not the first.

    Per-event scoring asks the detector to flag every one of the 702 rows. But a
    real analyst does not work rows, they work "this host did something odd in
    this hour" - one queue item covering however many rows. Under the per-event
    metric a detector that flags one row of a malicious hour and skips the other
    four hundred is scored as 399 misses, which is not how anyone would judge it.

    So: one item per host-hour, scored by the maximum event score inside it,
    positive if any event inside it is labelled. Weight is the sum of the event
    weights, which keeps the population estimate honest - a sampled negative
    host-hour still stands for the ones not sampled.

    docs/04-evaluation.md fixes the EVENT level as the reported unit (its
    warning is about aggregating to destination hosts, where 157 of 301 targets
    are touched once). This does not replace that. It is the operational reading
    alongside it, and both are in the output.
    """
    order = np.argsort(grp, kind="mergesort")
    g = grp[order]
    ys = y[order]
    ss = score[order]
    ws = w[order]
    edges = np.flatnonzero(np.r_[True, g[1:] != g[:-1]])
    ends = np.r_[edges[1:], len(g)]
    gy = np.array([ys[a:b].max() for a, b in zip(edges, ends)], dtype=int)
    gs = np.array([ss[a:b].max() for a, b in zip(edges, ends)], dtype=float)
    gw = np.array([ws[a:b].sum() for a, b in zip(edges, ends)], dtype=float)
    # A positive host-hour is one real thing, not the sum of its sampled rows.
    gw[gy == 1] = 1.0
    return gy, gs, gw


def pr_auc_w(y, score, w):
    if y.sum() == 0 or y.sum() == len(y):
        return float("nan")
    return float(average_precision_score(y, score, sample_weight=w))


# ---------------------------------------------------------------- models

def candidates(weight_modes=("true", "balanced")):
    """Search space. Small on purpose.

    A wide sweep over a handful of validation folds with 700 positives total
    finds the fold, not the model. Each entry is a coarse, defensible setting.

    The training weight mode is IN here, as a hyperparameter, and that is not a
    detail. Fitting with the extraction weights and fitting with balanced ones
    produce genuinely different models - the first ranks the very top of the
    list better (precision@1000 was 4.0% against 0.4%), the second ranks the
    whole list better (PR-AUC 0.0053 against 0.0112). Neither dominates.
    Choosing between them by looking at the test score is exactly the thing this
    protocol exists to prevent, so the choice is made on validation like every
    other hyperparameter.
    """
    out = []
    for wm in weight_modes:
        for lr in (0.05, 0.1):
            for leaves in (15, 31, 63):
                out.append((
                    f"histgb(lr={lr},leaves={leaves},w={wm})",
                    lambda lr=lr, leaves=leaves: HistGradientBoostingClassifier(
                        max_iter=400, learning_rate=lr, max_leaf_nodes=leaves,
                        l2_regularization=1.0, early_stopping=False, random_state=0),
                    "proba", wm))
    # RandomForest is not in the search. On 1.5M rows x 30 features it costs
    # minutes per fold and HistGB covers the same hypothesis class faster; a
    # search that takes hours does not get run, and a tuning protocol nobody
    # runs is worse than a small one that gets run every time.
    for wm in weight_modes:
        for C in (0.01, 0.1):
            out.append((
                f"logreg(C={C},w={wm})",
                lambda C=C: make_pipeline(StandardScaler(),
                                          LogisticRegression(C=C, max_iter=1000, class_weight="balanced")),
                "proba", wm))
    return out


def reference_specs():
    """Fitted once on the full training split for the report, never searched.

    LinearSVC on a million rows is slow enough that putting it in the fold loop
    would triple the runtime to re-learn what one fit already tells us. docs/04
    records that a linear SVM was the strongest baseline in a prior study, so it
    has to appear in the table - as a reference, not as a candidate.
    """
    return [(
        "linearsvm(C=0.01)",
        lambda: make_pipeline(StandardScaler(),
                              LinearSVC(C=0.01, class_weight="balanced", max_iter=2000)),
        "decision", "balanced")]


def training_weights(y, w, mode):
    """Weights used to FIT. Not the same thing as the weights used to SCORE.

    This distinction was got wrong first time and it cost most of the signal.
    The extraction kept 1 negative in 500, so every negative row carries w=500
    and every positive w=1. Feeding those straight into fit() tells the learner
    that the effective positive rate is 6.7e-7, and a boosted tree answers that
    correctly by predicting almost nothing anywhere - it is optimising a loss in
    which the 702 positives are worth 0.00007% of the total mass.

    Case-control sampling has a standard treatment: fit on the sample as drawn,
    then correct at evaluation time. Only the ranking is being measured here, so
    the correction is entirely in the metrics, which stay weighted by w. Nothing
    about the reported numbers is loosened - the population estimate is still
    the population estimate. What changes is that the model is now allowed to
    see the positives.

      true      w as extracted        faithful to the population, learns nothing
      uniform   every row weight 1    the sample as drawn
      balanced  classes equal mass    what an imbalanced-learning setup does
    """
    if mode == "true":
        return w
    if mode == "uniform":
        return np.ones_like(w)
    npos = max(1.0, float((y == 1).sum()))
    nneg = max(1.0, float((y == 0).sum()))
    out = np.ones_like(w)
    out[y == 1] = nneg / npos
    return out


def fit_score(spec, Xtr, ytr, wtr, Xte):
    name, build, kind = spec[0], spec[1], spec[2]
    m = build()
    if hasattr(m, "steps"):                      # pipeline: weight the final step
        last = m.steps[-1][0]
        m.fit(Xtr, ytr, **{f"{last}__sample_weight": wtr})
    else:
        m.fit(Xtr, ytr, sample_weight=wtr)
    s = m.decision_function(Xte) if kind == "decision" else m.predict_proba(Xte)[:, 1]
    return m, np.asarray(s, dtype=float)


def forward_chain_folds(days, n_folds=3):
    """Expanding-window folds inside the training days.

    Random k-fold would put an hour of the same campaign in train and in
    validation, and the score would be a memory test.
    """
    lo, hi = days.min(), days.max()
    edges = np.linspace(lo, hi, n_folds + 2)[1:-1]
    return [(float(e), float(edges[i + 1]) if i + 1 < len(edges) else float(hi))
            for i, e in enumerate(edges)]


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--features", default=os.path.join(here, "analysis", "lanl", "auth-features.csv"))
    ap.add_argument("--out", default=None)
    ap.add_argument("--tag", default="pass1")
    ap.add_argument("--splits", default="20,25,30,35")
    ap.add_argument("--no-tune", action="store_true", help="skip the search, fit one default model")
    ap.add_argument("--drop-lifetime", action="store_true",
                    help="remove cumulative per-entity features. They are an identity fingerprint: "
                         "with all labels on four source hosts, a model can re-identify a host from "
                         "its accumulated profile without ever seeing its name (ADR-0011 by the back door).")
    ap.add_argument("--train-weight", default="balanced", choices=["true", "uniform", "balanced"],
                    help="weights used to FIT. metrics stay weighted by w regardless.")
    args = ap.parse_args()
    out_path = args.out or os.path.join(here, "eval", "results", f"e1a-detection-{args.tag}.json")

    if not os.path.exists(args.features):
        sys.exit(f"features not found: {args.features}\nrun the extractor first")

    print(f"reading {args.features}")
    df = pd.read_csv(args.features)
    # The 1-in-100 extraction is 10.5M rows; at pandas' default float64 that is
    # about 4 GB before a model has been fitted. float32 halves it and costs
    # nothing here - the features are counts and ratios, not quantities where
    # the seventh significant figure decides anything.
    for c in df.columns:
        if c in ("t", "grp"):
            df[c] = df[c].astype("int64")
        elif c == "label":
            df[c] = df[c].astype("int8")
        elif df[c].dtype == "float64":
            df[c] = df[c].astype("float32")
    print(f"  rows {len(df):,}   positives {int(df.label.sum()):,}   "
          f"{df.memory_usage(deep=True).sum() / 1e9:.2f} GB in memory")

    df["day"] = df["t"] / DAY
    feat_cols = [c for c in df.columns if c not in ("t", "label", "w", "day", "grp")]
    has_grp = "grp" in df.columns

    # Lifetime counters accumulate from the first event to the current one. They
    # are legitimate anomaly features in general, and in THIS dataset they are
    # also a fingerprint: 670 of 702 labels sit on one source host, so "a host
    # whose lifetime profile looks like this" is the host id wearing a hat.
    # --drop-lifetime is the ablation that says how much of the result is the
    # behaviour and how much is the fingerprint.
    lifetime = [c for c in feat_cols if "_life_" in c or c in ("pair_seen",)]
    if args.drop_lifetime:
        feat_cols = [c for c in feat_cols if c not in lifetime]
        print(f"  dropped {len(lifetime)} lifetime/familiarity features: {', '.join(lifetime)}")

    banned = [c for c in feat_cols if any(s in c.lower() for s in ("comp", "user", "host"))
              or c.lower() in ("id", "src", "dst", "usr", "grp")]
    if banned:
        sys.exit(f"identity-like columns present, refusing to train: {banned}")
    print(f"  features {len(feat_cols)}")

    results = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "generator": "scripts/run_e1a.py",
        "experiment": "E1-a",
        "tag": args.tag,
        "refs": ["docs/02-research-plan.md", "docs/04-evaluation.md 2.1", "ADR-0008", "ADR-0011"],
        "features_file": os.path.abspath(args.features),
        "n_rows": int(len(df)),
        "n_positives": int(df.label.sum()),
        "feature_columns": feat_cols,
        "protocol": {
            "tuning": "hyperparameters selected by forward-chaining validation inside the training days only; "
                      "the test split is scored once with the winner and nothing is changed after",
            "weights": "each kept negative carries w = NegSample; all metrics weighted",
            "identity": "no host/account identity in the feature file; asserted at load",
            "drop_lifetime": bool(args.drop_lifetime),
            "lifetime_columns": lifetime,
            "train_weight": args.train_weight,
            "train_vs_eval_weight": "fitting uses train_weight; every reported metric is weighted by w (the extraction weight), so the numbers remain population estimates",
        },
        "trivial_baseline": TRIVIAL,
        "splits": [],
    }

    for cut in [float(s) for s in args.splits.split(",")]:
        tr = df[df.day <= cut]
        te = df[df.day > cut]
        ntr, nte = int(tr.label.sum()), int(te.label.sum())
        print(f"\n=== split day {cut}:  train {len(tr):,} ({ntr} pos)   test {len(te):,} ({nte} pos)")
        if ntr < 20 or nte < 20:
            print("  skipped: fewer than 20 positives on one side")
            results["splits"].append({"cut_day": cut, "skipped": "fewer than 20 positives on one side",
                                      "train_pos": ntr, "test_pos": nte})
            continue

        Xtr = tr[feat_cols].to_numpy(float); ytr = tr.label.to_numpy(int); wtr = tr.w.to_numpy(float)
        # weight mode now travels with the spec (spec[3])
        Xte = te[feat_cols].to_numpy(float); yte = te.label.to_numpy(int); wte = te.w.to_numpy(float)

        split = {"cut_day": cut, "train_rows": int(len(tr)), "test_rows": int(len(te)),
                 "train_pos": ntr, "test_pos": nte, "models": [], "validation": []}

        # --- baseline that uses no identity and no learning
        rule = te["src_hr_dst"].to_numpy(float) * (1.0 + te["src_hr_failrate"].to_numpy(float))
        split["models"].append(evaluate("rule: hr_dst x (1+hr_failrate)", yte, rule, wte))

        # --- model selection, inside train only
        specs = candidates()
        if args.no_tune:
            specs = [s for s in specs if s[0].startswith("histgb(lr=0.1,leaves=31")]
        folds = forward_chain_folds(tr["day"].to_numpy(float))
        print(f"  validation folds (train days only): {[round(f[0], 1) for f in folds]}")

        scored = []
        for spec in specs:
            fold_scores = []
            for fcut, _ in folds:
                a = tr[tr.day <= fcut]; b = tr[tr.day > fcut]
                if a.label.sum() < 10 or b.label.sum() < 10:
                    continue
                try:
                    ya = a.label.to_numpy(int); wa = a.w.to_numpy(float)
                    _, s = fit_score(spec,
                                     a[feat_cols].to_numpy(float), ya,
                                     training_weights(ya, wa, spec[3]),
                                     b[feat_cols].to_numpy(float))
                    fold_scores.append(pr_auc_w(b.label.to_numpy(int), s, b.w.to_numpy(float)))
                except Exception as e:                       # a setting that will not fit is not a candidate
                    print(f"    {spec[0]}: fold failed ({type(e).__name__})")
            if not fold_scores:
                continue
            mean = float(np.nanmean(fold_scores))
            scored.append((mean, spec, fold_scores))
            print(f"    {spec[0]:<32} val PR-AUC {mean:.5f}   folds {[round(x, 4) for x in fold_scores]}")
            split["validation"].append({"model": spec[0], "val_pr_auc_mean": mean,
                                        "folds": [float(x) for x in fold_scores]})

        if not scored:
            print("  no candidate could be validated; skipping")
            results["splits"].append(split)
            continue

        scored.sort(key=lambda r: -r[0])
        best_mean, best_spec, _ = scored[0]
        split["selected"] = {"model": best_spec[0], "val_pr_auc_mean": best_mean,
                             "how": "highest mean forward-chaining PR-AUC inside the training days"}
        print(f"  selected: {best_spec[0]}  (val PR-AUC {best_mean:.5f})")

        # --- the one look at the test split
        _, s_best = fit_score(best_spec, Xtr, ytr, training_weights(ytr, wtr, best_spec[3]), Xte)
        split["models"].append(evaluate(f"selected: {best_spec[0]}", yte, s_best, wte))

        # operational reading: one alert per host-hour, reported alongside
        if has_grp:
            gy, gs, gw = host_hour_view(te["grp"].to_numpy(np.int64), yte, s_best, wte)
            hh = evaluate(f"selected: {best_spec[0]} [host-hour]", gy, gs, gw, ks=(50, 200, 1000))
            hh["unit"] = "host-hour"
            hh["groups"] = int(len(gy))
            hh["positive_groups"] = int(gy.sum())
            split["models"].append(hh)
            print(f"  host-hour: {int(gy.sum())} positive groups of {len(gy)}   "
                  f"PR-AUC {hh['pr_auc']:.5f}  P@50 {hh['precision@50']:.4f}  P@200 {hh['precision@200']:.4f}")

        # reference points, reported alongside so the selection is auditable
        refs = [sp for sp in specs if sp[0].startswith("logreg(C=0.1")] + reference_specs()
        for spec in refs:
            if spec[0] == best_spec[0]:
                continue
            try:
                _, s = fit_score(spec, Xtr, ytr, training_weights(ytr, wtr, spec[3]), Xte)
                split["models"].append(evaluate(spec[0], yte, s, wte))
            except Exception as e:
                print(f"    reference {spec[0]} failed: {type(e).__name__}")

        for m in split["models"]:
            print(f"  {m['model']:<40} PR-AUC {m['pr_auc']:.5f}  "
                  f"P@rec50 {m['precision@recall50']:.4f}  P@rec90 {m['precision@recall90']:.4f}  "
                  f"P@1000 {m['precision@1000']:.4f}")

        results["splits"].append(split)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    print(f"\nreport: {out_path}")


if __name__ == "__main__":
    main()
