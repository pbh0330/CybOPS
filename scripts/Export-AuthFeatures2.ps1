# E1-a feature extraction, second pass: self-normalised and burst features.
#
# ASCII ONLY IN THIS FILE.
#
# WHY A SECOND PASS EXISTS AT ALL
#
# The first list was too thin, and CLAUDE.md warned about exactly this ("decide
# what to pull before writing the script, because 'we should have pulled that
# too' is another full pass"). It cost another 55 minutes. Writing it down so
# the next dataset does not repeat it.
#
# WHAT WAS MISSING AND WHY IT MATTERS
#
# docs/04-evaluation.md states the real difficulty: C17693 ranks 645th of 17,666
# on peers-per-event - visible, but 644 normal hosts are above it. Raw counts
# cannot separate "busy host" from "host doing something unlike itself", because
# a file server legitimately talks to hundreds of machines every hour.
#
# What distinguishes an attack is not volume, it is DEPARTURE FROM THE HOST'S
# OWN BASELINE. So this pass adds:
#
#   - self-normalised counts   (this hour vs this host's own running mean/sd)
#   - lifetime-share ratios    (what fraction of everything this host has ever
#                               done happened in this hour)
#   - first-contact bursts     (new destinations this hour, and their share)
#   - minute-scale burst       (an hour bucket hides a 30-second sweep)
#   - inter-arrival gaps       (a host that was quiet for a day and woke up)
#   - pair familiarity counts  (how many times this exact src->dst has happened)
#
# EVERY ONE OF THESE WAS CHOSEN FROM ANOMALY-DETECTION PRINCIPLE, NOT FROM
# LOOKING AT THE TEST SPLIT. That distinction is the whole reason the numbers
# below will be worth anything. docs/04: "look at the ranking table to pick
# features and you are training on the test labels".
#
# Identity is still absent from the output. Same guarantee as pass 1.
#
# Usage:
#   .\scripts\Export-AuthFeatures2.ps1
#   .\scripts\Export-AuthFeatures2.ps1 -NegSample 500 -MaxRows 3000000

