"""VERIFY gate for the graph derivatives (docs/05 lifecycle, ADR-0010).

The raw eCAR archive is deleted only after its derivatives are shown to stand
on their own. For the three files Export-EcarGraph.ps1 writes, "stand on their
own" means:

  1. the files exist and their row counts match the extractor's summary
  2. every host in the window feature CSV appears in the host-ip table
     (otherwise the graph cannot be joined to the cells it is meant to explain)
  3. the summary's record count equals the window extraction's, so the two
     passes read the same bytes
  4. host-to-host edges exist and join to the window cells. Most flow volume
     goes to infrastructure (collector on 9092, proxy on 443, DNS) and never
     resolves to a client; that is the shape of this network, not a defect.
     The first version of this gate demanded 30% of volume resolved and
     failed a correct extraction. What matters is that the rare client-to-
     client edges are there: on the finished data 61 cells carry a client
     RDP edge and 58 of them are labelled attack (docs/19 section 17).
  5. bucket ranges of the edge and tree files fall inside the window range

Nothing here deletes anything. It prints PASS or FAIL and exits non-zero on
FAIL; the deletion itself is a person's decision (CLAUDE.md).

Usage:
    python scripts/check_ecar_graph.py
"""

import json
import os
import sys
from collections import Counter

import pandas as pd

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(here, "analysis", "optc")


def load_json(p):
    with open(p, encoding="utf-8-sig") as fh:
        return json.load(fh)


def main():
    fails = []
    def check(ok, msg):
        print(("  ok    " if ok else "  FAIL  ") + msg)
        if not ok:
            fails.append(msg)

    summ_p = os.path.join(A, "ecar-graph-300.summary.json")
    if not os.path.exists(summ_p):
        sys.exit("no summary yet: the extraction has not finished (or never ran)")
    s = load_json(summ_p)
    win = load_json(os.path.join(A, "ecar-windows-300.v3.summary.json"))

    print("1. files and row counts")
    edges_p = os.path.join(A, "ecar-flow-edges-300.csv")
    tree_p = os.path.join(A, "ecar-proc-tree-300.csv")
    hip_p = os.path.join(A, "ecar-host-ip.csv")
    for p in (edges_p, tree_p, hip_p):
        check(os.path.exists(p) and os.path.getsize(p) > 0, f"{os.path.basename(p)} exists and is not empty")
    if fails:
        sys.exit("FAIL")
    edges = pd.read_csv(edges_p)
    tree = pd.read_csv(tree_p)
    hip = pd.read_csv(hip_p)
    check(len(edges) == s["edge_rows"], f"edges {len(edges):,} rows = summary {s['edge_rows']:,}")
    check(len(tree) == s["tree_rows"], f"tree {len(tree):,} rows = summary {s['tree_rows']:,}")
    check(len(hip) == s["host_ip_rows"], f"host-ip {len(hip):,} rows = summary {s['host_ip_rows']:,}")
    check(s["vanished_files"] == 0, f"skipped files {s['vanished_files']}")
    check(s["malformed"] == 0, f"malformed records {s['malformed']}")

    print("2. host coverage against the window CSV")
    cells = pd.read_csv(os.path.join(A, "ecar-windows-300.v3.csv"), usecols=["host_key", "bucket"])
    cell_hosts = set(cells.host_key.unique())
    hip_hosts = set(hip.host_key.unique())
    missing = cell_hosts - hip_hosts
    check(not missing, f"{len(cell_hosts)} window hosts, {len(missing)} without an IP row" +
          (f" e.g. {sorted(missing)[:5]}" if missing else ""))
    check(s["hosts"] == win["hosts"], f"hosts seen {s['hosts']} = window extraction {win['hosts']}")

    print("3. same bytes as the window extraction")
    check(s["records_read"] == win["records_read"],
          f"records {s['records_read']:,} = window pass {win['records_read']:,}")
    check(s["bundles"] == win["bundles"], f"bundles {s['bundles']} = {win['bundles']}")

    print("4. peer resolution")
    ip2host = {}
    dup = Counter()
    for r in hip.itertuples():
        if r.ip in ip2host and ip2host[r.ip] != r.host_key:
            dup[r.ip] += 1
        ip2host[r.ip] = r.host_key
    check(not dup, f"{len(dup)} IPs claimed by more than one host" + (f" e.g. {list(dup)[:5]}" if dup else ""))
    resolved = edges.peer_ip.map(ip2host).notna()
    share = float((edges.n * resolved).sum() / edges.n.sum())
    print(f"        {100 * share:.2f}% of flow volume has a client peer; the rest is infrastructure")
    unres = edges[~resolved].groupby(edges.peer_ip.str.extract(r"^(\d+\.\d+)\.")[0])["n"].sum().sort_values(ascending=False)
    for pfx, n in unres.head(5).items():
        print(f"        unresolved {pfx}.*  {int(n):,} flows")
    n_unres_peers = int(edges.peer_ip[~resolved].nunique())
    check(n_unres_peers < 5000, f"{n_unres_peers} distinct unresolved peer IPs (a small infrastructure set, not a broken table)")
    hh = edges[resolved]
    check(len(hh) >= 1000, f"{len(hh):,} host-to-host edge rows")
    check(hh.peer_ip.map(ip2host).nunique() >= 100, f"{hh.peer_ip.map(ip2host).nunique()} distinct client peers reached")
    joined = cells.merge(hh[["bucket", "host_key"]].drop_duplicates(), on=["bucket", "host_key"], how="inner")
    check(len(joined) > 0, f"{len(joined):,} window cells carry a host-to-host edge (join works)")
    rdp = hh[hh.port.astype(str) == "3389"][["bucket", "host_key"]].drop_duplicates()
    check(len(rdp) > 0, f"{len(rdp)} cells with a client-to-client RDP edge (the lateral-movement signal is present)")

    print("5. bucket ranges")
    lo, hi = win["time_min"] // 300, win["time_max"] // 300
    for name, df in (("edges", edges), ("tree", tree)):
        b0, b1 = int(df.bucket.min()), int(df.bucket.max())
        check(lo <= b0 and b1 <= hi, f"{name} buckets {b0}..{b1} inside window range {lo}..{hi}")

    print()
    if fails:
        print(f"FAIL ({len(fails)}): the derivatives do not stand on their own yet. Do not delete raw.")
        sys.exit(1)
    print("PASS: derivatives verified. Deletion of data/raw/optc/ecar is a person's call (ADR-0010).")


if __name__ == "__main__":
    main()
