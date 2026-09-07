# E1-a feature extraction: one pass over auth.txt.gz.
#
# ASCII ONLY IN THIS FILE.
#
# WHAT THIS IS FOR
#
# docs/04-evaluation.md 2.1 fixes the question. The trivial baseline
# `src in {C17693, C22409, C19932, C18025}` gets recall 100% at precision 1.46%
# - 48,079 auth rows to find 702 true ones, 67 false positives per true one.
# Recall is free; the whole competition is precision. So the experiment is:
#
#   can behavioural features, WITHOUT host or account identity, rank the true
#   events above the false ones better than that rule does?
#
# WHY NO IDENTITY FEATURES
#
# 95.4% of the labels sit on one source host. A model given host id as a feature
# memorises C17693 and reports recall 93.6% having learned nothing (ADR-0011,
# docs/08). Identity is excluded from the emitted table entirely - not dropped
# later in the notebook, not present at all. It cannot leak if it is not there.
#
# WHY THE WHOLE POPULATION AND NOT THE BASELINE'S 48k ROWS
#
# Scoring only the rows the trivial rule already selected would be re-ranking
# inside a candidate set that was defined BY the labels' source hosts. The
# precision that came out would be conditioned on the answer. So the pass runs
# over all 1.05 billion rows and subsamples the negatives; every metric is then
# computed with sample weights, which recovers the true-prevalence numbers
# exactly (each kept negative stands for -NegSample of them).
#
# NO FUTURE LEAKAGE
#
# Every feature for an event is computed from state accumulated strictly BEFORE
# that event. The stream is time ordered, state updates happen after emission.
# A feature like "distinct destinations this hour" therefore means "so far this
# hour", not "this hour in total" - the second one would let a detector see the
# rest of the attack while scoring its first step.
#
# THE EXTRACTION LIST IS FIXED HERE ON PURPOSE
#
# CLAUDE.md: decide what to pull before writing the script, because the source
# is 68 GB and "we should have pulled that too" costs another full pass. The
# list below is the contract.
#
# Usage:
#   .\scripts\Export-AuthFeatures.ps1
#   .\scripts\Export-AuthFeatures.ps1 -NegSample 500 -OutCsv analysis\lanl\auth-features.csv
#
# Output CSV columns:
#   t, label, w,
#   src_hr_events, src_hr_dst, src_hr_usr, src_hr_failrate,
#   src_prev_dst, src_life_events, src_life_dst,
#   src_new_dst, src_new_usr,
#   dst_hr_src, dst_life_src,
#   usr_hr_src, usr_life_src, usr_hr_failrate,
#   is_fail, auth_ntlm, auth_kerb, auth_other,
#   lt_network, lt_service, lt_batch, lt_interactive, lt_other,
#   or_logon, or_logoff, or_tgs, or_tgt, or_other,
#   hour

param(
  [string]$AuthGz   = 'F:\mc-cycop-data\raw\lanl-cyber1\auth.txt.gz',
  [string]$RedGz    = 'F:\mc-cycop-data\raw\lanl-cyber1\redteam.txt.gz',
  [string]$OutCsv   = "$PSScriptRoot\..\analysis\lanl\auth-features.csv",
  [string]$OutJson  = "$PSScriptRoot\..\analysis\lanl\auth-features.summary.json",
  [int]   $NegSample = 500,
  [int]   $Seed      = 20260907,
  [long]  $MaxRows   = 0
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $AuthGz)) { throw "auth not found: $AuthGz" }
if (-not (Test-Path $RedGz))  { throw "redteam not found: $RedGz" }

$cs = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

public class AuthFeatureScan
{
    public long Lines, Emitted, Positives, NegKept, Malformed;
    public long LabelHit;          // labelled rows actually seen in auth
    public int  DistinctSrc, DistinctDst, DistinctUsr;
    public long PairSrcDst, PairSrcUsr;
    public long MinT = long.MaxValue, MaxT = long.MinValue;