param(
  [string]$AuthGz    = 'F:\mc-cycop-data\raw\lanl-cyber1\auth.txt.gz',
  [string]$RedGz     = 'F:\mc-cycop-data\raw\lanl-cyber1\redteam.txt.gz',
  [string]$OutCsv    = "$PSScriptRoot\..\analysis\lanl\auth-features2.csv",
  [string]$OutJson   = "$PSScriptRoot\..\analysis\lanl\auth-features2.summary.json",
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

public class AuthFeatureScan2
{
    public long Lines, Emitted, Positives, NegKept, Malformed, LabelHit;
    public int  DistinctSrc, DistinctDst, DistinctUsr;
    public long PairSrcDst;
    public long MinT = long.MaxValue, MaxT = long.MinValue;

    HashSet<string> _labels;
    StreamWriter _out;
    int _negSample;
    uint _rng;

    Dictionary<string,int> _srcId = new Dictionary<string,int>();
    Dictionary<string,int> _dstId = new Dictionary<string,int>();
    Dictionary<string,int> _usrId = new Dictionary<string,int>();

    // lifetime
    Dictionary<int,long> _srcEvents = new Dictionary<int,long>();
    Dictionary<int,long> _srcFail = new Dictionary<int,long>();
    Dictionary<int,HashSet<int>> _srcDstLife = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _dstSrcLife = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _usrSrcLife = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _usrDstLife = new Dictionary<int,HashSet<int>>();
    Dictionary<long,int> _pairSrcDst = new Dictionary<long,int>();   // familiarity count
    HashSet<long> _pairSrcUsr = new HashSet<long>();
    Dictionary<int,long> _srcLastT = new Dictionary<int,long>();
    Dictionary<int,long> _usrLastT = new Dictionary<int,long>();

    // running per-src statistics over COMPLETED hours: count, sum, sumsq of the
    // hourly distinct-destination and failure-rate values. This is what makes
    // "unlike itself" computable without a second pass over history.
    Dictionary<int,long>   _hN  = new Dictionary<int,long>();
    Dictionary<int,double> _hS  = new Dictionary<int,double>();
    Dictionary<int,double> _hSS = new Dictionary<int,double>();
    Dictionary<int,double> _fS  = new Dictionary<int,double>();
    Dictionary<int,double> _fSS = new Dictionary<int,double>();

    // current hour
    long _hour = -1;
    Dictionary<int,long> _srcHrN = new Dictionary<int,long>();
    Dictionary<int,long> _srcHrFail = new Dictionary<int,long>();
    Dictionary<int,long> _srcHrNewDst = new Dictionary<int,long>();
    Dictionary<int,HashSet<int>> _srcHrDst = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _srcHrUsr = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _dstHrSrc = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _usrHrSrc = new Dictionary<int,HashSet<int>>();
    Dictionary<int,HashSet<int>> _usrHrDst = new Dictionary<int,HashSet<int>>();
    Dictionary<int,long> _usrHrN = new Dictionary<int,long>();
    Dictionary<int,long> _usrHrFail = new Dictionary<int,long>();
    Dictionary<int,int>  _srcPrevDst = new Dictionary<int,int>();

    // current minute. An hour bucket hides a thirty-second sweep, and a sweep
    // is what lateral movement looks like.
    long _min = -1;
    Dictionary<int,long> _srcMinN = new Dictionary<int,long>();
    Dictionary<int,HashSet<int>> _srcMinDst = new Dictionary<int,HashSet<int>>();

    static int Intern(Dictionary<string,int> d, string s)
    { int v; if (d.TryGetValue(s, out v)) return v; v = d.Count; d[s] = v; return v; }
    static HashSet<int> Bag(Dictionary<int,HashSet<int>> d, int k)
    { HashSet<int> s; if (!d.TryGetValue(k, out s)) { s = new HashSet<int>(); d[k] = s; } return s; }
    static long GetL(Dictionary<int,long> d, int k) { long v; return d.TryGetValue(k, out v) ? v : 0; }
    static double GetD(Dictionary<int,double> d, int k) { double v; return d.TryGetValue(k, out v) ? v : 0; }
    static int  Cnt(Dictionary<int,HashSet<int>> d, int k)
    { HashSet<int> s; return d.TryGetValue(k, out s) ? s.Count : 0; }

    void RollHour()
    {
        _srcPrevDst.Clear();
        foreach (KeyValuePair<int,HashSet<int>> kv in _srcHrDst)
        {
            int k = kv.Key;
            double d = kv.Value.Count;
            _srcPrevDst[k] = kv.Value.Count;
            _hN[k] = GetL(_hN, k) + 1;
            _hS[k] = GetD(_hS, k) + d;
            _hSS[k] = GetD(_hSS, k) + d * d;
            long n = GetL(_srcHrN, k);
            double fr = n > 0 ? (double)GetL(_srcHrFail, k) / n : 0.0;
            _fS[k] = GetD(_fS, k) + fr;
            _fSS[k] = GetD(_fSS, k) + fr * fr;
        }
        _srcHrN.Clear(); _srcHrFail.Clear(); _srcHrDst.Clear(); _srcHrUsr.Clear();
        _srcHrNewDst.Clear(); _dstHrSrc.Clear(); _usrHrSrc.Clear(); _usrHrDst.Clear();
        _usrHrN.Clear(); _usrHrFail.Clear();
    }
    void RollMinute() { _srcMinN.Clear(); _srcMinDst.Clear(); }

    uint Next() { _rng ^= _rng << 13; _rng ^= _rng >> 17; _rng ^= _rng << 5; return _rng; }

    static double Z(long n, double s, double ss, double x)
    {
        if (n < 3) return 0.0;                 // no baseline yet: say nothing
        double mean = s / n;
        double var = (ss / n) - mean * mean;
        if (var < 1e-9) var = 1e-9;
        double z = (x - mean) / Math.Sqrt(var);
        if (z > 50) z = 50; if (z < -50) z = -50;
        return z;
    }

    public void Run(string authGz, HashSet<string> labels, string outCsv, int negSample, int seed, long maxRows)
    {
        _labels = labels; _negSample = negSample; _rng = (uint)(seed == 0 ? 1 : seed);

        using (FileStream fs = File.OpenRead(authGz))
        using (GZipStream gz = new GZipStream(fs, CompressionMode.Decompress))
        using (StreamReader sr = new StreamReader(gz, Encoding.ASCII, false, 1 << 20))
        using (_out = new StreamWriter(outCsv, false, new UTF8Encoding(false), 1 << 20))
        {
            _out.WriteLine("t,label,w,grp,"
              + "src_hr_events,src_hr_dst,src_hr_usr,src_hr_failrate,src_prev_dst,"
              + "src_life_events,src_life_dst,src_life_failrate,src_new_dst,src_new_usr,"
              + "src_hr_newdst,src_hr_newdst_share,src_hr_dst_share,src_hr_dst_z,src_hr_fail_z,"
              + "src_min_events,src_min_dst,src_gap_log,"
              + "pair_seen,dst_hr_src,dst_life_src,dst_rarity,"
              + "usr_hr_src,usr_life_src,usr_hr_dst,usr_life_dst,usr_new_dst,usr_hr_failrate,usr_gap_log,"
              + "is_fail,auth_ntlm,auth_kerb,auth_other,"
              + "lt_network,lt_service,lt_batch,lt_interactive,lt_other,"
              + "or_logon,or_logoff,or_tgs,or_tgt,or_other,hour,dow");

            string line;
            while ((line = sr.ReadLine()) != null)
            {
                Lines++;
                if (maxRows > 0 && Lines > maxRows) break;

                string[] p = line.Split(',');
                if (p.Length < 9) { Malformed++; continue; }
                long t;
                if (!long.TryParse(p[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out t)) { Malformed++; continue; }
                if (t < MinT) MinT = t;
                if (t > MaxT) MaxT = t;

                long hr = t / 3600;
                if (hr != _hour) { if (_hour >= 0) RollHour(); _hour = hr; }
                long mn = t / 60;
                if (mn != _min) { RollMinute(); _min = mn; }

                int su = Intern(_usrId, p[1]);
                int sc = Intern(_srcId, p[3]);
                int dc = Intern(_dstId, p[4]);
                bool fail = p[8].Length > 0 && (p[8][0] == 'F' || p[8][0] == 'f');
                long pk = ((long)sc << 32) | (uint)dc;
                long uk = ((long)sc << 32) | (uint)su;
                long udk = ((long)su << 32) | (uint)dc;

                bool lab = _labels.Contains(p[0] + "|" + p[1] + "|" + p[3] + "|" + p[4]);
                if (lab) LabelHit++;

                bool keep = lab;
                if (!keep) keep = negSample <= 1 || (Next() % (uint)negSample) == 0;
                if (keep) Emit(t, lab, su, sc, dc, fail, pk, udk, p);

                // ---- state update strictly after emission
                int pc; _pairSrcDst.TryGetValue(pk, out pc);
                bool wasNew = pc == 0;
                _pairSrcDst[pk] = pc + 1;
                _pairSrcUsr.Add(uk);

                _srcEvents[sc] = GetL(_srcEvents, sc) + 1;
                if (fail) _srcFail[sc] = GetL(_srcFail, sc) + 1;
                Bag(_srcDstLife, sc).Add(dc);
                Bag(_dstSrcLife, dc).Add(sc);
                Bag(_usrSrcLife, su).Add(sc);
                Bag(_usrDstLife, su).Add(dc);
                _srcLastT[sc] = t;
                _usrLastT[su] = t;

                _srcHrN[sc] = GetL(_srcHrN, sc) + 1;
                if (fail) _srcHrFail[sc] = GetL(_srcHrFail, sc) + 1;
                if (wasNew) _srcHrNewDst[sc] = GetL(_srcHrNewDst, sc) + 1;
                Bag(_srcHrDst, sc).Add(dc);
                Bag(_srcHrUsr, sc).Add(su);
                Bag(_dstHrSrc, dc).Add(sc);
                Bag(_usrHrSrc, su).Add(sc);
                Bag(_usrHrDst, su).Add(dc);
                _usrHrN[su] = GetL(_usrHrN, su) + 1;
                if (fail) _usrHrFail[su] = GetL(_usrHrFail, su) + 1;

                _srcMinN[sc] = GetL(_srcMinN, sc) + 1;
                Bag(_srcMinDst, sc).Add(dc);
            }
        }

        DistinctSrc = _srcId.Count; DistinctDst = _dstId.Count; DistinctUsr = _usrId.Count;
        PairSrcDst = _pairSrcDst.Count;
    }

    void W(double v) { _out.Write(v.ToString("0.#####", CultureInfo.InvariantCulture)); _out.Write(','); }
    void W(long v)   { _out.Write(v); _out.Write(','); }

    void Emit(long t, bool lab, int su, int sc, int dc, bool fail, long pk, long udk, string[] p)
    {
        Emitted++;
        if (lab) Positives++; else NegKept++;

        long hrN = GetL(_srcHrN, sc), hrF = GetL(_srcHrFail, sc);
        double hrFR = hrN > 0 ? (double)hrF / hrN : 0.0;
        int hrDst = Cnt(_srcHrDst, sc);
        long lifeN = GetL(_srcEvents, sc), lifeF = GetL(_srcFail, sc);
        int lifeDst = Cnt(_srcDstLife, sc);
        long hrNew = GetL(_srcHrNewDst, sc);

        long uN = GetL(_usrHrN, su), uF = GetL(_usrHrFail, su);
        double uFR = uN > 0 ? (double)uF / uN : 0.0;

        int prevDst; if (!_srcPrevDst.TryGetValue(sc, out prevDst)) prevDst = 0;
        int pairSeen; _pairSrcDst.TryGetValue(pk, out pairSeen);
        bool newDst = pairSeen == 0;
        bool newUsr = !_pairSrcUsr.Contains(((long)sc << 32) | (uint)su);
        bool uNewDst = !_usrDstLife.ContainsKey(su) || !_usrDstLife[su].Contains(dc);

        long lastT; double gap = _srcLastT.TryGetValue(sc, out lastT) ? (t - lastT) : 86400.0;
        long ulastT; double ugap = _usrLastT.TryGetValue(su, out ulastT) ? (t - ulastT) : 86400.0;

        int dstLifeSrc = Cnt(_dstSrcLife, dc);

        double w = lab ? 1.0 : (_negSample > 1 ? _negSample : 1);

        // Grouping key for the host-hour view, NOT a feature.
        //
        // Operationally an alert is not one auth row. An analyst who opens
        // "C17693 did something odd in hour 212" has one thing to look at, and
        // scoring per row punishes a detector for missing the other four
        // hundred rows of the same hour. The host-hour view needs a group id,
        // and a group id needs identity - so it is emitted as a SALTED HASH:
        // exact for grouping, meaningless as a number, and excluded by name in
        // run_e1a.py so no model can split on it.
        long g = 2166136261L;
        string gk = p[3] + "|" + (t / 3600);
        for (int gi = 0; gi < gk.Length; gi++) { g ^= gk[gi]; g = (g * 16777619L) & 0x7FFFFFFFL; }

        _out.Write(t); _out.Write(',');
        _out.Write(lab ? 1 : 0); _out.Write(',');
        W(w);
        _out.Write(g); _out.Write(',');
        W(hrN); W((long)hrDst); W((long)Cnt(_srcHrUsr, sc)); W(hrFR); W((long)prevDst);
        W(lifeN); W((long)lifeDst); W(lifeN > 0 ? (double)lifeF / lifeN : 0.0);
        W(newDst ? 1L : 0L); W(newUsr ? 1L : 0L);
        W(hrNew);
        W(hrDst > 0 ? (double)hrNew / hrDst : 0.0);          // share of this hour that is first contact
        W(lifeDst > 0 ? (double)hrDst / lifeDst : 0.0);       // share of lifetime fan-out in this hour
        W(Z(GetL(_hN, sc), GetD(_hS, sc), GetD(_hSS, sc), hrDst));
        W(Z(GetL(_hN, sc), GetD(_fS, sc), GetD(_fSS, sc), hrFR));
        W(GetL(_srcMinN, sc)); W((long)Cnt(_srcMinDst, sc));
        W(Math.Log(1.0 + gap));
        W((long)pairSeen);
        W((long)Cnt(_dstHrSrc, dc)); W((long)dstLifeSrc);
        W(1.0 / (1.0 + dstLifeSrc));                          // rarely-contacted destination
        W((long)Cnt(_usrHrSrc, su)); W((long)Cnt(_usrSrcLife, su));
        W((long)Cnt(_usrHrDst, su)); W((long)Cnt(_usrDstLife, su));
        W(uNewDst ? 1L : 0L); W(uFR); W(Math.Log(1.0 + ugap));

        string at = p[5], lt = p[6], or = p[7];
        int aN = at == "NTLM" ? 1 : 0, aK = at == "Kerberos" ? 1 : 0;
        int lNet = lt == "Network" ? 1 : 0, lSvc = lt == "Service" ? 1 : 0;
        int lBat = lt == "Batch" ? 1 : 0, lInt = lt == "Interactive" ? 1 : 0;
        int oOn = or == "LogOn" ? 1 : 0, oOff = or == "LogOff" ? 1 : 0;
        int oTgs = or == "TGS" ? 1 : 0, oTgt = or == "TGT" ? 1 : 0;

        W(fail ? 1L : 0L);
        W((long)aN); W((long)aK); W((long)((aN + aK) == 0 ? 1 : 0));
        W((long)lNet); W((long)lSvc); W((long)lBat); W((long)lInt);
        W((long)((lNet + lSvc + lBat + lInt) == 0 ? 1 : 0));
        W((long)oOn); W((long)oOff); W((long)oTgs); W((long)oTgt);
        W((long)((oOn + oOff + oTgs + oTgt) == 0 ? 1 : 0));
        _out.Write((t % 86400) / 3600); _out.Write(',');
        _out.Write((t / 86400) % 7);
        _out.Write('\n');
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp

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
  [void]$labels.Add(($p[0] + '|' + $p[1] + '|' + $p[2] + '|' + $p[3]))
}
$sr.Close()

Write-Output ''
Write-Output 'E1-a feature extraction, pass 2 (self-normalised + burst)'
Write-Output ('-' * 72)
Write-Output ("  redteam unique keys  : {0:N0}  (dupes removed {1})" -f $labels.Count, ($rawLines - $labels.Count))
Write-Output ("  negative subsample   : 1 in {0}   seed {1}" -f $NegSample, $Seed)
Write-Output ''

$dir = Split-Path $OutCsv -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

$scan = New-Object AuthFeatureScan2
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$scan.Run($AuthGz, $labels, (Resolve-Path $dir).Path + '\' + (Split-Path $OutCsv -Leaf), $NegSample, $Seed, $MaxRows)
$sw.Stop()

Write-Output ("  rows read            : {0:N0}   malformed {1}" -f $scan.Lines, $scan.Malformed)
Write-Output ("  labels matched       : {0:N0} / {1:N0}" -f $scan.LabelHit, $labels.Count)
Write-Output ("  emitted              : {0:N0}  (pos {1:N0}, neg {2:N0})" -f $scan.Emitted, $scan.Positives, $scan.NegKept)
Write-Output ("  distinct src/dst/usr : {0:N0} / {1:N0} / {2:N0}" -f $scan.DistinctSrc, $scan.DistinctDst, $scan.DistinctUsr)
Write-Output ("  (src,dst) pairs      : {0:N0}" -f $scan.PairSrcDst)
Write-Output ("  elapsed              : {0:N0} s ({1:N0} rows/s)" -f $sw.Elapsed.TotalSeconds, ($scan.Lines / [math]::Max(1, $sw.Elapsed.TotalSeconds)))
Write-Output ''

$report = [ordered]@{
  generated       = (Get-Date).ToString('o')
  generator       = 'scripts/Export-AuthFeatures2.ps1'
  experiment      = 'E1-a pass 2'
  pass1           = 'scripts/Export-AuthFeatures.ps1'
  why_second_pass = 'raw counts cannot separate a busy host from a host acting unlike itself. Pass 2 adds self-normalised (per-host running z), lifetime-share, first-contact burst, minute-scale burst, inter-arrival gap and pair familiarity.'
  chosen_how      = 'from anomaly-detection principle, before looking at any test result. docs/04: picking features off the ranking table is training on the test labels.'
  redteam_unique  = $labels.Count
  labels_matched  = $scan.LabelHit
  negative_sample = $NegSample
  seed            = $Seed
  rows_read       = $scan.Lines
  emitted         = $scan.Emitted
  positives       = $scan.Positives
  negatives_kept  = $scan.NegKept
  distinct_src    = $scan.DistinctSrc
  distinct_dst    = $scan.DistinctDst
  distinct_usr    = $scan.DistinctUsr
  pairs_src_dst   = $scan.PairSrcDst
  elapsed_sec     = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  identity_excluded = 'host and account strings are interned to ints for state keys only; no identity column is written'
  causality       = 'features from state strictly before the event; state updated after emission'
}
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
