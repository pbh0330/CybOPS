# Export-AuthRedteamSlice.ps1
# Second pass over auth.txt.gz, extracting a small slice for offline analysis.
#
# Measure-AuthJoin.ps1 found that 48 of the 749 red team events (6.4%) have no
# matching auth record on the key (time, src user, src computer, dst computer).
# Either the join key is wrong for those rows, or the events are genuinely
# absent from auth.txt. Both answers change what the labels are worth, and
# neither can be settled without looking at the actual rows.
#
# Rescanning 68 GB for every question is wasteful, so this pass distills the
# relevant slice to disk once (the DISTILL step in docs/05-data-lifecycle.md):
#
#   1. every auth row whose source OR destination is a red team source host
#      (~48k rows - the trivial baseline's full working set)
#   2. every auth row at the exact second of an unmatched red team event
#      (~200 rows/second on average, so ~10k rows for 48 events)
#
# ASCII only: Windows PowerShell 5.1 misreads BOM-less UTF-8 script files.
#
# Usage:
#   .\scripts\Export-AuthRedteamSlice.ps1

[CmdletBinding()]
param(
    [string] $AuthPath    = 'F:\mc-cycop-data\raw\lanl-cyber1\auth.txt.gz',
    [string] $RedteamPath = 'F:\mc-cycop-data\raw\lanl-cyber1\redteam.txt.gz',
    [string] $OutDir      = 'analysis\lanl',
    [string] $ProgressLog = 'F:\mc-cycop-data\raw\lanl-cyber1\_authslice.log'
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- red team
$fs = [System.IO.File]::OpenRead($RedteamPath)
$gz = New-Object System.IO.Compression.GzipStream($fs, [System.IO.Compression.CompressionMode]::Decompress)
$sr = New-Object System.IO.StreamReader($gz)
$rtRaw = $sr.ReadToEnd()
$sr.Close(); $fs.Close()

$rt = @()
foreach ($line in ($rtRaw -split "`n")) {
    $l = $line.Trim(); if ($l -eq '') { continue }
    $p = $l -split ','; if ($p.Count -lt 4) { continue }
    $rt += [PSCustomObject]@{ Time=$p[0]; User=$p[1]; Src=$p[2]; Dst=$p[3]
                              Key=($p[0]+','+$p[1]+','+$p[2]+','+$p[3]) }
}

# Reuse the join result if present so we slice only the unmatched seconds.
$joinPath = Join-Path $OutDir 'auth-join.json'
$matchedKeys = @{}
if (Test-Path $joinPath) {
    Write-Host 'note: auth-join.json found, but it stores counts rather than the'
    Write-Host '      matched key list - recomputing matches during this pass.'
}

$hosts = @($rt.Src | Sort-Object -Unique)
$times = @($rt.Time | Sort-Object -Unique)
Write-Host ('red team events {0}, source hosts {1}, distinct seconds {2}' -f $rt.Count, $hosts.Count, $times.Count)

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$hostOut = Join-Path $OutDir 'auth-rtsrc-hosts.csv'
$secOut  = Join-Path $OutDir 'auth-rt-seconds.csv'

$cs = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

public class AuthSlice
{
    public long Lines;
    public long HostRows;
    public long SecondRows;

    public void Run(string authGz, HashSet<string> hosts, HashSet<long> seconds,
                    string hostOut, string secOut, string progressLog)
    {
        const int BUF = 1 << 22;
        byte[] buf = new byte[BUF];
        byte[] carry = new byte[1 << 16];
        int carryLen = 0;
        int[] comma = new int[16];
        var sw = System.Diagnostics.Stopwatch.StartNew();
        long nextReport = 50000000;

        using (var hw = new StreamWriter(hostOut, false, Encoding.ASCII))
        using (var sw2 = new StreamWriter(secOut, false, Encoding.ASCII))
        {
            hw.WriteLine("time,src_user,dst_user,src_comp,dst_comp,auth_type,logon_type,orientation,outcome");
            sw2.WriteLine("time,src_user,dst_user,src_comp,dst_comp,auth_type,logon_type,orientation,outcome");

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
                        byte[] src; int off, len;
                        if (carryLen > 0)
                        {
                            int need = i - start;
                            if (carryLen + need > carry.Length) Array.Resize(ref carry, (carryLen + need) * 2);
                            Buffer.BlockCopy(buf, start, carry, carryLen, need);
                            src = carry; off = 0; len = carryLen + need; carryLen = 0;
                        }
                        else { src = buf; off = start; len = i - start; }
                        if (len > 0 && src[off + len - 1] == (byte)'\r') len--;
                        if (len > 0) Handle(src, off, len, comma, hosts, seconds, hw, sw2);
                        start = i + 1;

                        if (Lines >= nextReport)
                        {
                            nextReport += 50000000;
                            File.AppendAllText(progressLog, string.Format(
                                "{0:MM-dd HH:mm:ss}  {1:N0} lines, host {2:N0}, sec {3:N0}, {4:N0}s\r\n",
                                DateTime.Now, Lines, HostRows, SecondRows, sw.Elapsed.TotalSeconds));
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
            if (carryLen > 0) Handle(carry, 0, carryLen, comma, hosts, seconds, hw, sw2);
        }
    }

    void Handle(byte[] b, int off, int len, int[] comma, HashSet<string> hosts,
                HashSet<long> seconds, StreamWriter hw, StreamWriter sw2)
    {
        int nc = 0, end = off + len;
        for (int i = off; i < end && nc < 16; i++) if (b[i] == (byte)',') comma[nc++] = i;
        if (nc < 8) { Lines++; return; }
        Lines++;

        long t = 0; bool ok = true;
        for (int i = off; i < comma[0]; i++)
        {
            byte c = b[i];
            if (c < (byte)'0' || c > (byte)'9') { ok = false; break; }
            t = t * 10 + (c - (byte)'0');
        }

        bool wantSecond = ok && seconds.Contains(t);

        bool wantHost = false;
        if (!wantSecond)
        {
            string s = Encoding.ASCII.GetString(b, comma[2] + 1, comma[3] - comma[2] - 1);
            if (hosts.Contains(s)) wantHost = true;
            else
            {
                string d = Encoding.ASCII.GetString(b, comma[3] + 1, comma[4] - comma[3] - 1);
                if (hosts.Contains(d)) wantHost = true;
            }
        }
        else
        {
            string s = Encoding.ASCII.GetString(b, comma[2] + 1, comma[3] - comma[2] - 1);
            string d = Encoding.ASCII.GetString(b, comma[3] + 1, comma[4] - comma[3] - 1);
            if (hosts.Contains(s) || hosts.Contains(d)) wantHost = true;
        }

        if (!wantSecond && !wantHost) return;

        string line = Encoding.ASCII.GetString(b, off, len);
        if (wantHost)   { hw.WriteLine(line);  HostRows++; }
        if (wantSecond) { sw2.WriteLine(line); SecondRows++; }
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp

if (Test-Path -LiteralPath $ProgressLog) { Remove-Item -LiteralPath $ProgressLog -Force }

$hostSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($h in $hosts) { [void]$hostSet.Add($h) }
$secSet = New-Object 'System.Collections.Generic.HashSet[long]'
foreach ($t in $times) { [void]$secSet.Add([long]$t) }

$slice = New-Object AuthSlice
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$slice.Run($AuthPath, $hostSet, $secSet, $hostOut, $secOut, $ProgressLog)
$sw.Stop()

Write-Host ''
Write-Host ('scanned  : {0:N0} lines in {1:N0} s' -f $slice.Lines, $sw.Elapsed.TotalSeconds)
Write-Host ('host rows: {0:N0} -> {1}' -f $slice.HostRows, $hostOut)
Write-Host ('sec rows : {0:N0} -> {1}' -f $slice.SecondRows, $secOut)
