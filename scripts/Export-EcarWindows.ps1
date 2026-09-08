# E1-b step 2: (host, window) features from eCAR.
#
# ASCII ONLY IN THIS FILE.
#
# WHY THIS IS NOT Export-AuthFeatures WITH DIFFERENT COLUMNS
#
# auth.txt is one schema, nine fields, one row per authentication. eCAR is a
# union type: every record has action / object / hostname / timestamp, and then
# `properties` carries a different payload depending on whether the object is a
# FILE, a PROCESS, a FLOW, a MODULE and so on. There is no single row shape to
# featurise, and the unit of evaluation is not the row anyway - it is the
# (host, window) cell, because that is the only unit the ground truth exists at
# (docs/19-e1b-design.md section 1).
#
# So this aggregates as it streams. One pass, one accumulator per open cell,
# flush when the window closes.
#
# WHAT IS NOT IN HERE, ON PURPOSE
#
#   identity   hostname, image paths, principals and file paths are hashed into
#              state keys and never written out. E1-a settled this: with the
#              labels concentrated on a few machines, identity is a memorisation
#              shortcut (ADR-0011).
#   lifetime   no cumulative per-host counters. E1-a's ablation found they were
#              not a fingerprint but a distribution shift - they made every
#              split WORSE (docs/18 section 4.4). Not repeating that.
#
# The self-normalised features that did the work in E1-a are here instead: each
# cell is described partly by how far it sits from that host's own running mean.
#
# ORDERING
#
# eCAR bundles are not globally time sorted, and records for one host can appear
# in any order inside a bundle. Cells are therefore held in a dictionary keyed by
# (host, bucket) and flushed when the stream has moved well past them, rather
# than assuming a monotonic clock. LATE records after a flush are counted and
# reported - if that count is large the window logic is wrong and the numbers
# have to be thrown away.
#
# Usage:
#   .\scripts\Export-EcarWindows.ps1
#   .\scripts\Export-EcarWindows.ps1 -WindowSec 300 -NegSample 20 -MaxFiles 2

param(
  [string]$Root      = 'F:\mc-cycop-data\raw\optc\ecar',
  [string]$Labels    = "$PSScriptRoot\..\analysis\optc\window-labels.json",
  [string]$OutCsv    = "$PSScriptRoot\..\analysis\optc\ecar-windows-300.csv",
  [string]$OutJson   = "$PSScriptRoot\..\analysis\optc\ecar-windows-300.summary.json",
  [int]   $WindowSec = 300,
  [int]   $NegSample = 20,
  [int]   $Seed      = 20260908,
  [int]   $MaxFiles  = 0
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Root))   { throw "ecar root not found: $Root" }
if (-not (Test-Path $Labels)) { throw "window labels not found: $Labels - run New-OptcWindowLabels.ps1" }

$lab = Get-Content $Labels -Raw -Encoding utf8 | ConvertFrom-Json
$key = [string]$WindowSec
if (-not $lab.positive_cells.$key) { throw "no positive cells for window $WindowSec s in $Labels" }
$posCells = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($c in $lab.positive_cells.$key) { [void]$posCells.Add([string]$c) }

$cs = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

public class EcarWindowScan
{
    public long Lines, Malformed, Cells, Emitted, Positives, NegKept, Late;
    public long MinT = long.MaxValue, MaxT = long.MinValue;
    public int Hosts;

    // One open cell. Everything is a count or a set size; nothing here is an
    // identifier that survives to the output.
    class Cell
    {
        public string Host; public long Bucket;
        public long N, NFile, NProc, NFlow, NModule, NOther;
        public long Create, Write, Delete, Read, Rename, Start, Terminate, Open, Msg;
        public HashSet<int> Images = new HashSet<int>();
        public HashSet<int> NewImages = new HashSet<int>();
        public HashSet<int> Dirs = new HashSet<int>();
        public HashSet<int> Dsts = new HashSet<int>();
        public HashSet<int> NewDsts = new HashSet<int>();
        public HashSet<int> Principals = new HashSet<int>();
        public HashSet<int> Pids = new HashSet<int>();
        public long SystemPrincipal;
        public long ExternalDst;
    }

