"""Re-label an extracted feature CSV without re-running the extraction.

Export-EcarWindows.ps1 takes two and a half hours per window size, and the
labels are the only thing changing. It writes host_key as an FNV-1a hash of the
eCAR host string masked to 31 bits, with no salt despite what the comment
there says, so the hash is reproducible from a hostname and the label column
can be rewritten in place.

    host_key = fnv1a("SysClient0201") & 0x7FFFFFFF

The weight column moves with the label. Negatives carry the subsampling factor
so that weighted counts estimate the population; positives are never subsampled
and carry 1. With -NegSample 1 the two are the same, but the rule is applied
rather than assumed, because a later run with subsampling would otherwise write
silently wrong weights.

Usage:
    python scripts/relabel_ecar_windows.py \
        --features analysis/optc/ecar-windows-300.csv \
        --labels   analysis/optc/window-labels-inria.json
"""

import argparse
import csv
import datetime
import json
import os
import shutil
from collections import Counter


def fnv1a31(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0x7FFFFFFF
    return h


def write_summary(side, summary, lab, labels_path, wanted, positives, rows_n):
    """Keep the sidecar telling the truth about the file next to it.

    Export-EcarWindows.ps1 wrote positives, positive_cells_expected and the
    label path when it extracted. All three are about the OLD labels the moment
    this script runs, and a stale sidecar saying 62 positives next to a file
    holding 214 is worse than no sidecar: the extraction fields around it are
    still correct, so there is nothing to warn a reader off.

    The extraction fields are left exactly as they were. The label fields are
    updated and a relabelled block records what happened, so the file still says
    which run produced the features and now also says which labels they carry.
    """
    prev = {'labels': summary.get('labels'),
            'positives': summary.get('positives'),
            'positive_cells_expected': summary.get('positive_cells_expected')}
    summary['labels'] = os.path.abspath(labels_path)
    summary['positive_cells_expected'] = len(wanted)
    summary['positives'] = positives
    summary['negatives_kept'] = rows_n - positives
    summary['relabelled'] = {
        'by': 'scripts/relabel_ecar_windows.py',
        'when': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'label_source': lab.get('source'),
        'label_generator': lab.get('generator'),
        'was': prev,
        'note': ('the features were not re-extracted. host_key is an unsalted FNV-1a of '
                 'the eCAR host string, so the label column can be recomputed from host '
                 'names alone.'),
    }
    with open(side, 'w', encoding='utf-8') as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--features', required=True)
    ap.add_argument('--labels', required=True)
    ap.add_argument('--out', default=None, help='default: rewrite in place, keeping a .bak')
    ap.add_argument('--neg-weight', type=float, default=None,
                    help='weight for negatives. Default: read from the existing file')
    ap.add_argument('--summary-only', action='store_true',
                    help='do not touch the CSV; only refresh its .summary.json sidecar')
    args = ap.parse_args()

    lab = json.load(open(args.labels, encoding='utf-8-sig'))

    # window size decides how a cell key is formed, and it must match the file
    side = os.path.splitext(args.features)[0] + '.summary.json'
    if not os.path.exists(side):
        raise SystemExit('need %s to know the window size of this file' % side)
    summary = json.load(open(side, encoding='utf-8-sig'))
    win = int(summary['window_sec'])
    if str(win) not in lab['positive_cells']:
        raise SystemExit('label file has no cells for window %ds' % win)

    # (host_key, bucket) is what the CSV can be joined on
    wanted = set()
    hosts = set()
    for cell in lab['positive_cells'][str(win)]:
        host, bucket = cell.split('|')
        hosts.add(host)
        wanted.add((fnv1a31(host), int(bucket)))
    print('labels: %d cells over %d hosts at %ds' % (len(wanted), len(hosts), win))

    if args.summary_only:
        # The sidecar describes the extraction, and after a relabel its
        # positives field describes labels the file no longer carries. Counting
        # the CSV again is the only honest way to refresh it.
        pos = 0
        rows_n = 0
        seen = set()
        with open(args.features, encoding='utf-8', newline='') as fin:
            for r in csv.DictReader(fin):
                rows_n += 1
                seen.add(int(r['host_key']))
                if r['label'] == '1':
                    pos += 1
        write_summary(side, summary, lab, args.labels, wanted, pos, rows_n)
        print('summary refreshed: %s  positives %d of %d rows' % (side, pos, rows_n))
        return

    out_path = args.out or args.features
    tmp = out_path + '.tmp'

    seen_keys = set()
    counts = Counter()
    neg_w = args.neg_weight

    with open(args.features, encoding='utf-8', newline='') as fin:
        rdr = csv.DictReader(fin)
        fields = rdr.fieldnames
        if 'label' not in fields or 'host_key' not in fields or 'bucket' not in fields:
            raise SystemExit('unexpected columns: %r' % (fields,))
        rows = []
        for r in rdr:
            hk = int(r['host_key'])
            seen_keys.add(hk)
            if neg_w is None and r['label'] == '0':
                neg_w = float(r['w'])
            rows.append(r)

    if neg_w is None:
        neg_w = 1.0

    with open(tmp, 'w', encoding='utf-8', newline='') as fout:
        wtr = csv.DictWriter(fout, fieldnames=fields, lineterminator='\n')
        wtr.writeheader()
        for r in rows:
            was = r['label']
            now = '1' if (int(r['host_key']), int(r['bucket'])) in wanted else '0'
            counts[(was, now)] += 1
            r['label'] = now
            r['w'] = '1' if now == '1' else ('%g' % neg_w)
            wtr.writerow(r)

    if not args.out and os.path.exists(args.features):
        shutil.copyfile(args.features, args.features + '.bak')
    shutil.move(tmp, out_path)

    # A labelled cell whose host never appears in the telemetry is coverage,
    # not a modelling result, and it has to be reported next to the counts.
    missing_hosts = sorted(h for h in hosts if fnv1a31(h) not in seen_keys)
    matched = sum(v for k, v in counts.items() if k[1] == '1')

    print('rows        %d' % sum(counts.values()))
    print('label 0->1  %d' % counts[('0', '1')])
    print('label 1->0  %d' % counts[('1', '0')])
    print('label 1->1  %d' % counts[('1', '1')])
    print('positives   %d of %d labelled cells (%.0f%% of the label set is present in this file)'
          % (matched, len(wanted), 100.0 * matched / max(1, len(wanted))))
    if missing_hosts:
        print('hosts with labels but no telemetry: %d  %s'
              % (len(missing_hosts), missing_hosts[:10]))
    if not args.out:
        write_summary(side, summary, lab, args.labels, wanted, matched, sum(counts.values()))
        print('summary refreshed:', side)
    print('wrote', out_path)


if __name__ == '__main__':
    main()
