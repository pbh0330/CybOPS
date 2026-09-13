# E1-b step 3 input: graph-shaped derivatives from eCAR, one pass.
#
# ASCII ONLY IN THIS FILE.
#
# WHY THIS EXISTS
#
# Export-EcarWindows.ps1 writes per-(host, window) counts and, by design, no
# identity: it knows HOW MANY destinations a host talked to, never WHICH. That
# is right for a per-cell classifier and useless for anything about spread.
# The project's coordinate system is a dependency graph (ADR-0001), and the
# next experiment asks whether a host's neighbours in the flow graph carry
# signal about the host. That needs edges, and the raw archive is 249 GB that
# took four days to fetch and is about to be deleted (ADR-0010). So the edges
# are pulled now, in the same single pass style, before anything is removed.
#
# WHAT IS WRITTEN (all keyed by 300 s bucket; 900 s is bucket / 3)
#
#   flow-edges   bucket, host_key, dir, peer_ip, port, proto, n
#                one row per (cell, direction, remote IP, port class, protocol).
#                Ports are classed, not raw: <=1023 and a short list of service
#                ports are kept, ephemeral (>=49152) becomes "eph", the rest
#                "other". Flows whose local or remote end is multicast,
#                broadcast, link-local or loopback are dropped - a broadcast
#                is not an edge between two hosts.
#   proc-tree    bucket, host_key, parent_image, image, user_class, n
#                one row per (cell, parent image, child image, user class) over
#                PROCESS CREATE records. Images are lower-cased with the
#                \Device\HarddiskVolumeN prefix removed. user_class is
#                system / service / user from the "user" field.
#   host-ip      host_key, hostname, ip, first_seen, last_seen, n
#                what each host called itself on the wire (outbound src_ip and
#                inbound dest_ip). This is the table that turns peer_ip into a
#                host_key, and it is the one place the hostname is written out.
#
# host_key is the same FNV-1a-31 of the short hostname that the window CSV and
# the label file use, so the three artefacts join.
#
# WHAT IS NOT WRITTEN: command lines, file paths, principals, pids, actor and
# object ids. Nothing here is a feature vector; it is adjacency.
#
# Usage:
#   .\scripts\Export-EcarGraph.ps1
#   .\scripts\Export-EcarGraph.ps1 -MaxFiles 1 -OutDir analysis\optc\smoke

param(
  [string]$Root      = 'F:\mc-cycop-data\raw\optc\ecar',
  [string]$OutDir    = "$PSScriptRoot\..\analysis\optc",
  [int]   $BucketSec = 300,
  [int]   $MaxFiles  = 0
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Root)) { throw "ecar root not found: $Root" }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }
$OutDir = (Resolve-Path $OutDir).Path

$cs = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

public class EcarGraphScan
{
    public long Lines, Malformed, Vanished, FlowSeen, FlowKept, FlowDropped, ProcCreate;
    public long MinT = long.MaxValue, MaxT = long.MinValue;
    public int Hosts;
    public long EdgeRows, TreeRows, HostIpRows;

    Dictionary<string,long> _edges = new Dictionary<string,long>();
    Dictionary<string,long> _tree  = new Dictionary<string,long>();
    // host|ip -> [first, last, n]
    Dictionary<string,long[]> _hostIp = new Dictionary<string,long[]>();
    HashSet<string> _hosts = new HashSet<string>();
    int _win;

    static readonly HashSet<string> ServicePorts = new HashSet<string> {
        "1433","1434","3306","3389","5355","5985","5986","8080","8443","9092","9389"
    };

    static string Field(string s, string key)
    {
        int i = s.IndexOf(key, StringComparison.Ordinal);
        if (i < 0) return null;
        i += key.Length;
        int e = s.IndexOf('"', i);
        return e < 0 ? null : s.Substring(i, e - i);
    }