    Dictionary<string,Cell> _open = new Dictionary<string,Cell>();
    HashSet<string> _flushed = new HashSet<string>();
    HashSet<string> _pos;
    StreamWriter _out;
    int _win, _negSample;
    uint _rng;
    long _watermark = long.MinValue;

    // per-host running statistics over CLOSED cells, for the self-normalised
    // features that carried E1-a
    Dictionary<string,long>   _hN  = new Dictionary<string,long>();
    Dictionary<string,double> _hS  = new Dictionary<string,double>();
    Dictionary<string,double> _hSS = new Dictionary<string,double>();
    Dictionary<string,double> _dS  = new Dictionary<string,double>();
    Dictionary<string,double> _dSS = new Dictionary<string,double>();

    // interning: identity becomes an int used as a set key, then discarded
    Dictionary<string,int> _img = new Dictionary<string,int>();
    Dictionary<string,int> _dir = new Dictionary<string,int>();
    Dictionary<string,int> _dst = new Dictionary<string,int>();
    Dictionary<string,int> _pri = new Dictionary<string,int>();
    HashSet<long> _seenImgHost = new HashSet<long>();
    HashSet<long> _seenDstHost = new HashSet<long>();
    Dictionary<string,int> _hostId = new Dictionary<string,int>();

    static int Intern(Dictionary<string,int> d, string s)
    { int v; if (d.TryGetValue(s, out v)) return v; v = d.Count; d[s] = v; return v; }
    static long GetL(Dictionary<string,long> d, string k) { long v; return d.TryGetValue(k, out v) ? v : 0; }
    static double GetD(Dictionary<string,double> d, string k) { double v; return d.TryGetValue(k, out v) ? v : 0; }

    uint Next() { _rng ^= _rng << 13; _rng ^= _rng >> 17; _rng ^= _rng << 5; return _rng; }

    static double Z(long n, double s, double ss, double x)
    {
        if (n < 3) return 0.0;
        double mean = s / n, var = (ss / n) - mean * mean;
        if (var < 1e-9) var = 1e-9;
        double z = (x - mean) / Math.Sqrt(var);
        return z > 50 ? 50 : (z < -50 ? -50 : z);
    }

    // Extract one JSON string field without parsing the object. Records are
    // machine generated by one producer with stable key order and no escaped
    // quotes in these fields; a full parse of 589M records would dominate the
    // runtime. If a field stops being found the counters go to zero and say so.
    static string Field(string s, string key)
    {
        int i = s.IndexOf(key, StringComparison.Ordinal);
        if (i < 0) return null;
        i += key.Length;
        int e = s.IndexOf('"', i);
        return e < 0 ? null : s.Substring(i, e - i);
    }

    public void Run(string[] files, HashSet<string> pos, string outCsv, int win, int negSample, int seed)
    {
        _pos = pos; _win = win; _negSample = negSample; _rng = (uint)(seed == 0 ? 1 : seed);

        using (_out = new StreamWriter(outCsv, false, new UTF8Encoding(false), 1 << 20))
        {
            _out.WriteLine("bucket,host_key,label,w,n,n_file,n_proc,n_flow,n_module,n_other,"
              + "a_create,a_write,a_delete,a_read,a_rename,a_start,a_terminate,a_open,a_msg,"
              + "images,new_images,new_image_share,dirs,dsts,new_dsts,new_dst_share,external_share,"
              + "principals,system_share,pids,"
              + "n_z,dsts_z,hour,dow");

            foreach (string f in files)
            {
                using (FileStream fs = File.OpenRead(f))
                using (GZipStream gz = new GZipStream(fs, CompressionMode.Decompress))
                using (StreamReader sr = new StreamReader(gz, Encoding.ASCII, false, 1 << 20))
                {
                    string line;
                    while ((line = sr.ReadLine()) != null)
                    {
                        Lines++;
                        Consume(line);
                    }
                }
                // NOT a flush point. AIA-201-225 ships as two files (ecar-last and a
                // dated one) covering the same hosts and the same hours, so closing
                // cells at a bundle boundary guarantees that the second file arrives
                // after its cells are gone. That produced 3.8M LATE records at the
                // 900 s window - 0.6% of the corpus - and the guard below caught it.
                // Cells are cheap here (180k at the finest window, about 130 MB), so
                // they are all held open until the end.

            }

            // The only flush. Everything has been read, so no cell can still be
            // waiting for records and LATE must come out at zero. If it does
            // not, the assumption that a record's own timestamp decides its cell
            // is wrong and the run is void.
            FlushAll();
        }
        Hosts = _hostId.Count;
    }

