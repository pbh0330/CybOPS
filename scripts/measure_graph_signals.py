"""Measure the two graph-derived signals docs/19 section 17 reports, from the
derivatives, so the numbers the UI card and the paper quote are reproducible
and not copied out of a conversation.

  1. client-to-client flow edges per 300 s cell, by port, joined to the label
  2. parent -> child process pairs, per cell, with the share of labelled cells

Writes eval/results/e1b-graph-signals.json. Reads only the derivatives, so it
still runs after the raw archive is gone.

Usage:
    python scripts/measure_graph_signals.py
"""

import datetime
import json
import os

import pandas as pd

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(here, "analysis", "optc")
OUT = os.path.join(here, "eval", "results", "e1b-graph-signals.json")


def main():
    cells = pd.read_csv(os.path.join(A, "ecar-windows-300.v3.csv"), usecols=["bucket", "host_key", "label"])
    base = float(cells.label.mean())
    n_pos = int(cells.label.sum())

    edges = pd.read_csv(os.path.join(A, "ecar-flow-edges-300.csv"))
    hip = pd.read_csv(os.path.join(A, "ecar-host-ip.csv"))
    ip2host = dict(zip(hip.ip, hip.host_key))
    edges["peer_host"] = edges.peer_ip.map(ip2host)
    hh = edges[edges.peer_host.notna()]

    def cell_stat(frame, name):
        k = frame[["bucket", "host_key"]].drop_duplicates()
        m = cells.merge(k, on=["bucket", "host_key"], how="inner")
        p = float(m.label.mean()) if len(m) else 0.0
        return {"condition": name, "cells": int(len(m)), "attack_cells": int(m.label.sum()),
                "p_attack": round(p, 4), "lift": round(p / base, 1) if base else None,
                "positives_covered": int(m.label.sum()), "positives_total": n_pos}

    flow = [cell_stat(hh[hh.dir == "out"], "outbound flow to another client"),
            cell_stat(hh[hh.dir == "in"], "inbound flow from another client")]
    for port, label in (("3389", "client-to-client RDP (3389)"), ("445", "client-to-client SMB (445)"),
                        ("135", "client-to-client RPC (135)"), ("139", "client-to-client NetBIOS (139)")):
        flow.append(cell_stat(hh[hh.port.astype(str) == port], label))

    tree = pd.read_csv(os.path.join(A, "ecar-proc-tree-300.csv"))
    tree["pair"] = tree.parent_image + " -> " + tree.image
    lab = set(zip(cells[cells.label == 1].bucket, cells[cells.label == 1].host_key))
    tree["lab"] = [(b, h) in lab for b, h in zip(tree.bucket, tree.host_key)]
    g = tree.groupby("pair").agg(cells=("lab", "size"), attack_cells=("lab", "sum")).reset_index()
    g["p_attack"] = g.attack_cells / g.cells
    top = g[g.attack_cells >= 5].sort_values(["p_attack", "attack_cells"], ascending=False).head(10)
    pairs = [{"pair": r.pair, "cells": int(r.cells), "attack_cells": int(r.attack_cells),
              "p_attack": round(float(r.p_attack), 3)} for r in top.itertuples()]

    first_glob = tree.groupby("pair").bucket.transform("min")
    tree["new_global"] = tree.bucket == first_glob
    ng = tree[tree.new_global]
    novel = cell_stat(ng, "a parent->child pair never seen before in the capture")

    out = {
        "generated": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "generator": "scripts/measure_graph_signals.py",
        "design": "docs/19-e1b-design.md section 17",
        "inputs": ["ecar-windows-300.v3.csv", "ecar-flow-edges-300.csv", "ecar-host-ip.csv", "ecar-proc-tree-300.csv"],
        "window_sec": 300,
        "base_rate": round(base, 5),
        "positives": n_pos,
        "flow_signals": flow,
        "process_pairs": pairs,
        "novel_pair_signal": novel,
        "caveat": "measured on the labelled OpTC cells, not on a held-out day. These are descriptions of "
                  "the red team's tradecraft in this capture, not detection performance claims.",
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    for f in flow:
        print(f"{f['condition']:<45} cells {f['cells']:>6}  P {f['p_attack']:.3f}  x{f['lift']}")
    for p in pairs[:6]:
        print(f"  {p['pair']:<70} {p['attack_cells']}/{p['cells']}")
    print(f"report: {OUT}")


if __name__ == "__main__":
    main()