    static long Fnv(string s)
    {
        long hk = 2166136261L;
        for (int i = 0; i < s.Length; i++) { hk ^= s[i]; hk = (hk * 16777619L) & 0x7FFFFFFFL; }
        return hk;
    }

    static string PortClass(string p)
    {
        int v;
        if (p == null || !int.TryParse(p, out v)) return "na";
        if (v <= 1023) return p;
        if (ServicePorts.Contains(p)) return p;
        if (v >= 49152) return "eph";
        return "other";
    }

    // Not a host-to-host edge: multicast, broadcast, link-local, loopback,
    // unspecified. IPv6 is dropped wholesale - this network runs IPv4 and the
    // v6 traffic seen is link-local neighbour chatter.
    static bool DropPeer(string ip)
    {
        if (string.IsNullOrEmpty(ip)) return true;
        if (ip.IndexOf(':') >= 0) return true;
        if (ip.StartsWith("224.") || ip.StartsWith("239.") || ip.StartsWith("255.")) return true;
        if (ip.StartsWith("169.254.") || ip.StartsWith("127.") || ip == "0.0.0.0") return true;
        if (ip.EndsWith(".255")) return true;
        int first;
        string head = ip.Split('.')[0];
        if (int.TryParse(head, out first) && first >= 224) return true;
        return false;
    }

    static string NormImage(string p)
    {
        if (p == null) return "";
        // Field() returns the raw JSON text, so backslashes arrive doubled
        p = p.Replace("\\\\", "\\").ToLowerInvariant();
        if (p.StartsWith("\\device\\harddiskvolume"))
        {
            int i = p.IndexOf('\\', 1 + "\\device\\".Length);
            if (i > 0) p = p.Substring(i);
        }
        return p.Replace(',', ';');
    }

    static string UserClass(string u)
    {
        if (u == null) return "na";
        string l = u.ToLowerInvariant();
        if (l.EndsWith("\\system") || l.EndsWith("\\local service") || l.EndsWith("\\network service")) return "system";
        if (l.StartsWith("nt authority\\") || l.StartsWith("nt service\\") || l.StartsWith("window manager\\")
            || l.StartsWith("font driver host\\")) return "service";
        return "user";
    }

    static void Bump(Dictionary<string,long> d, string k)
    { long v; d.TryGetValue(k, out v); d[k] = v + 1; }

    public void Run(string[] files, int win)
    {
        _win = win;
        foreach (string f in files)
        {
            try
            {
                using (FileStream fs = File.OpenRead(f))
                using (GZipStream gz = new GZipStream(fs, CompressionMode.Decompress))
                using (StreamReader sr = new StreamReader(gz, Encoding.ASCII, false, 1 << 20))
                {
                    string line;
                    while ((line = sr.ReadLine()) != null) { Lines++; Consume(line); }
                }
            }
            catch (FileNotFoundException) { Vanished++; continue; }
            catch (IOException) { Vanished++; continue; }
            catch (InvalidDataException) { Vanished++; continue; }
        }
        Hosts = _hosts.Count;
    }

