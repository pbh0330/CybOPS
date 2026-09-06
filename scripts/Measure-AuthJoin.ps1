# Measure-AuthJoin.ps1
# Single streaming pass over LANL auth.txt.gz to answer three questions the
# evaluation plan depends on:
#
#   1. Does auth.txt really hold 1,051,430,459 records? (so far a quoted figure)
#   2. Do all 749 red team events have a matching auth record? (join integrity -
#      if they do not, the labels cannot be attached to the telemetry at all)
#   3. How much NORMAL traffic do the 4 red team source hosts generate?
#      That number is the precision ceiling of the trivial baseline
#      "src in {C17693, C22409, C19932, C18025}", which has recall 100%
#      (see docs/08-lanl-ground-truth.md and docs/04-evaluation.md).
#
# auth.txt fields:
#   0 time, 1 src user@domain, 2 dst user@domain, 3 src computer,
#   4 dst computer, 5 auth type, 6 logon type, 7 orientation, 8 success/failure
# redteam.txt fields:
#   0 time, 1 user@domain, 2 src computer, 3 dst computer
# Join: auth[0,1,3,4] == redteam[0,1,2,3]
#
# 1.05e9 lines is far past what a PowerShell loop can process - per-iteration
# overhead alone would run for hours. The scan is compiled C# working on raw
# bytes, materializing strings only for the handful of lines that could match.
# Field identity is tested by FNV-1a 64 hash of the field bytes, so the hot
# path allocates nothing.
#
# ASCII only: Windows PowerShell 5.1 misreads BOM-less UTF-8 script files.
#
# Usage:
#   .\scripts\Measure-AuthJoin.ps1
#   .\scripts\Measure-AuthJoin.ps1 -OutJson analysis\lanl\auth-join.json

[CmdletBinding()]
param(
    [string] $AuthPath    = 'F:\mc-cycop-data\raw\lanl-cyber1\auth.txt.gz',
    [string] $RedteamPath = 'F:\mc-cycop-data\raw\lanl-cyber1\redteam.txt.gz',
    [string] $OutJson     = '',
    [string] $ProgressLog = 'F:\mc-cycop-data\raw\lanl-cyber1\_authscan.log'
)

$ErrorActionPreference = 'Stop'

foreach ($p in @($AuthPath, $RedteamPath)) {
    if (-not (Test-Path -LiteralPath $p)) { throw ('Not found: ' + $p) }
}

# ---------------------------------------------------------------- red team
$fs = [System.IO.File]::OpenRead($RedteamPath)
$gz = New-Object System.IO.Compression.GzipStream($fs, [System.IO.Compression.CompressionMode]::Decompress)
$sr = New-Object System.IO.StreamReader($gz)
$rtRaw = $sr.ReadToEnd()
$sr.Close(); $fs.Close()

$rtKeys  = New-Object 'System.Collections.Generic.List[string]'
$rtUsers = New-Object 'System.Collections.Generic.List[string]'
$rtSrcs  = New-Object 'System.Collections.Generic.List[string]'
foreach ($line in ($rtRaw -split "`n")) {
    $l = $line.Trim()
    if ($l -eq '') { continue }
    $p = $l -split ','
    if ($p.Count -lt 4) { continue }
    # auth key order: time, srcUser, srcComp, dstComp
    $rtKeys.Add(($p[0] + ',' + $p[1] + ',' + $p[2] + ',' + $p[3]))
    if (-not $rtUsers.Contains($p[1])) { $rtUsers.Add($p[1]) }
    if (-not $rtSrcs.Contains($p[2]))  { $rtSrcs.Add($p[2]) }
}

Write-Host ('red team events : {0:N0}' -f $rtKeys.Count)
Write-Host ('  source hosts  : {0}' -f ($rtSrcs -join ', '))
Write-Host ('  accounts      : {0:N0}' -f $rtUsers.Count)
Write-Host ''
Write-Host 'scanning auth.txt.gz - this reads 68 GB of decompressed text'
Write-Host ('progress log: ' + $ProgressLog)
Write-Host ''

# ---------------------------------------------------------------- scanner
$cs = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

