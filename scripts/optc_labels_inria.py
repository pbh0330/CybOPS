"""Build (host, window) positive cells from the Inria corrected ground truth.

WHY REPLACE OUR OWN LABELS

We derived labels from the ground truth PDF: 101 operator actions, expanded to
148 (host, time) pairs, each marking the MINUTE an action happened. The Inria
team labelled the malicious PROCESSES instead, giving the interval each one was
alive on the host it ran on.

For E1-b that difference decides the answer. The unit is a (host, 5-minute
window) cell, and a process the attacker planted keeps running: if it lives for
three hours, every window in those three hours contains attack activity. Our
labels called the first window positive and the other thirty-five NEGATIVE, so
a model that flagged them correctly was scored as producing false positives.

At 300 s our labels give 113 positive cells. The corrected Inria labels give
about ten times that, and they contain most of ours.

WHAT THIS DOES NOT INHERIT

DC1 is dropped, as it was before. It has no eCAR telemetry at all - a full scan
of 380 GB found 450 hosts and none of them DC1 (docs/19 section 3). Inria label
it because their labelling works from the ground truth, not from what the
telemetry contains. Dropping it here is the same decision as before and is
counted in the output.

Host names differ in case: Inria writes "Sysclient0005", eCAR writes
"SysClient0005", and the feature extractor hashes the eCAR spelling. Normalised
here, because a case mismatch would silently produce zero positives.

Usage:
    python scripts/optc_labels_inria.py
    python scripts/optc_labels_inria.py --original      # uncorrected labels
    python scripts/optc_labels_inria.py --compare       # against our own labels
"""

import argparse
import csv
import datetime
import json
import os
import re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = datetime.timezone(datetime.timedelta(hours=-4))
SCENARIOS = ('sc1', 'sc2', 'sc3')


def norm_host(raw):
    """Sysclient0005 -> SysClient0005. DC1 and anything else -> None."""
    m = re.fullmatch(r'[Ss]ysclient0*(\d+)', raw.strip())
    if not m:
        return None
    return 'SysClient%04d' % int(m.group(1))


# The last moment the capture holds. Measured, not assumed: all three extractions
# over every eCAR file on disk report the same end of range
# (analysis/optc/ecar-windows-{60,300,900}.summary.json, time_max).
CAPTURE_END = datetime.datetime.fromtimestamp(1569436702, TZ)