    void Consume(string line)
    {
        string obj = Field(line, "\"object\":\"");
        if (obj != "FLOW" && obj != "PROCESS") return;
        string action = Field(line, "\"action\":\"");
        if (obj == "PROCESS" && action != "CREATE") return;

        string ts = Field(line, "\"timestamp\":\"");
        string host = Field(line, "\"hostname\":\"");
        if (ts == null || host == null) { Malformed++; return; }
        DateTimeOffset dto;
        if (!DateTimeOffset.TryParse(ts, CultureInfo.InvariantCulture, DateTimeStyles.None, out dto)) { Malformed++; return; }
        long epoch = dto.ToUnixTimeSeconds();
        if (epoch < MinT) MinT = epoch;
        if (epoch > MaxT) MaxT = epoch;
        int dot = host.IndexOf('.');
        if (dot > 0) host = host.Substring(0, dot);
        _hosts.Add(host);
        long bucket = (long)Math.Floor((double)epoch / _win);
        long hk = Fnv(host);

        if (obj == "FLOW")
        {
            FlowSeen++;
            string dir = Field(line, "\"direction\":\"");
            string sip = Field(line, "\"src_ip\":\"");
            string dip = Field(line, "\"dest_ip\":\"");
            string port = Field(line, "\"dest_port\":\"");
            string proto = Field(line, "\"l4protocol\":\"");
            string self, peer, d;
            if (dir == "outbound") { self = sip; peer = dip; d = "out"; }
            else if (dir == "inbound") { self = dip; peer = sip; d = "in"; }
            else { FlowDropped++; return; }
            // A flow whose local end is a multicast or broadcast address was
            // not sent to this host, it was sent to everyone (LLMNR, NetBIOS
            // name service). That is not an edge between two hosts, and left
            // in it gives every machine the same fat in-degree.
            if (DropPeer(self) || DropPeer(peer)) { FlowDropped++; return; }
            string hk2 = host + "|" + self;
            long[] rec;
            if (!_hostIp.TryGetValue(hk2, out rec)) { rec = new long[] { epoch, epoch, 0 }; _hostIp[hk2] = rec; }
            if (epoch < rec[0]) rec[0] = epoch;
            if (epoch > rec[1]) rec[1] = epoch;
            rec[2]++;
            FlowKept++;
            Bump(_edges, bucket + "," + hk + "," + d + "," + peer + "," + PortClass(port) + "," + (proto ?? "na"));
        }
        else
        {
            ProcCreate++;
            string img = NormImage(Field(line, "\"image_path\":\""));
            string par = NormImage(Field(line, "\"parent_image_path\":\""));
            string uc = UserClass(Field(line, "\"user\":\""));
            Bump(_tree, bucket + "," + hk + "," + par + "," + img + "," + uc);
        }
    }

    public void Write(string edgesCsv, string treeCsv, string hostIpCsv)
    {
        UTF8Encoding enc = new UTF8Encoding(false);
        using (StreamWriter w = new StreamWriter(edgesCsv, false, enc, 1 << 20))
        {
            w.WriteLine("bucket,host_key,dir,peer_ip,port,proto,n");
            foreach (KeyValuePair<string,long> kv in _edges) { w.Write(kv.Key); w.Write(','); w.WriteLine(kv.Value); EdgeRows++; }
        }
        using (StreamWriter w = new StreamWriter(treeCsv, false, enc, 1 << 20))
        {
            w.WriteLine("bucket,host_key,parent_image,image,user_class,n");
            foreach (KeyValuePair<string,long> kv in _tree) { w.Write(kv.Key); w.Write(','); w.WriteLine(kv.Value); TreeRows++; }
        }
        using (StreamWriter w = new StreamWriter(hostIpCsv, false, enc, 1 << 16))
        {
            w.WriteLine("host_key,hostname,ip,first_seen,last_seen,n");
            foreach (KeyValuePair<string,long[]> kv in _hostIp)
            {
                int bar = kv.Key.IndexOf('|');
                string host = kv.Key.Substring(0, bar);
                string ip = kv.Key.Substring(bar + 1);
                w.WriteLine(Fnv(host) + "," + host + "," + ip + "," + kv.Value[0] + "," + kv.Value[1] + "," + kv.Value[2]);
                HostIpRows++;
            }
        }
    }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp

$files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter *.gz | Sort-Object FullName | ForEach-Object { $_.FullName })
if ($MaxFiles -gt 0) { $files = @($files | Select-Object -First $MaxFiles) }
if ($files.Count -eq 0) { throw "no .gz under $Root" }

$edgesCsv  = Join-Path $OutDir ("ecar-flow-edges-{0}.csv" -f $BucketSec)
$treeCsv   = Join-Path $OutDir ("ecar-proc-tree-{0}.csv" -f $BucketSec)
$hostIpCsv = Join-Path $OutDir "ecar-host-ip.csv"
$summary   = Join-Path $OutDir ("ecar-graph-{0}.summary.json" -f $BucketSec)

