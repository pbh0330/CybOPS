"""Turn the OpTC red team ground truth from prose into machine-readable labels.

Why this exists
---------------
Of the three datasets, only OpTC ships its ground truth as a PDF narrative.
LANL has redteam.txt.gz and AIT ships a labels/ tree; OpTC has seven pages of
English. Nothing can be evaluated against a paragraph, so E1-b (attack chain
and propagation, ADR-0011) needs this converted first.

What it produces
----------------
analysis/optc/redteam-events.jsonl   one row per red team log line
analysis/optc/redteam-labels.json    hosts, agents, pivot chain, per-day summary

Each event row carries: timestamp, day, the hosts and agent ids named in the
line, a coarse action tag, and candidate ATT&CK technique ids.

What this is NOT
----------------
These are labels for the *red team's own account of what it did*, at
second resolution, naming hosts and agents. They are not per-telemetry-event
labels. Attaching them to eCAR records still requires matching on
(hostname, time window, actor pid) and will be approximate - the ground truth
gives one line per operator action while the endpoint sensor emits many events
per action. Treat the result as a labelled *window*, not a labelled event.

The technique mapping is heuristic keyword matching and MUST be reviewed before
being reported. It is a starting point, not an authority.

Usage:
    python scripts/build_optc_labels.py
"""

import json
import os
import re
from collections import Counter, OrderedDict

SRC = r"F:\mc-cycop-data\raw\optc\OpTCRedTeamGroundTruth.txt"
OUT_DIR = os.path.join("analysis", "optc")

# "09/23/19 11:23:29 -- On Sysclient0201 agent LUAVR71T, ran Mimikatz ..."
#
# The PDF wraps long entries across several text lines. An earlier version of
# this parser kept only the line carrying the timestamp and silently dropped
# every continuation, losing about half the text - which showed up as 53% of
# events matching no rule. Continuations must be joined back on.
LINE_RE = re.compile(r"^(\d{2}/\d{2}/\d{2})\s+(\d{2}:\d{2}:\d{2})\s*--\s*(.*?)\s*$")

# Page furniture to drop when joining continuations.
NOISE_RE = re.compile(
    r"^\s*(?:=== page \d+ ===|The views and conclusions|interpreted as representing"
    r"|DISTRIBUTION A\.|Day \d+\s*[-–]|Summary:|C2:\s*$|Server --|IP --|Delay --"
    r"|Profile --|Client\s+AgentID|Log:\s*$)", re.I)

HOST_RE = re.compile(r"(?:sysclient\s*0*(\d{1,4})|\bDC1\b)", re.I)
AGENT_RE = re.compile(r"\bagent\s+([A-Z0-9]{8})\b", re.I)
IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")

DAY_OF = {"09/23/19": 1, "09/24/19": 2, "09/25/19": 3}