public class AuthScan
{
    public long Lines;
    public long Malformed;
    public long MinTime = long.MaxValue;
    public long MaxTime = long.MinValue;

    // per red team source host
    public Dictionary<string, long> HostTotal   = new Dictionary<string, long>();
    public Dictionary<string, long> HostLabeled = new Dictionary<string, long>();
    public Dictionary<string, long> HostFail    = new Dictionary<string, long>();

    // per compromised account (as source user), across all hosts
    public Dictionary<string, long> UserTotal   = new Dictionary<string, long>();
    public Dictionary<string, long> UserLabeled = new Dictionary<string, long>();

    public long LabeledFound;
    public HashSet<string> MatchedKeys = new HashSet<string>();

    static ulong Fnv(byte[] b, int off, int len)
    {
        ulong h = 14695981039346656037UL;
        for (int i = 0; i < len; i++) { h ^= b[off + i]; h *= 1099511628211UL; }
        return h;
    }

    static string Str(byte[] b, int off, int len)
    {
        return Encoding.ASCII.GetString(b, off, len);
    }

    public void Run(string authGz, string[] hosts, string[] users,
                    HashSet<string> rtKeys, string progressLog)
    {
        var hostHash = new Dictionary<ulong, string>();
        foreach (var h in hosts)
        {
            byte[] hb = Encoding.ASCII.GetBytes(h);
            hostHash[Fnv(hb, 0, hb.Length)] = h;
            HostTotal[h] = 0; HostLabeled[h] = 0; HostFail[h] = 0;
        }
        var userHash = new Dictionary<ulong, string>();
        foreach (var u in users)
        {
            byte[] ub = Encoding.ASCII.GetBytes(u);
            userHash[Fnv(ub, 0, ub.Length)] = u;
            UserTotal[u] = 0; UserLabeled[u] = 0;
        }

        const int BUF = 1 << 22;              // 4 MB
        byte[] buf = new byte[BUF];
        byte[] carry = new byte[1 << 16];     // partial line across reads
        int carryLen = 0;
        int[] comma = new int[16];

        var sw = System.Diagnostics.Stopwatch.StartNew();
        long nextReport = 25000000;

        using (var fsr = File.OpenRead(authGz))
        using (var gzs = new GZipStream(fsr, CompressionMode.Decompress))
        {
            int n;
            while ((n = gzs.Read(buf, 0, BUF)) > 0)
            {
                int start = 0;
                for (int i = 0; i < n; i++)
                {
                    if (buf[i] != (byte)'\n') continue;

                    int lineOff, lineLen;
                    byte[] src;
                    if (carryLen > 0)
                    {
                        int need = i - start;
                        if (carryLen + need > carry.Length)
                            Array.Resize(ref carry, (carryLen + need) * 2);
                        Buffer.BlockCopy(buf, start, carry, carryLen, need);
                        src = carry; lineOff = 0; lineLen = carryLen + need;
                        carryLen = 0;
                    }
                    else { src = buf; lineOff = start; lineLen = i - start; }

                    if (lineLen > 0 && src[lineOff + lineLen - 1] == (byte)'\r') lineLen--;
                    if (lineLen > 0) Handle(src, lineOff, lineLen, comma, hostHash, userHash, rtKeys);

                    start = i + 1;

                    if (Lines >= nextReport)
                    {
                        nextReport += 25000000;
                        File.AppendAllText(progressLog, string.Format(
                            "{0:MM-dd HH:mm:ss}  {1:N0} lines, {2:N0} labeled found, {3:N0}s\r\n",
                            DateTime.Now, Lines, LabeledFound, sw.Elapsed.TotalSeconds));
                    }
                }
                int rest = n - start;
                if (rest > 0)
                {
                    if (carryLen + rest > carry.Length) Array.Resize(ref carry, (carryLen + rest) * 2);
                    Buffer.BlockCopy(buf, start, carry, carryLen, rest);
                    carryLen += rest;
                }
            }
        }
        if (carryLen > 0) Handle(carry, 0, carryLen, comma, hostHash, userHash, rtKeys);
    }

