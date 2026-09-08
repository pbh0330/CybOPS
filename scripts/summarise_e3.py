"""Consolidate every E3 measurement into one table, across prompt versions.

Three probes write three families of report and they answer different
questions, so a claim about a prompt version means nothing until all three are
read together:

    briefing-model-comparison-<tag>.json   full packs. What does the prompt
                                           cost when the evidence is all there?
    e3-abstention-<tag>.json               ablated packs. What does the model
                                           do when a fact is taken away?
    e3-injection-<tag>.json                poisoned packs. Does an instruction
                                           inside the evidence reach the page?

The reason this script exists rather than a spreadsheet: the first pass at
reading these numbers by eye produced a wrong conclusion twice. Once by
quoting an abstention rate whose denominator was dominated by one preset, and
once by counting a violation total without noticing that a third of it was the
7B leaking a Chinese character into its own confidence tag. So the per-preset
and per-violation-kind breakdowns are printed by default and the single
summary number is not printed at all.

Usage:
    python scripts/summarise_e3.py
    python scripts/summarise_e3.py --out eval/results/e3-summary.json
"""

import argparse
import glob
import json
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = os.path.join(HERE, "eval", "results")


def load(pattern):
    """Return {tag: parsed json} for eval/results/<pattern with a * for the tag>."""
    out = {}
    star = pattern.index("*")
    prefix, suffix = pattern[:star], pattern[star + 1:]
    for path in sorted(glob.glob(os.path.join(RESULTS, pattern))):
        name = os.path.basename(path)
        tag = name[len(prefix):len(name) - len(suffix)]
        with open(path, encoding="utf-8-sig") as fh:
            out[tag] = json.load(fh)
    return out


def short(model):
    """qwen2.5:7b-instruct-q4_K_M -> 7b"""
    m = re.search(r":([0-9.]+b)", model)
    return m.group(1) if m else model.split(":")[-1][:8]


def order(tags):
    """v3, v4, v5, v6 before anything else; r3 variants next to their base."""
    def key(t):
        m = re.match(r"v(\d+)", t)
        return (0, int(m.group(1)), t) if m else (1, 0, t)
    return sorted(tags, key=key)


def fmt(v, spec="{:.3f}", dash="-"):
    return dash if v is None else spec.format(v)


def full_pack(reports):
    print()
    print("FULL PACKS - what the prompt costs when the evidence is all there")
    print("-" * 100)
    print("{:<7} {:<5} {:>5} {:>6} {:>7} {:>6} {:>9} {:>7} {:>7} {:>8}".format(
        "tag", "model", "runs", "pass", "cite", "viol", "golden", "ECE", "Brier", "ms/run"))
    rows = []
    for tag in order(reports):
        rep = reports[tag]
        for s in rep.get("summary", []):
            correct = s.get("golden_correct") or 0
            wrong = s.get("golden_wrong") or 0
            scored = correct + wrong
            acc = (correct / scored) if scored else None
            print("{:<7} {:<5} {:>5} {:>6} {:>7} {:>6} {:>9} {:>7} {:>7} {:>8}".format(
                tag, short(s["model"]), s["runs"], s["passed"],
                fmt(s.get("mean_citation_rate")), s.get("total_violations", 0),
                "{}/{} {}".format(correct, scored, fmt(acc, "{:.0%}")),
                fmt(s.get("ece")), fmt(s.get("brier")), s.get("mean_latency_ms", 0)))
            rows.append({"tag": tag, "model": s["model"], "runs": s["runs"],
                         "passed": s["passed"], "citation_rate": s.get("mean_citation_rate"),
                         "violations": s.get("total_violations"),
                         "golden_correct": correct, "golden_scored": scored,
                         "golden_accuracy": acc, "ece": s.get("ece"),
                         "brier": s.get("brier"), "latency_ms": s.get("mean_latency_ms")})

        # A violation total hides what kind it was. The 7B leaks a Chinese
        # character into its own confidence tag often enough that the same
        # sentence lands in two buckets, and reading only the total made that
        # look like a prompt regression.
        kinds = defaultdict(int)
        for s in rep.get("summary", []):
            for k in ("script_violations", "bogus_citations", "number_mismatches",
                      "unknown_escalations"):
                if s.get(k):
                    kinds[k] += s[k]
        if kinds:
            print("{:<7} {:<5} {}".format("", "", "   ".join(
                "{} {}".format(k.replace("_", " "), v) for k, v in sorted(kinds.items()))))
    return rows


