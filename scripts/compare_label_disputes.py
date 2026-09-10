"""Adjudicate the cells our own labels call positive and the Inria labels do not.

At 300 s there are 17 of them. The question is which side is wrong, and the
answer turns out to be mechanical.

Our ground truth carries two kinds of line. An OBSERVED action has a real
timestamp: "09/23/19 11:23:29, manually accessed console on Sysclient0201". A
SUMMARY line has a rounded one: "09/23/19 15:30:00, removed registry
persistence ... stagers", listing nine hosts at once. The first is something an
operator recorded when it happened; the second is a paragraph heading.

That distinction separates the 17 exactly:

  13 come only from summary lines. The activity is real, but a rounded time
     cannot be placed in a five minute window, so the cell is a guess. Nine of
     them are ONE line expanded across nine hosts.
   4 come from observed actions - two RDP session opens, one RDP close, one
     email send. Inria misses these because none of them creates a malicious
     process, which is what their labelling follows.

So both label sets are incomplete in their own way, and neither is careless.
The decision (ADR-0023) is to keep the Inria set: the 13 are not defensible,
and the 4 are 0.2% of the label set with no telemetry on disk behind any of
them, so a union would change no measurement while giving every future reader
two provenances to reconcile.

Usage:
    python scripts/compare_label_disputes.py
    python scripts/compare_label_disputes.py --window 60
"""

import argparse
import collections
import csv
import datetime
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = datetime.timezone(datetime.timedelta(hours=-4))


