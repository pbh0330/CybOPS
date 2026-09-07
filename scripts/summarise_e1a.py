"""One table across every E1-a result on disk.

The chain leaves half a dozen JSON files. What a reader needs is the comparison
against the number that has to be beaten - the trivial baseline's 1.46% - and
whether the confidence interval clears it. A point estimate that looks like a
win but whose interval contains 1.46% is not a win, and that distinction is the
only reason this file formats anything rather than dumping the JSON.

Usage:
  python scripts/summarise_e1a.py
"""

import glob
import json
import os

TRIVIAL = 0.0146


def clears(ci):
    if not ci or ci[0] is None:
        return "?"
    try:
        return "yes" if float(ci[0]) > TRIVIAL else "no"
    except (TypeError, ValueError):
        return "?"


def fmt_ci(ci):
    if not ci or ci[0] is None:
        return "-"
    try:
        return f"[{float(ci[0]) * 100:.1f},{float(ci[1]) * 100:.1f}]"
    except (TypeError, ValueError):
        return "-"


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    files = sorted(glob.glob(os.path.join(here, "eval", "results", "e1a-detection-*.json")))
    if not files:
        print("no results")
        return

    print()
    print("E1-a results.  trivial baseline = 1.46% precision at any k, recall 100% at 48,079 alerts")
    print("=" * 118)
    print(f"{'tag':<14}{'cut':>4}{'unit':>11}{'valPR':>9}{'PR-AUC':>9}{'P@r50':>8}"
          f"{'P@100':>8}{'CI100':>14}{'>base':>6}{'P@1000':>8}{'CI1000':>14}{'model':>0}")
    print("-" * 118)

    for f in files:
        d = json.load(open(f, encoding="utf-8"))
        tag = d.get("tag", os.path.basename(f))
        for s in d.get("splits", []):
            if "models" not in s:
                continue
            val = (s.get("selected") or {}).get("val_pr_auc_mean")
            for m in s["models"]:
                if not m["model"].startswith("selected"):
                    continue
                unit = m.get("unit", "event")
                ci100 = m.get("precision@100_ci95")
                ci1k = m.get("precision@1000_ci95")
                k1, k2 = ("precision@100", "precision@1000")
                if unit == "host-hour":
                    k1, k2 = ("precision@50", "precision@200")
                    ci100 = m.get("precision@50_ci95")
                    ci1k = m.get("precision@200_ci95")
                print(f"{tag:<14}{s['cut_day']:>4.0f}{unit:>11}"
                      f"{(val if val is not None else float('nan')):>9.4f}"
                      f"{m['pr_auc']:>9.5f}{m['precision@recall50'] * 100:>7.2f}%"
                      f"{m.get(k1, float('nan')) * 100:>7.2f}%{fmt_ci(ci100):>14}{clears(ci100):>6}"
                      f"{m.get(k2, float('nan')) * 100:>7.2f}%{fmt_ci(ci1k):>14}"
                      f"  {m['model'].replace('selected: ', '')}")
    print("-" * 118)
    print("CI is 95% Poisson bootstrap over the sampled negatives; positives are the whole population.")
    print("'>base' = does the interval's lower bound clear the trivial baseline. 'no' means the point")
    print("estimate may look better but the sample does not support the claim.")
    print()


if __name__ == "__main__":
    main()