# Keyword -> (action tag, candidate ATT&CK ids). Heuristic; review before use.
RULES = [
    (r"\bmimikatz\b|lsadump|credential|clear[- ]?text password|password for user|hashes|domain sid",
     "credential_access", ["T1003", "T1003.001"]),
    (r"bypass(?:es)? uac|\buac\b|privilege escalation|privesc|elevate|elevated agent|getsystem",
     "privilege_escalation", ["T1548.002", "T1068"]),
    (r"psinject|process injection|inject(?:ed|ing)?\s+(?:into|shellcode)|migrat(?:e|ed|ion)",
     "process_injection", ["T1055"]),
    (r"persistence|registry (?:edit|entry|modification)|hkcu|scheduled task|autorun",
     "persistence", ["T1547.001", "T1112"]),
    (r"pivot(?:ed)?\s+to|invoke_wmi|\bwmi\b|lateral movement|installed .{0,30}agent on|psexec",
     "lateral_movement", ["T1047", "T1021"]),
    (r"\brdp\b|remote desktop", "lateral_movement", ["T1021.001"]),
    (r"ping sweep|arp scan|port scan|network scan|nmap|/2[0-9] network|/24\b",
     "discovery_network", ["T1018", "T1046"]),
    (r"ipconfig|process listing|list of processes|\bps\b command|winenum|"
     r"security context|find(?:ing)? domain controller|queried to find|domain controllers?\b",
     "discovery_host", ["T1082", "T1057", "T1018"]),
    (r"domain admins?|list of \d+ domain|\bgpo\b|group polic|net group|enumerat",
     "discovery_account", ["T1087.002", "T1069.002", "T1615"]),
    (r"screenshot", "collection", ["T1113"]),
    (r"findtrusteddocuments|compressed documents|\.zip\b|archive|export\.zip",
     "collection", ["T1560", "T1005"]),
    (r"download(?:ed)? (?:file|runme)|exfil|obtained a copy|upload(?:ed)?|filetransfer",
     "exfiltration", ["T1041", "T1105"]),
    (r"stager|empire|check[- ]?in|\bc2\b|beacon|lost contact|deathstar",
     "c2", ["T1071", "T1105"]),
    (r"reverse ssh|port forward|forwarded port|tunnel|proxy",
     "c2", ["T1572", "T1090"]),
    (r"kill(?:ing|ed)? (?:all )?(?:other )?agents?|deleted runme|closed firefox|"
     r"cleaned up|clean(?:ed)? up|removed? .{0,20}\.exe",
     "defense_evasion", ["T1070"]),
    (r"sent email|malicious word document|malicious attachment|payroll\.docx|"
     r"opened .{0,20}attachment|phish",
     "initial_access", ["T1566.001", "T1204.002"]),
    (r"manually accessed console|navigated to .{0,40}:\d+",
     "initial_access", ["T1189"]),
    (r"powershell|executed script|imported .{0,20}script|ran script",
     "execution", ["T1059.001"]),

    # Day 3 ("Malicious Upgrade") swaps PowerShell Empire for Meterpreter, so
    # none of the rules above fire on it. Without these, an entire day of the
    # campaign comes back unlabelled.
    (r"notepad\+?\+?.{0,30}update|update\.exe|updated\.exe|malicious binary|"
     r"conducted update to",
     "initial_access", ["T1195.002", "T1204.002"]),
    (r"meterpreter", "execution", ["T1059"]),
    (r"get\s?system module|named pipe impersonation|obtained system via",
     "privilege_escalation", ["T1134.001"]),
    (r"cmd shell|command shell", "execution", ["T1059.003"]),
    (r"enum modules|installed applications|enum_?applications",
     "discovery_host", ["T1518"]),
    (r"enum_?shares|identify any shares|share discovery",
     "discovery_network", ["T1135"]),
    (r"timestomp|edit mac times|modif(?:y|ied) timestamps",
     "defense_evasion", ["T1070.006"]),
    (r"rdp(?:ed|ing)?\b|rdped to", "lateral_movement", ["T1021.001"]),
    (r"agents? ran overnight|connection back to attacker|attacker server",
     "c2", ["T1071"]),
]


def hosts_in(s):
    out = []
    for m in HOST_RE.finditer(s):
        out.append("DC1" if m.group(1) is None else "SysClient%04d" % int(m.group(1)))
    # preserve order, drop repeats
    seen, ordered = set(), []
    for h in out:
        if h not in seen:
            seen.add(h)
            ordered.append(h)
    return ordered


def classify(text):
    tags, techs = [], []
    low = text.lower()
    for pat, tag, ids in RULES:
        if re.search(pat, low):
            if tag not in tags:
                tags.append(tag)
            for t in ids:
                if t not in techs:
                    techs.append(t)
    return tags, techs