def fnv1a31(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0x7FFFFFFF
    return h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--window', type=int, default=300)
    ap.add_argument('--ours', default=os.path.join(HERE, 'analysis', 'optc', 'window-labels.json'))
    ap.add_argument('--inria', default=os.path.join(HERE, 'analysis', 'optc', 'window-labels-inria.json'))
    ap.add_argument('--features', default=None,
                    help='feature CSV to check for telemetry. Default: ecar-windows-<window>.csv')
    ap.add_argument('--out', default=None)
    ap.add_argument('--emit-union', default=None,
                    help='also write a label file: Inria cells OR a window holding an '
                         'observed (non-summary) action from our own ground truth')
    args = ap.parse_args()

    w = args.window
    features = args.features or os.path.join(
        HERE, 'analysis', 'optc', 'ecar-windows-%d.csv' % w)
    out_path = args.out or os.path.join(
        HERE, 'analysis', 'optc', 'label-dispute-%d.json' % w)

    ours = json.load(open(args.ours, encoding='utf-8-sig'))
    inria = json.load(open(args.inria, encoding='utf-8-sig'))
    a = set(ours['positive_cells'][str(w)])
    b = set(inria['positive_cells'][str(w)])
    only = sorted(a - b, key=lambda c: (int(c.split('|')[1]), c.split('|')[0]))

    act = collections.defaultdict(list)
    for x in ours['actions']:
        act['%s|%d' % (x['host'], x['epoch'] // w)].append(x)

    # A rounded time is a summary line. Nothing else in the record distinguishes
    # the two kinds, and the operator log is the only place the difference lives.
    def observed(x):
        return not x['time'].endswith(':00')

    rows = []
    for cell in only:
        host = cell.split('|')[0]
        bucket = int(cell.split('|')[1])
        actions = act.get(cell, [])
        precise = [x for x in actions if observed(x)]
        rows.append({
            'cell': cell,
            'host': host,
            'window_start': datetime.datetime.fromtimestamp(bucket * w, TZ).isoformat(),
            'our_actions': [{'date': x['date'], 'time': x['time'], 'text': x['text']}
                            for x in actions],
            'time_granularity': 'observed' if precise else 'summary (time ends :00)',
            'verdict': ('inria misses it: the action leaves no malicious process'
                        if precise else
                        'ours is not defensible: the ground truth line is a summary with a '
                        'rounded time, so the action cannot be placed in one window'),
        })

    # A cell nobody has telemetry for cannot change a measurement either way,
    # and that is half the reason the decision is easy.
    want = {}
    for r in rows:
        if r['time_granularity'] == 'observed':
            want[(fnv1a31(r['host']), int(r['cell'].split('|')[1]))] = r['cell']
    on_disk = set()
    if want and os.path.exists(features):
        with open(features, encoding='utf-8', newline='') as fh:
            for r in csv.DictReader(fh):
                k = (int(r['host_key']), int(r['bucket']))
                if k in want:
                    on_disk.add(want[k])

    n_summary = sum(1 for r in rows if r['time_granularity'] != 'observed')
    payload = {
        'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'generator': 'scripts/compare_label_disputes.py',
        'question': ('the cells at %d s that our labels call positive and the Inria '
                     'labels do not' % w),
        'window_sec': w,
        'counts': {'ours': len(a), 'inria': len(b), 'shared': len(a & b), 'ours_only': len(only)},
        'rule': ('our ground truth carries two kinds of line. An observed action has a real '
                 'timestamp (11:23:29); a summary line has a rounded one (15:30:00). The '
                 'rule separates the disputed cells exactly.'),
        'summary': {
            'ours_only_from_summary_lines': n_summary,
            'ours_only_from_observed_actions': len(rows) - n_summary,
            'observed_ones_with_telemetry_on_disk': len(on_disk),
            'telemetry_checked_against': os.path.basename(features),
        },
        'decision': ('keep the Inria labels (ADR-0023). The summary-line cells cannot be '
                     'placed in a window. The observed ones are real and process-lifetime '
                     'labelling misses them, but they are a fraction of a percent of the '
                     'label set and none has telemetry on disk, so a union would change no '
                     'measurement while adding a second provenance to every future reading.'),
        'cells': rows,
    }
    with open(out_path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print('%d cells ours-only at %d s: %d from summary lines, %d from observed actions'
          % (len(rows), w, n_summary, len(rows) - n_summary))
    print('observed ones with telemetry on disk: %d' % len(on_disk))
    print('wrote', out_path)

    if args.emit_union:
        emit_union(args.emit_union, ours, inria, observed)


def emit_union(path, ours, inria, observed):
    """Inria's intervals plus the actions their unit cannot see.

    Process lifetime labelling misses anything that spawns no malicious process:
    an RDP session opened into a host, an email sent from one. Those windows do
    contain attack activity. Summary lines stay out, because a rounded time
    cannot name a window.

    This is a SENSITIVITY set, not the primary one. The primary labels stay the
    published Inria set so the numbers remain comparable to the paper that
    produced them; this one answers whether that choice costs anything.
    """
    windows = [int(x) for x in inria['window_seconds']]
    cells = {}
    added = {}
    for w in windows:
        s = set(inria['positive_cells'][str(w)])
        before = len(s)
        for x in ours['actions']:
            if observed(x):
                s.add('%s|%d' % (x['host'], x['epoch'] // w))
        cells[str(w)] = sorted(s)
        added[str(w)] = len(s) - before

    payload = dict(inria)
    payload['generated'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    payload['generator'] = 'scripts/compare_label_disputes.py --emit-union'
    payload['source'] = (inria.get('source', '') +
                         ' UNION observed (non-summary) actions from our own ground truth.')
    payload['union_note'] = (
        'a window is positive if a malicious process was alive in it (Inria) OR an observed '
        'operator action happened in it (ours). Summary lines with rounded times are '
        'excluded: they are real activity that cannot be placed in a window. This is the '
        'sensitivity set; the primary label set is the unmodified Inria one (ADR-0023).')
    payload['union_added_cells'] = added
    payload['positive_cells'] = cells
    with open(path, 'w', encoding='utf-8', newline=chr(10)) as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    print('union label set: added %s cells; wrote %s'
          % (', '.join('%s@%ss' % (v, k) for k, v in added.items()), path))


if __name__ == '__main__':
    main()