def read_intervals(path):
    """Rows are (host, pid, start, end). An end of 'Infinity' is a real label.

    Twelve rows carry it, and the first version of this script dropped them
    without a word because fromisoformat raised. They are the processes that
    were still alive when the capture stopped - which makes them the LONGEST
    lived malicious processes in the dataset, and therefore the ones covering
    the most windows. Losing them quietly would have removed exactly the
    positives that matter most.

    They are clamped to the end of the day they started on, or to the end of
    the capture, whichever comes first. Each scenario is one day, so the day
    bound is the honest scope; the capture bound stops a clamp from inventing
    windows for which no telemetry exists.

    Anything else that fails to parse raises. A label file is not a place to
    skip rows on a guess.
    """
    out = []
    with open(path, encoding='utf-8-sig') as fh:
        for lineno, row in enumerate(csv.reader(fh), 1):
            if not row or not any(x.strip() for x in row):
                continue
            if len(row) < 4:
                raise ValueError('%s line %d: expected 4 columns, got %d: %r'
                                 % (os.path.basename(path), lineno, len(row), row))
            host, pid, t0, t1 = row[0], row[1], row[2], row[3]
            start = datetime.datetime.fromisoformat(t0)

            open_ended = t1.strip().lower() in ('infinity', 'inf', '+infinity')
            if open_ended:
                day_end = start.astimezone(TZ).replace(
                    hour=23, minute=59, second=59, microsecond=0)
                end = min(day_end, CAPTURE_END)
                if end < start:
                    end = start
            else:
                end = datetime.datetime.fromisoformat(t1)

            out.append({'raw_host': host.strip(), 'host': norm_host(host),
                        'pid': pid.strip(), 'start': start, 'end': end,
                        'open_ended': open_ended})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(HERE, 'analysis', 'optc', 'inria'))
    ap.add_argument('--original', action='store_true',
                    help='use the uncorrected labels instead of the corrected ones')
    ap.add_argument('--windows', default='60,300,900')
    ap.add_argument('--out', default=None)
    ap.add_argument('--compare', action='store_true')
    args = ap.parse_args()

    tag = '' if args.original else 'corrected_'
    windows = [int(w) for w in args.windows.split(',')]
    out_path = args.out or os.path.join(
        HERE, 'analysis', 'optc',
        'window-labels-inria%s.json' % ('-original' if args.original else ''))

    spans = []
    per_scenario = {}
    for sc in SCENARIOS:
        p = os.path.join(args.dir, 'ground_truth_%s%s_updated.csv' % (tag, sc))
        rows = read_intervals(p)
        per_scenario[sc] = len(rows)
        spans.extend(rows)

    dropped = Counter(r['raw_host'] for r in spans if r['host'] is None)
    usable = [r for r in spans if r['host'] is not None]
    open_ended = [r for r in usable if r['open_ended']]

    cells = {}
    for w in windows:
        s = set()
        for r in usable:
            b0 = int(r['start'].timestamp()) // w
            b1 = int(r['end'].timestamp()) // w
            for b in range(b0, b1 + 1):
                s.add('%s|%d' % (r['host'], b))
        cells[str(w)] = sorted(s)

    hosts = sorted({r['host'] for r in usable})
    day_of = defaultdict(set)
    for r in usable:
        day_of[r['start'].astimezone(TZ).strftime('%Y-%m-%d')].add(r['host'])

    payload = {
        'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'generator': 'scripts/optc_labels_inria.py',
        'experiment': 'E1-b',
        'design': 'docs/19-e1b-design.md',
        'source': 'Inria PIRAT, A New Hope for DARPA OpTC (CSET 2025). %s labels.'
                  % ('original' if args.original else 'corrected'),
        'source_doi': '10.57745/UXCWOC',
        'source_repo': 'https://gitlab.inria.fr/fmajorcz/a_new_hope_for_darpa_optc',
        'source_license': 'CC BY 4.0',
        'unit': 'malicious process lifetime interval (host, pid, start, end)',
        'why_intervals': (
            'a planted process keeps running, so every window it is alive in contains '
            'attack activity. Point labels on the action minute mark one window positive '
            'and the rest negative, which scores a correct detection as a false positive.'),
        'spans_total': len(spans),
        'spans_per_scenario': per_scenario,
        'spans_usable': len(usable),
        'spans_open_ended': len(open_ended),
        'open_ended_note': (
            "rows whose end is 'Infinity': the process was still alive when the capture "
            "stopped. Clamped to the end of its own day or to the capture end, whichever "
            "is earlier. These are the longest lived malicious processes and therefore "
            "cover the most windows."),
        'capture_end': CAPTURE_END.isoformat(),
        'dropped_hosts': dict(dropped),
        'dropped_reason': ('no eCAR telemetry for this host; a full scan found 450 hosts '
                           'and none of them DC1 (docs/19 section 3). Same exclusion as the '
                           'previous label set.'),
        'hosts': hosts,
        'host_count': len(hosts),
        'hosts_per_day': {k: sorted(v) for k, v in sorted(day_of.items())},
        'utc_offset_hours': -4,
        'window_seconds': windows,
        'cells_note': 'key format host|floor(epoch/window)',
        'positive_cells': cells,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print('spans %d (%s)  usable %d  dropped %s'
          % (len(spans), ', '.join('%s=%d' % kv for kv in per_scenario.items()),
             len(usable), dict(dropped) or 'none'))
    print('hosts %d   open-ended spans %d (clamped to day end or %s)'
          % (len(hosts), len(open_ended), CAPTURE_END.date()))
    for w in windows:
        print('  window %4ss  positive cells %6d' % (w, len(cells[str(w)])))
    print('wrote', out_path)

    if args.compare:
        ours_path = os.path.join(HERE, 'analysis', 'optc', 'window-labels.json')
        ours = json.load(open(ours_path, encoding='utf-8-sig'))
        print()
        print('%-8s %10s %10s %9s %9s %9s' % ('window', 'ours', 'inria', 'shared', 'ours only', 'inria only'))
        for w in windows:
            a = set(ours['positive_cells'][str(w)])
            b = set(cells[str(w)])
            print('%-8s %10d %10d %9d %9d %9d'
                  % (w, len(a), len(b), len(a & b), len(a - b), len(b - a)))
        only = sorted(set(ours['positive_cells']['300']) - set(cells['300']))
        print()
        print('ours only at 300 s: %d cells, hosts %s'
              % (len(only), sorted({c.split('|')[0] for c in only})))


if __name__ == '__main__':
    main()