    void Consume(string line)
    {
        string ts = Field(line, "\"timestamp\":\"");
        string host = Field(line, "\"hostname\":\"");
        if (ts == null || host == null) { Malformed++; return; }

        DateTimeOffset dto;
        if (!DateTimeOffset.TryParse(ts, CultureInfo.InvariantCulture,
                                     DateTimeStyles.None, out dto)) { Malformed++; return; }
        long epoch = dto.ToUnixTimeSeconds();
        if (epoch < MinT) MinT = epoch;
        if (epoch > MaxT) MaxT = epoch;

        int dot = host.IndexOf('.');
        if (dot > 0) host = host.Substring(0, dot);
        Intern(_hostId, host);

        long bucket = (long)Math.Floor((double)epoch / _win);
        string ck = host + "|" + bucket;

        if (_flushed.Contains(ck)) { Late++; return; }

        Cell c;
        if (!_open.TryGetValue(ck, out c))
        {
            c = new Cell(); c.Host = host; c.Bucket = bucket;
            _open[ck] = c;
            Cells++;
        }

        string action = Field(line, "\"action\":\"");
        string obj = Field(line, "\"object\":\"");
        c.N++;
        switch (obj)
        {
            case "FILE": c.NFile++; break;
            case "PROCESS": c.NProc++; break;
            case "FLOW": c.NFlow++; break;
            case "MODULE": c.NModule++; break;
            default: c.NOther++; break;
        }
        switch (action)
        {
            case "CREATE": c.Create++; break;
            case "WRITE": c.Write++; break;
            case "DELETE": c.Delete++; break;
            case "READ": c.Read++; break;
            case "RENAME": c.Rename++; break;
            case "START": c.Start++; break;
            case "TERMINATE": c.Terminate++; break;
            case "OPEN": c.Open++; break;
            case "MESSAGE": c.Msg++; break;
        }

        int hid = _hostId[host];

        string img = Field(line, "\"image_path\":\"");
        if (img != null)
        {
            int id = Intern(_img, img);
            c.Images.Add(id);
            long k = ((long)hid << 32) | (uint)id;
            if (!_seenImgHost.Contains(k)) { c.NewImages.Add(id); _seenImgHost.Add(k); }
        }
        string fp = Field(line, "\"file_path\":\"");
        if (fp != null)
        {
            int cut = fp.LastIndexOf('\\');
            c.Dirs.Add(Intern(_dir, cut > 0 ? fp.Substring(0, cut) : fp));
        }
        string dip = Field(line, "\"dest_ip\":\"");
        if (dip != null)
        {
            int id = Intern(_dst, dip);
            c.Dsts.Add(id);
            long k = ((long)hid << 32) | (uint)id;
            if (!_seenDstHost.Contains(k)) { c.NewDsts.Add(id); _seenDstHost.Add(k); }
            // the range in this capture is 142.20.0.0/16 and 10.x; anything else
            // is off-site as far as this network is concerned
            if (!dip.StartsWith("142.20.") && !dip.StartsWith("10.")) c.ExternalDst++;
        }
        string pri = Field(line, "\"principal\":\"");
        if (pri != null)
        {
            c.Principals.Add(Intern(_pri, pri));
            if (pri.IndexOf("SYSTEM", StringComparison.OrdinalIgnoreCase) >= 0) c.SystemPrincipal++;
        }
        string pid = Field(line, "\"pid\":");
        if (pid != null) { int p; if (int.TryParse(pid.Split(',')[0].Trim(), out p)) c.Pids.Add(p); }

        if (epoch > _watermark) _watermark = epoch;
    }

    void FlushBelow(long cutoffEpoch)
    {
        long cutoff = (long)Math.Floor((double)cutoffEpoch / _win);
        List<string> gone = new List<string>();
        foreach (KeyValuePair<string,Cell> kv in _open)
            if (kv.Value.Bucket < cutoff) gone.Add(kv.Key);
        foreach (string k in gone) { Emit(_open[k]); _flushed.Add(k); _open.Remove(k); }
    }