def main():
    text = open(SRC, encoding="utf-8").read()

    # Pass 1: rebuild wrapped entries. A line starting with a timestamp opens a
    # new entry; everything after it that is not page furniture belongs to it.
    entries = []
    cur = None
    for raw in text.splitlines():
        line = raw.rstrip()
        m = LINE_RE.match(line.strip())
        if m:
            if cur:
                entries.append(cur)
            date, tod, body = m.groups()
            cur = [date, tod, body]
            continue
        if cur is None:
            continue
        s = line.strip()
        if not s or NOISE_RE.match(s):
            continue
        cur[2] = (cur[2] + " " + s).strip()
    if cur:
        entries.append(cur)

    events = []
    for date, tod, body in entries:
        hs = hosts_in(body)
        tags, techs = classify(body)
        events.append(OrderedDict([
            ("date", date),
            ("time", tod),
            ("day", DAY_OF.get(date)),
            ("hosts", hs),
            ("primary_host", hs[0] if hs else None),
            ("agents", [a.upper() for a in AGENT_RE.findall(body)]),
            ("ips", IP_RE.findall(body)),
            ("action_tags", tags),
            ("attack_candidates", techs),
            ("text", body),
        ]))

    if not (os.path.isdir(OUT_DIR)):
        os.makedirs(OUT_DIR, exist_ok=True)

    jsonl = os.path.join(OUT_DIR, "redteam-events.jsonl")
    with open(jsonl, "w", encoding="utf-8") as f:
        for e in events:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")

    # Pivot chain: a line that names a pivot, from its primary host to the other
    # host it mentions.
    pivots = []
    for e in events:
        if "lateral_movement" not in e["action_tags"]:
            continue
        if not re.search(r"pivot(?:ed)?\s+to", e["text"], re.I):
            continue
        hs = e["hosts"]
        if len(hs) >= 2:
            pivots.append({"date": e["date"], "time": e["time"],
                           "from": hs[0], "to": hs[1], "text": e["text"]})

    per_day = {}
    for e in events:
        d = str(e["day"])
        s = per_day.setdefault(d, {"events": 0, "hosts": [], "tags": Counter()})
        s["events"] += 1
        for h in e["hosts"]:
            if h not in s["hosts"]:
                s["hosts"].append(h)
        for t in e["action_tags"]:
            s["tags"][t] += 1
    for d in per_day:
        per_day[d]["tags"] = dict(per_day[d]["tags"])
        per_day[d]["hosts"] = sorted(per_day[d]["hosts"])

    tag_total = Counter()
    tech_total = Counter()
    untagged = 0
    for e in events:
        if not e["action_tags"]:
            untagged += 1
        for t in e["action_tags"]:
            tag_total[t] += 1
        for t in e["attack_candidates"]:
            tech_total[t] += 1

    summary = OrderedDict([
        ("source", SRC),
        ("note", "Labels describe red team operator actions at second resolution, "
                 "not individual telemetry events. ATT&CK ids are heuristic keyword "
                 "matches and require review."),
        ("events", len(events)),
        ("untagged_events", untagged),
        ("dates", sorted({e["date"] for e in events})),
        ("hosts", sorted({h for e in events for h in e["hosts"]})),
        ("agents", sorted({a for e in events for a in e["agents"]})),
        ("per_day", per_day),
        ("action_tag_counts", dict(tag_total.most_common())),
        ("attack_candidate_counts", dict(tech_total.most_common())),
        ("pivot_chain", pivots),
    ])

    js = os.path.join(OUT_DIR, "redteam-labels.json")
    with open(js, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("events parsed        :", len(events))
    print("untagged             :", untagged)
    print("distinct hosts       :", len(summary["hosts"]))
    print("distinct agents      :", len(summary["agents"]))
    print("pivot lines          :", len(pivots))
    print()
    print("per day:")
    for d in sorted(per_day):
        print("  day %s  events %3d  hosts %2d" % (d, per_day[d]["events"], len(per_day[d]["hosts"])))
    print()
    print("action tags:")
    for k, v in tag_total.most_common():
        print("  %-22s %4d" % (k, v))
    print()
    print("pivot chain:")
    for p in pivots:
        print("  %s %s  %s -> %s" % (p["date"], p["time"], p["from"], p["to"]))
    print()
    print("wrote", jsonl)
    print("wrote", js)


if __name__ == "__main__":
    main()