    HashSet<string> _labels;
    StreamWriter _out;
    int _negSample;
    uint _rng;

    // Identity is interned to ints so state maps stay small, and the int is
    // never written out. It exists to key a dictionary, not to be a feature.
    Dictionary<string,int> _srcId = new Dictionary<string,int>();
    Dictionary<string,int> _dstId = new Dictionary<string,int>();
    Dictionary<string,int> _usrId = new Dictionary<string,int>();

    // lifetime
    Dictionary<int,long> _srcEvents = new Dictionary<int,long>();
    Dictionary<int,HashSet<int>> _srcDstLife = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _dstSrcLife = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _usrSrcLife = new Dictionary<int,HashSet<int>>();
    HashSet<long> _srcUsrSeen = new HashSet<long>();

    // current hour bucket. Hour buckets rather than a sliding window: a true
    // sliding window needs a per-key deque of timestamps and the memory goes
    // from tens of MB to gigabytes for no change in what the feature means.
    long _hour = -1;
    Dictionary<int,long> _srcHrN = new Dictionary<int,long>();
    Dictionary<int,long> _srcHrFail = new Dictionary<int,long>();
    Dictionary<int,HashSet<int>> _srcHrDst = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _srcHrUsr = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _dstHrSrc = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _usrHrSrc = new Dictionary<int,HashSet<int>>();
    Dictionary<int,long> _usrHrN = new Dictionary<int,long>();
    Dictionary<int,long> _usrHrFail = new Dictionary<int,long>();
    // previous complete hour, kept for one lagged feature
    Dictionary<int,int> _srcPrevDst = new Dictionary<int,int>();

    static int Intern(Dictionary<string,int> d, string s)
    {
        int v;
        if (d.TryGetValue(s, out v)) return v;
        v = d.Count; d[s] = v; return v;
    }
    static HashSet<int> Bag(Dictionary<int,HashSet<int>> d, int k)
    {
        HashSet<int> s;
        if (!d.TryGetValue(k, out s)) { s = new HashSet<int>(); d[k] = s; }
        return s;
    }
    static long Get(Dictionary<int,long> d, int k) { long v; return d.TryGetValue(k, out v) ? v : 0; }
    static int  Cnt(Dictionary<int,HashSet<int>> d, int k) { HashSet<int> s; return d.TryGetValue(k, out s) ? s.Count : 0; }

    void RollHour()
    {
        _srcPrevDst.Clear();
        foreach (KeyValuePair<int,HashSet<int>> kv in _srcHrDst) _srcPrevDst[kv.Key] = kv.Value.Count;
        _srcHrN.Clear(); _srcHrFail.Clear(); _srcHrDst.Clear(); _srcHrUsr.Clear();
        _dstHrSrc.Clear(); _usrHrSrc.Clear(); _usrHrN.Clear(); _usrHrFail.Clear();
    }

    // xorshift; the sample must be reproducible or the experiment is not.
    uint Next() { _rng ^= _rng << 13; _rng ^= _rng >> 17; _rng ^= _rng << 5; return _rng; }