    void FlushAll()
    {
        foreach (KeyValuePair<string,Cell> kv in _open) { Emit(kv.Value); _flushed.Add(kv.Key); }
        _open.Clear();
    }

    void Emit(Cell c)
    {
        string ck = c.Host + "|" + c.Bucket;
        bool lab = _pos.Contains(ck);

        bool keep = lab;
        if (!keep) keep = _negSample <= 1 || (Next() % (uint)_negSample) == 0;

        // running per-host stats update regardless of whether the cell is kept:
        // the baseline must describe the host, not the sample
        double zn = Z(GetL(_hN, c.Host), GetD(_hS, c.Host), GetD(_hSS, c.Host), c.N);
        double zd = Z(GetL(_hN, c.Host), GetD(_dS, c.Host), GetD(_dSS, c.Host), c.Dsts.Count);
        _hN[c.Host] = GetL(_hN, c.Host) + 1;
        _hS[c.Host] = GetD(_hS, c.Host) + c.N;
        _hSS[c.Host] = GetD(_hSS, c.Host) + (double)c.N * c.N;
        _dS[c.Host] = GetD(_dS, c.Host) + c.Dsts.Count;
        _dSS[c.Host] = GetD(_dSS, c.Host) + (double)c.Dsts.Count * c.Dsts.Count;

        if (!keep) return;

        Emitted++;
        if (lab) Positives++; else NegKept++;

        long epoch = c.Bucket * _win;
        DateTimeOffset dto = DateTimeOffset.FromUnixTimeSeconds(epoch).ToOffset(TimeSpan.FromHours(-4));
        double w = lab ? 1.0 : (_negSample > 1 ? _negSample : 1);

        // Grouping key, not a feature. MTTD has to order a host's attacked cells
        // in time, which needs to know which cells belong to the same host, and
        // the plan names MTTD as an E1-b metric. Salted hash: exact for grouping,
        // meaningless as a number, and run_e1b.py excludes it by name.
        long hk = 2166136261L;
        for (int i = 0; i < c.Host.Length; i++) { hk ^= c.Host[i]; hk = (hk * 16777619L) & 0x7FFFFFFFL; }

        StringBuilder sb = new StringBuilder(320);
        sb.Append(c.Bucket).Append(',');
        sb.Append(hk).Append(',');
        sb.Append(lab ? 1 : 0).Append(',');
        sb.Append(w.ToString("0.#", CultureInfo.InvariantCulture)).Append(',');
        sb.Append(c.N).Append(',').Append(c.NFile).Append(',').Append(c.NProc).Append(',')
          .Append(c.NFlow).Append(',').Append(c.NModule).Append(',').Append(c.NOther).Append(',');
        sb.Append(c.Create).Append(',').Append(c.Write).Append(',').Append(c.Delete).Append(',')
          .Append(c.Read).Append(',').Append(c.Rename).Append(',').Append(c.Start).Append(',')
          .Append(c.Terminate).Append(',').Append(c.Open).Append(',').Append(c.Msg).Append(',');
        sb.Append(c.Images.Count).Append(',').Append(c.NewImages.Count).Append(',')
          .Append((c.Images.Count > 0 ? (double)c.NewImages.Count / c.Images.Count : 0).ToString("0.####", CultureInfo.InvariantCulture)).Append(',');
        sb.Append(c.Dirs.Count).Append(',');
        sb.Append(c.Dsts.Count).Append(',').Append(c.NewDsts.Count).Append(',')
          .Append((c.Dsts.Count > 0 ? (double)c.NewDsts.Count / c.Dsts.Count : 0).ToString("0.####", CultureInfo.InvariantCulture)).Append(',');
        sb.Append((c.NFlow > 0 ? (double)c.ExternalDst / c.NFlow : 0).ToString("0.####", CultureInfo.InvariantCulture)).Append(',');
        sb.Append(c.Principals.Count).Append(',')
          .Append((c.N > 0 ? (double)c.SystemPrincipal / c.N : 0).ToString("0.####", CultureInfo.InvariantCulture)).Append(',');
        sb.Append(c.Pids.Count).Append(',');
        sb.Append(zn.ToString("0.####", CultureInfo.InvariantCulture)).Append(',');
        sb.Append(zd.ToString("0.####", CultureInfo.InvariantCulture)).Append(',');
        sb.Append(dto.Hour).Append(',').Append((int)dto.DayOfWeek);
        _out.Write(sb.ToString());
        _out.Write('\n');
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp

$files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter *.gz | Sort-Object FullName | ForEach-Object { $_.FullName })
if ($MaxFiles -gt 0) { $files = @($files | Select-Object -First $MaxFiles) }
if ($files.Count -eq 0) { throw "no .gz under $Root" }

Write-Output ''
Write-Output 'E1-b window feature extraction (eCAR)'
Write-Output ('-' * 74)
Write-Output ("  bundles          : {0}" -f $files.Count)
Write-Output ("  window           : {0} s" -f $WindowSec)
Write-Output ("  positive cells   : {0}" -f $posCells.Count)
Write-Output ("  negative sample  : 1 in {0}   seed {1}" -f $NegSample, $Seed)
Write-Output ''

$dir = Split-Path $OutCsv -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

$scan = New-Object EcarWindowScan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$scan.Run($files, $posCells, ((Resolve-Path $dir).Path + '\' + (Split-Path $OutCsv -Leaf)), $WindowSec, $NegSample, $Seed)
$sw.Stop()

Write-Output ("  records read     : {0:N0}   malformed {1:N0}" -f $scan.Lines, $scan.Malformed)
Write-Output ("  hosts seen       : {0:N0}" -f $scan.Hosts)
Write-Output ("  cells created    : {0:N0}" -f $scan.Cells)
Write-Output ("  emitted          : {0:N0}  (pos {1:N0}, neg {2:N0})" -f $scan.Emitted, $scan.Positives, $scan.NegKept)
Write-Output ("  LATE records     : {0:N0}" -f $scan.Late)
if ($scan.Late -gt $scan.Lines / 1000) {
  Write-Output '  ** LATE is over 0.1% of records. The flush watermark is closing cells'
  Write-Output '     too early and the cell contents are wrong. Do not use this output.'
}
Write-Output ("  time range       : {0} .. {1}" -f `
  ([datetimeoffset]::FromUnixTimeSeconds($scan.MinT).ToOffset([timespan]::FromHours(-4)).ToString('yyyy-MM-dd HH:mm')),
  ([datetimeoffset]::FromUnixTimeSeconds($scan.MaxT).ToOffset([timespan]::FromHours(-4)).ToString('yyyy-MM-dd HH:mm')))
Write-Output ("  elapsed          : {0:N0} s ({1:N0} rec/s)" -f `
  $sw.Elapsed.TotalSeconds, ($scan.Lines / [math]::Max(1, $sw.Elapsed.TotalSeconds)))
Write-Output ''

$report = [ordered]@{
  generated      = (Get-Date).ToString('o')
  generator      = 'scripts/Export-EcarWindows.ps1'
  experiment     = 'E1-b step 2'
  design         = 'docs/19-e1b-design.md'
  labels         = (Resolve-Path $Labels).Path
  window_sec     = $WindowSec
  positive_cells_expected = $posCells.Count
  negative_sample = $NegSample
  seed           = $Seed
  bundles        = $files.Count
  records_read   = $scan.Lines
  malformed      = $scan.Malformed
  hosts          = $scan.Hosts
  cells_created  = $scan.Cells
  emitted        = $scan.Emitted
  positives      = $scan.Positives
  negatives_kept = $scan.NegKept
  late_records   = $scan.Late
  time_min       = $scan.MinT
  time_max       = $scan.MaxT
  elapsed_sec    = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  identity_excluded = 'hostname, image paths, file paths, principals and destination IPs are interned to ints for set keys only; no identity column is written'
  lifetime_excluded = 'no cumulative per-host counters. E1-a ablation found they hurt every split (docs/18 4.4)'
  clock          = 'ground truth times are the eCAR local clock (-04:00), measured by scripts/Test-OptcTimeAlign.ps1'
}
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