Write-Output ""
Write-Output "E1-b graph extraction (eCAR)"
Write-Output "--------------------------------------------------------------------------"
Write-Output ("  bundles          : {0}" -f $files.Count)
Write-Output ("  bucket           : {0} s" -f $BucketSec)
Write-Output ("  out              : {0}" -f $OutDir)
Write-Output ""

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$scan = New-Object EcarGraphScan
$scan.Run($files, $BucketSec)
$scan.Write($edgesCsv, $treeCsv, $hostIpCsv)
$sw.Stop()

$rate = if ($sw.Elapsed.TotalSeconds -gt 0) { $scan.Lines / $sw.Elapsed.TotalSeconds } else { 0 }
$tmin = if ($scan.MinT -ne [long]::MaxValue) { [DateTimeOffset]::FromUnixTimeSeconds($scan.MinT).ToOffset([TimeSpan]::FromHours(-4)).ToString('yyyy-MM-dd HH:mm') } else { 'n/a' }
$tmax = if ($scan.MaxT -ne [long]::MinValue) { [DateTimeOffset]::FromUnixTimeSeconds($scan.MaxT).ToOffset([TimeSpan]::FromHours(-4)).ToString('yyyy-MM-dd HH:mm') } else { 'n/a' }

Write-Output ("  records read     : {0:N0}   malformed {1:N0}" -f $scan.Lines, $scan.Malformed)
Write-Output ("  hosts            : {0}" -f $scan.Hosts)
Write-Output ("  flows            : {0:N0} seen, {1:N0} kept as edges, {2:N0} dropped (non-host peer)" -f $scan.FlowSeen, $scan.FlowKept, $scan.FlowDropped)
Write-Output ("  process creates  : {0:N0}" -f $scan.ProcCreate)
Write-Output ("  rows             : edges {0:N0}   tree {1:N0}   host-ip {2:N0}" -f $scan.EdgeRows, $scan.TreeRows, $scan.HostIpRows)
Write-Output ("  SKIPPED files    : {0:N0}" -f $scan.Vanished)
Write-Output ("  time range       : {0} .. {1}" -f $tmin, $tmax)
Write-Output ("  elapsed          : {0:N0} s ({1:N0} rec/s)" -f $sw.Elapsed.TotalSeconds, $rate)

$commit = ''
try { $commit = (& git -C (Split-Path $PSScriptRoot -Parent) rev-parse --short HEAD 2>$null) } catch { }

$report = [ordered]@{
  generated       = (Get-Date).ToString('o')
  generator       = 'scripts/Export-EcarGraph.ps1'
  code_version    = "$commit"
  experiment      = 'E1-b step 3 input (graph derivatives)'
  design          = 'docs/19-e1b-design.md section 15.5'
  bucket_sec      = $BucketSec
  bundles         = $files.Count
  records_read    = $scan.Lines
  malformed       = $scan.Malformed
  vanished_files  = $scan.Vanished
  hosts           = $scan.Hosts
  flows_seen      = $scan.FlowSeen
  flows_kept      = $scan.FlowKept
  flows_dropped   = $scan.FlowDropped
  process_creates = $scan.ProcCreate
  edge_rows       = $scan.EdgeRows
  tree_rows       = $scan.TreeRows
  host_ip_rows    = $scan.HostIpRows
  time_min        = $scan.MinT
  time_max        = $scan.MaxT
  elapsed_sec     = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  outputs         = @($edgesCsv, $treeCsv, $hostIpCsv)
  not_written     = 'command lines, file paths, principals, pids, actor/object ids. hostname appears only in ecar-host-ip.csv, which is the IP-to-host join table.'
}
$report | ConvertTo-Json -Depth 4 | Set-Content -Path $summary -Encoding utf8
Write-Output ""
Write-Output ("report: {0}" -f $summary)