    void Handle(byte[] b, int off, int len, int[] comma,
                Dictionary<ulong, string> hostHash,
                Dictionary<ulong, string> userHash,
                HashSet<string> rtKeys)
    {
        int nc = 0;
        int end = off + len;
        for (int i = off; i < end && nc < 16; i++)
            if (b[i] == (byte)',') comma[nc++] = i;

        if (nc < 8) { Malformed++; Lines++; return; }
        Lines++;

        // field 0: time
        long t = 0;
        for (int i = off; i < comma[0]; i++)
        {
            byte c = b[i];
            if (c < (byte)'0' || c > (byte)'9') { t = -1; break; }
            t = t * 10 + (c - (byte)'0');
        }
        if (t >= 0) { if (t < MinTime) MinTime = t; if (t > MaxTime) MaxTime = t; }

        int uOff = comma[0] + 1, uLen = comma[1] - uOff;   // field 1 src user
        int sOff = comma[2] + 1, sLen = comma[3] - sOff;   // field 3 src computer
        int dOff = comma[3] + 1, dLen = comma[4] - dOff;   // field 4 dst computer

        string userName = null;
        ulong uh = Fnv(b, uOff, uLen);
        if (userHash.TryGetValue(uh, out userName)) UserTotal[userName]++;

        string hostName = null;
        ulong sh = Fnv(b, sOff, sLen);
        if (!hostHash.TryGetValue(sh, out hostName))
        {
            return;   // not a red team source host - nothing further to record
        }

        HostTotal[hostName]++;

        // outcome is the last field
        int oOff = comma[nc - 1] + 1;
        int oLen = end - oOff;
        if (oLen >= 4 && (b[oOff] == (byte)'F' || b[oOff] == (byte)'f')) HostFail[hostName]++;

        // Only lines from these 4 hosts can be red team events, so the string
        // work below runs on a tiny fraction of the file.
        string key = Str(b, off, comma[0] - off) + "," + Str(b, uOff, uLen)
                   + "," + Str(b, sOff, sLen) + "," + Str(b, dOff, dLen);
        if (rtKeys.Contains(key))
        {
            LabeledFound++;
            MatchedKeys.Add(key);
            HostLabeled[hostName]++;
            if (userName != null) UserLabeled[userName]++;
        }
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp

if (Test-Path -LiteralPath $ProgressLog) { Remove-Item -LiteralPath $ProgressLog -Force }

$set = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($k in $rtKeys) { [void]$set.Add($k) }

$scan = New-Object AuthScan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$scan.Run($AuthPath, $rtSrcs.ToArray(), $rtUsers.ToArray(), $set, $ProgressLog)
$sw.Stop()

# ---------------------------------------------------------------- report
$expected = 1051430459
Write-Host ''
Write-Host '=== auth.txt record count ==='
Write-Host ('  records          : {0:N0}' -f $scan.Lines)
Write-Host ('  LANL documented  : {0:N0}' -f $expected)
Write-Host ('  difference       : {0:N0}' -f ($scan.Lines - $expected))
Write-Host ('  malformed        : {0:N0}' -f $scan.Malformed)
Write-Host ('  time range       : {0:N0} .. {1:N0}  (day {2:N2} .. {3:N2})' -f `
            $scan.MinTime, $scan.MaxTime, ($scan.MinTime/86400), ($scan.MaxTime/86400))
Write-Host ('  elapsed          : {0:N0} s' -f $sw.Elapsed.TotalSeconds)

$matched = $scan.MatchedKeys.Count
Write-Host ''
Write-Host '=== label join integrity ==='
Write-Host ('  red team events           : {0:N0}' -f $rtKeys.Count)
Write-Host ('  matched in auth.txt       : {0:N0}' -f $matched)
Write-Host ('  auth rows carrying a label : {0:N0}' -f $scan.LabeledFound)
if ($matched -eq $rtKeys.Count) {
    Write-Host '  -> every red team event has a matching auth record.'
} else {
    Write-Host ('  -> {0:N0} RED TEAM EVENTS HAVE NO MATCHING AUTH RECORD' -f ($rtKeys.Count - $matched))
}

Write-Host ''
Write-Host '=== trivial baseline: src in {red team source hosts} ==='
Write-Host '  host        auth rows      labeled   precision   fail rate'
$sumTotal = 0; $sumLabeled = 0
foreach ($h in $rtSrcs) {
    $tot = $scan.HostTotal[$h]; $lab = $scan.HostLabeled[$h]; $fail = $scan.HostFail[$h]
    $sumTotal += $tot; $sumLabeled += $lab
    $prec = 0.0; if ($tot -gt 0) { $prec = $lab / [double]$tot * 100 }
    $fr = 0.0; if ($tot -gt 0) { $fr = $fail / [double]$tot * 100 }
    Write-Host ('  {0,-10} {1,12:N0} {2,12:N0} {3,10:N4}% {4,10:N1}%' -f $h, $tot, $lab, $prec, $fr)
}
$precAll = 0.0; if ($sumTotal -gt 0) { $precAll = $sumLabeled / [double]$sumTotal * 100 }
Write-Host ('  {0,-10} {1,12:N0} {2,12:N0} {3,10:N4}%' -f 'ALL 4', $sumTotal, $sumLabeled, $precAll)
Write-Host ''
Write-Host ('  recall 100% but precision {0:N4}% - {1:N0} false positives per true positive.' -f `
            $precAll, [math]::Round(($sumTotal - $sumLabeled) / [double][math]::Max(1,$sumLabeled)))

Write-Host ''
Write-Host '=== compromised accounts: normal vs labeled ==='
$rows = @()
foreach ($u in $rtUsers) {
    $rows += [PSCustomObject]@{
        User = $u; Total = $scan.UserTotal[$u]; Labeled = $scan.UserLabeled[$u]
    }
}
$rows = $rows | Sort-Object Total -Descending
$uTot = ($rows | Measure-Object Total -Sum).Sum
$uLab = ($rows | Measure-Object Labeled -Sum).Sum
Write-Host ('  {0} accounts produced {1:N0} auth rows, of which {2:N0} are labeled ({3:E3}%)' -f `
            $rows.Count, $uTot, $uLab, ($uLab / [double][math]::Max(1,$uTot) * 100))
Write-Host '  top 10 by volume:'
$rows | Select-Object -First 10 | ForEach-Object {
    Write-Host ('    {0,-14} {1,12:N0} rows  {2,5:N0} labeled' -f $_.User, $_.Total, $_.Labeled)
}

if ($OutJson -ne '') {
    $o = [ordered]@{
        auth_path          = $AuthPath
        records            = $scan.Lines
        records_documented = $expected
        records_match      = ($scan.Lines -eq $expected)
        malformed          = $scan.Malformed
        min_time           = $scan.MinTime
        max_time           = $scan.MaxTime
        scan_seconds       = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        redteam_events     = $rtKeys.Count
        redteam_matched    = $matched
        join_complete      = ($matched -eq $rtKeys.Count)
        baseline           = [ordered]@{
            hosts            = @($rtSrcs)
            auth_rows        = $sumTotal
            labeled_rows     = $sumLabeled
            recall_pct       = 100.0
            precision_pct    = [double]('{0:G6}' -f $precAll)
            fp_per_tp        = [math]::Round(($sumTotal - $sumLabeled) / [double][math]::Max(1,$sumLabeled))
            per_host         = @($rtSrcs | ForEach-Object {
                                  [ordered]@{ host = $_; auth_rows = $scan.HostTotal[$_]
                                              labeled = $scan.HostLabeled[$_]; failures = $scan.HostFail[$_] } })
        }
        accounts           = [ordered]@{
            count       = $rows.Count
            auth_rows   = $uTot
            labeled     = $uLab
            top         = @($rows | Select-Object -First 25 | ForEach-Object {
                              [ordered]@{ user = $_.User; auth_rows = $_.Total; labeled = $_.Labeled } })
        }
    }
    $dir = Split-Path $OutJson -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $o | ConvertTo-Json -Depth 6 | Set-Content -Path $OutJson -Encoding UTF8
    Write-Host ''
    Write-Host ('  wrote ' + $OutJson)
}