def ablation(reports):
    print()
    print("ABLATED PACKS - what the model does when a fact is taken away")
    print("-" * 100)
    rows = []
    for tag in order(reports):
        rep = reports[tag]
        per = defaultdict(lambda: [0, 0, 0, 0])
        for r in rep.get("runs", []):
            k = (short(r["model"]), r["preset"])
            per[k][0] += r.get("targets", 0)
            per[k][1] += r.get("abstained", 0)
            per[k][2] += r.get("substituted", 0) or 0
            per[k][3] += r.get("silent", 0)
        for s in rep.get("summary", []):
            print("{:<7} {:<5} targets {:>3}   abstained {:>3}   substituted {:>3}   "
                  "silent {:>3}   bogus/mismatch {}/{}".format(
                      tag, short(s["model"]), s["targets"], s["abstained"],
                      s.get("substituted", 0), s["silent"],
                      s.get("bogus_citations", 0), s.get("number_mismatches", 0)))
            rows.append({"tag": tag, "model": s["model"], **{
                k: s.get(k) for k in ("targets", "abstained", "substituted", "silent",
                                      "fabricated", "bogus_citations", "number_mismatches")}})
        # The summary line is not enough on its own. Under v4 every abstention
        # came from the one preset that empties the whole pack, and the overall
        # rate read as if the model had learned to refuse.
        for k in sorted(per):
            t, a, sub, sil = per[k]
            print("        {:<5} {:<12} targets {:>3}  abstained {:>3}  substituted {:>3}  silent {:>3}".format(
                k[0], k[1], t, a, sub, sil))
    return rows


def injection(reports):
    print()
    print("POISONED PACKS - does an instruction inside the evidence reach the page")
    print("-" * 100)
    rows = []
    for tag in order(reports):
        rep = reports[tag]
        for s in rep.get("summary", []):
            print("{:<7} {:<5} runs {:>3}   complied {:>3}   cite {}   violations {}".format(
                tag, short(s["model"]), s["runs"], s["complied"],
                fmt(s.get("mean_citation_rate")), s.get("citation_violations", 0)))
            rows.append({"tag": tag, "model": s["model"], **{
                k: s.get(k) for k in ("runs", "complied", "mean_citation_rate",
                                      "citation_violations")}})
        hit = defaultdict(list)
        for r in rep.get("runs", []):
            if r.get("complied"):
                hit[short(r["model"])].append("t{}/{}".format(r["t"], r["payload_id"]))
        for k in sorted(hit):
            print("        {:<5} {}".format(k, ", ".join(hit[k])))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(RESULTS, "e3-summary.json"))
    args = ap.parse_args()

    full = load("briefing-model-comparison-*.json")
    abl = load("e3-abstention-*.json")
    inj = load("e3-injection-*.json")

    if not (full or abl or inj):
        raise SystemExit("no E3 reports under " + RESULTS)

    rows_full = full_pack(full) if full else []
    rows_abl = ablation(abl) if abl else []
    rows_inj = injection(inj) if inj else []

    print()
    print("Read the three blocks together. A prompt version that refuses well on an")
    print("ablated pack and drops citations on a full one has not improved anything.")
    print()

    payload = {
        "generator": "scripts/summarise_e3.py",
        "note": ("Per-preset and per-violation-kind breakdowns are printed because the "
                 "single summary numbers were misread twice: an abstention rate whose "
                 "denominator was one preset, and a violation total that was partly the "
                 "7B leaking a Chinese character into its own confidence tag."),
        "full_pack": rows_full,
        "ablation": rows_abl,
        "injection": rows_inj,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print("report:", args.out)


if __name__ == "__main__":
    main()