    public void Run(string authGz, HashSet<string> labels, string outCsv, int negSample, int seed, long maxRows)
    {
        _labels = labels; _negSample = negSample; _rng = (uint)(seed == 0 ? 1 : seed);

        using (FileStream fs = File.OpenRead(authGz))
        using (GZipStream gz = new GZipStream(fs, CompressionMode.Decompress))
        using (StreamReader sr = new StreamReader(gz, Encoding.ASCII, false, 1 << 20))
        using (_out = new StreamWriter(outCsv, false, new UTF8Encoding(false), 1 << 20))
        {
            _out.WriteLine("t,label,w,src_hr_events,src_hr_dst,src_hr_usr,src_hr_failrate,src_prev_dst,"
                + "src_life_events,src_life_dst,src_new_dst,src_new_usr,dst_hr_src,dst_life_src,"
                + "usr_hr_src,usr_life_src,usr_hr_failrate,is_fail,auth_ntlm,auth_kerb,auth_other,"
                + "lt_network,lt_service,lt_batch,lt_interactive,lt_other,"
                + "or_logon,or_logoff,or_tgs,or_tgt,or_other,hour");

            string line;
            while ((line = sr.ReadLine()) != null)
            {
                Lines++;
                if (maxRows > 0 && Lines > maxRows) break;

                // time,src_user,dst_user,src_comp,dst_comp,auth_type,logon_type,orientation,outcome
                string[] p = line.Split(',');
                if (p.Length < 9) { Malformed++; continue; }

                long t;
                if (!long.TryParse(p[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out t)) { Malformed++; continue; }
                if (t < MinT) MinT = t;
                if (t > MaxT) MaxT = t;

                long hr = t / 3600;
                if (hr != _hour) { if (_hour >= 0) RollHour(); _hour = hr; }

                int su = Intern(_usrId, p[1]);
                int sc = Intern(_srcId, p[3]);
                int dc = Intern(_dstId, p[4]);
                bool fail = p[8].Length > 0 && (p[8][0] == 'F' || p[8][0] == 'f');

                // label on the documented 4-field key (docs/04-evaluation.md)
                bool lab = _labels.Contains(p[0] + "|" + p[1] + "|" + p[3] + "|" + p[4]);
                if (lab) LabelHit++;

                bool keep = lab;
                if (!keep && negSample > 1) keep = (Next() % (uint)negSample) == 0;
                else if (!keep && negSample <= 1) keep = true;

                if (keep) Emit(t, lab, su, sc, dc, fail, p);

                // ---- state update happens AFTER emission: no future leakage
                _srcEvents[sc] = Get(_srcEvents, sc) + 1;
                Bag(_srcDstLife, sc).Add(dc);
                Bag(_dstSrcLife, dc).Add(sc);
                Bag(_usrSrcLife, su).Add(sc);
                _srcUsrSeen.Add(((long)sc << 32) | (uint)su);

                _srcHrN[sc] = Get(_srcHrN, sc) + 1;
                if (fail) _srcHrFail[sc] = Get(_srcHrFail, sc) + 1;
                Bag(_srcHrDst, sc).Add(dc);
                Bag(_srcHrUsr, sc).Add(su);
                Bag(_dstHrSrc, dc).Add(sc);
                Bag(_usrHrSrc, su).Add(sc);
                _usrHrN[su] = Get(_usrHrN, su) + 1;
                if (fail) _usrHrFail[su] = Get(_usrHrFail, su) + 1;
            }
        }

        DistinctSrc = _srcId.Count; DistinctDst = _dstId.Count; DistinctUsr = _usrId.Count;
        PairSrcUsr = _srcUsrSeen.Count;
        long pd = 0; foreach (HashSet<int> s in _srcDstLife.Values) pd += s.Count;
        PairSrcDst = pd;
    }

    void Emit(long t, bool lab, int su, int sc, int dc, bool fail, string[] p)
    {
        Emitted++;
        if (lab) Positives++; else NegKept++;

        long hrN = Get(_srcHrN, sc);
        long hrF = Get(_srcHrFail, sc);
        double hrFR = hrN > 0 ? (double)hrF / hrN : 0.0;
        long uN = Get(_usrHrN, su);
        long uF = Get(_usrHrFail, su);
        double uFR = uN > 0 ? (double)uF / uN : 0.0;

        int prevDst; if (!_srcPrevDst.TryGetValue(sc, out prevDst)) prevDst = 0;

        HashSet<int> lifeDst; bool newDst = true;
        if (_srcDstLife.TryGetValue(sc, out lifeDst)) newDst = !lifeDst.Contains(dc);
        bool newUsr = !_srcUsrSeen.Contains(((long)sc << 32) | (uint)su);

        string at = p[5], lt = p[6], or = p[7];
        int aN = at == "NTLM" ? 1 : 0;
        int aK = at == "Kerberos" ? 1 : 0;
        int aO = (aN == 0 && aK == 0) ? 1 : 0;
        int lNet = lt == "Network" ? 1 : 0;
        int lSvc = lt == "Service" ? 1 : 0;
        int lBat = lt == "Batch" ? 1 : 0;
        int lInt = lt == "Interactive" ? 1 : 0;
        int lOth = (lNet + lSvc + lBat + lInt) == 0 ? 1 : 0;
        int oOn = or == "LogOn" ? 1 : 0;
        int oOff = or == "LogOff" ? 1 : 0;
        int oTgs = or == "TGS" ? 1 : 0;
        int oTgt = or == "TGT" ? 1 : 0;
        int oOth = (oOn + oOff + oTgs + oTgt) == 0 ? 1 : 0;

        double w = lab ? 1.0 : (_negSample > 1 ? _negSample : 1);

        _out.Write(t); _out.Write(',');
        _out.Write(lab ? 1 : 0); _out.Write(',');
        _out.Write(w.ToString("0.#", CultureInfo.InvariantCulture)); _out.Write(',');
        _out.Write(hrN); _out.Write(',');
        _out.Write(Cnt(_srcHrDst, sc)); _out.Write(',');
        _out.Write(Cnt(_srcHrUsr, sc)); _out.Write(',');
        _out.Write(hrFR.ToString("0.#####", CultureInfo.InvariantCulture)); _out.Write(',');
        _out.Write(prevDst); _out.Write(',');
        _out.Write(Get(_srcEvents, sc)); _out.Write(',');
        _out.Write(Cnt(_srcDstLife, sc)); _out.Write(',');
        _out.Write(newDst ? 1 : 0); _out.Write(',');
        _out.Write(newUsr ? 1 : 0); _out.Write(',');
        _out.Write(Cnt(_dstHrSrc, dc)); _out.Write(',');
        _out.Write(Cnt(_dstSrcLife, dc)); _out.Write(',');
        _out.Write(Cnt(_usrHrSrc, su)); _out.Write(',');
        _out.Write(Cnt(_usrSrcLife, su)); _out.Write(',');
        _out.Write(uFR.ToString("0.#####", CultureInfo.InvariantCulture)); _out.Write(',');
        _out.Write(fail ? 1 : 0); _out.Write(',');
        _out.Write(aN); _out.Write(','); _out.Write(aK); _out.Write(','); _out.Write(aO); _out.Write(',');
        _out.Write(lNet); _out.Write(','); _out.Write(lSvc); _out.Write(','); _out.Write(lBat); _out.Write(',');
        _out.Write(lInt); _out.Write(','); _out.Write(lOth); _out.Write(',');
        _out.Write(oOn); _out.Write(','); _out.Write(oOff); _out.Write(','); _out.Write(oTgs); _out.Write(',');
        _out.Write(oTgt); _out.Write(','); _out.Write(oOth); _out.Write(',');
        _out.Write((t % 86400) / 3600);
        _out.Write('\n');
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp

# ---------------------------------------------------------------- labels
# 749 lines, 715 unique (34 duplicates). Deduplicating here rather than later
# is what keeps the same event out of both train and test (docs/04 split rule).

$labels = New-Object 'System.Collections.Generic.HashSet[string]'
$rawLines = 0
$fs = [IO.File]::OpenRead($RedGz)
$gz = New-Object IO.Compression.GzipStream($fs, [IO.Compression.CompressionMode]::Decompress)
$sr = New-Object IO.StreamReader($gz)
while ($null -ne ($line = $sr.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $rawLines++
  $p = $line.Split(',')
  if ($p.Length -lt 4) { continue }
  # redteam.txt: time,user@domain,src_computer,dst_computer
  [void]$labels.Add(($p[0] + '|' + $p[1] + '|' + $p[2] + '|' + $p[3]))
}
$sr.Close()

Write-Output ''
Write-Output 'E1-a feature extraction (LANL auth)'
Write-Output ('-' * 72)
Write-Output ("  redteam lines        : {0:N0}" -f $rawLines)
Write-Output ("  unique 4-field keys  : {0:N0}   (duplicates removed: {1})" -f $labels.Count, ($rawLines - $labels.Count))
Write-Output ("  negative subsample   : 1 in {0}" -f $NegSample)
Write-Output ("  seed                 : {0}" -f $Seed)
Write-Output ''

$dir = Split-Path $OutCsv -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

$scan = New-Object AuthFeatureScan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$scan.Run($AuthGz, $labels, (Resolve-Path $dir).Path + '\' + (Split-Path $OutCsv -Leaf), $NegSample, $Seed, $MaxRows)
$sw.Stop()

Write-Output ("  rows read            : {0:N0}" -f $scan.Lines)
Write-Output ("  malformed            : {0:N0}" -f $scan.Malformed)
Write-Output ("  labelled rows matched: {0:N0} / {1:N0}" -f $scan.LabelHit, $labels.Count)
Write-Output ("  emitted              : {0:N0}  (pos {1:N0}, neg {2:N0})" -f $scan.Emitted, $scan.Positives, $scan.NegKept)
Write-Output ("  distinct src/dst/usr : {0:N0} / {1:N0} / {2:N0}" -f $scan.DistinctSrc, $scan.DistinctDst, $scan.DistinctUsr)
Write-Output ("  (src,dst) pairs      : {0:N0}" -f $scan.PairSrcDst)
Write-Output ("  (src,user) pairs     : {0:N0}" -f $scan.PairSrcUsr)
Write-Output ("  time range           : {0:N0} .. {1:N0}  (day {2:N2} .. {3:N2})" -f `
              $scan.MinT, $scan.MaxT, ($scan.MinT / 86400), ($scan.MaxT / 86400))
Write-Output ("  elapsed              : {0:N0} s  ({1:N0} rows/s)" -f `
              $sw.Elapsed.TotalSeconds, ($scan.Lines / [math]::Max(1, $sw.Elapsed.TotalSeconds)))
Write-Output ''

$report = [ordered]@{
  generated        = (Get-Date).ToString('o')
  generator        = 'scripts/Export-AuthFeatures.ps1'
  experiment       = 'E1-a (docs/02-research-plan.md, docs/04-evaluation.md 2.1)'
  auth_source      = (Resolve-Path $AuthGz).Path
  redteam_source   = (Resolve-Path $RedGz).Path
  redteam_lines    = $rawLines
  redteam_unique   = $labels.Count
  join_key         = 'time|src_user|src_computer|dst_computer (4-field, docs/04)'
  labels_matched   = $scan.LabelHit
  negative_sample  = $NegSample
  seed             = $Seed
  rows_read        = $scan.Lines
  malformed        = $scan.Malformed
  emitted          = $scan.Emitted
  positives        = $scan.Positives
  negatives_kept   = $scan.NegKept
  distinct_src     = $scan.DistinctSrc
  distinct_dst     = $scan.DistinctDst
  distinct_usr     = $scan.DistinctUsr
  pairs_src_dst    = $scan.PairSrcDst
  pairs_src_usr    = $scan.PairSrcUsr
  time_min         = $scan.MinT
  time_max         = $scan.MaxT
  elapsed_sec      = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  identity_excluded = 'src/dst computer and user names are interned to ints for state keys and are NOT columns in the output. ADR-0011: 95.4% of labels sit on one source host, so identity is a memorisation shortcut, not a feature.'
  causality        = 'every feature is computed from state accumulated strictly before the event; state updates run after emission'
  window           = 'hour buckets (t / 3600), not a sliding window'
  weights          = 'each kept negative carries w = NegSample so weighted metrics recover true-prevalence values'
}
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
