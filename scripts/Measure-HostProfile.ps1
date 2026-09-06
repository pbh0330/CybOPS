# Measure-HostProfile.ps1
# One pass over auth.txt.gz building a behavioural profile per computer.
#
# Why: docs/04-evaluation.md concludes that host identity must not be a raw
# feature - the 4 red team source hosts give recall 100% for free, so a model
# fed host ids learns nothing but those ids. The recommended replacement is
# behavioural features. This produces them for all 17,684 computers:
#
#   as_src / as_dst        how much the host initiates vs receives
#   distinct_users         credential breadth seen at the host
#   distinct_peers         how many other machines it talks to (fan-out)
#   fail_rate              share of failed authentications
#   first / last / span    when it was active
#   active_days            how many distinct days it appears on
#
# These are also the raw material for attaching real assets to a mission graph:
# fan-out and credential breadth are what distinguish a domain controller from
# a workstation without anyone hand-labelling roles.
#
# Memory: user and computer names are interned to ints, so per-host sets hold
# ints rather than strings. Peak stays well under 1 GB.
#
# ASCII only: Windows PowerShell 5.1 misreads BOM-less UTF-8 script files.
#
# Usage:
#   .\scripts\Measure-HostProfile.ps1 -Out analysis\lanl\host-profile.csv

[CmdletBinding()]
param(
    [string] $AuthPath    = 'F:\mc-cycop-data\raw\lanl-cyber1\auth.txt.gz',
    [string] $Out         = 'analysis\lanl\host-profile.csv',
    [string] $ProgressLog = 'F:\mc-cycop-data\raw\lanl-cyber1\_hostprofile.log'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $AuthPath)) { throw ('Not found: ' + $AuthPath) }

$cs = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

public class HostProfile
{
    public long Lines;

    class H
    {
        public long AsSrc, AsDst, Fail, Success;
        public long First = long.MaxValue, Last = long.MinValue;
        public HashSet<int> Users = new HashSet<int>();
        public HashSet<int> Peers = new HashSet<int>();
        public HashSet<int> Days  = new HashSet<int>();
    }

    Dictionary<string, int> compId = new Dictionary<string, int>();
    Dictionary<string, int> userId = new Dictionary<string, int>();
    List<string> compName = new List<string>();
    List<H> hosts = new List<H>();

    int Comp(string s)
    {
        int id;
        if (compId.TryGetValue(s, out id)) return id;
        id = compName.Count;
        compId[s] = id; compName.Add(s); hosts.Add(new H());
        return id;
    }
    int User(string s)
    {
        int id;
        if (userId.TryGetValue(s, out id)) return id;
        id = userId.Count; userId[s] = id;
        return id;
    }

    public void Run(string authGz, string outCsv, string progressLog)
    {
        const int BUF = 1 << 22;
        byte[] buf = new byte[BUF];
        byte[] carry = new byte[1 << 16];
        int carryLen = 0;
        int[] comma = new int[16];
        var sw = System.Diagnostics.Stopwatch.StartNew();
        long nextReport = 100000000;

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
                    if (len > 0) Handle(src, off, len, comma);
                    start = i + 1;

                    if (Lines >= nextReport)
                    {
                        nextReport += 100000000;
                        File.AppendAllText(progressLog, string.Format(
                            "{0:MM-dd HH:mm:ss}  {1:N0} lines, {2:N0} hosts, {3:N0} users, {4:N0}s\r\n",
                            DateTime.Now, Lines, compName.Count, userId.Count, sw.Elapsed.TotalSeconds));
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
        if (carryLen > 0) Handle(carry, 0, carryLen, comma);

        using (var w = new StreamWriter(outCsv, false, Encoding.ASCII))
        {
            w.WriteLine("computer,as_src,as_dst,total,distinct_users,distinct_peers,active_days,fail,success,fail_rate,first_t,last_t,span_days");
            for (int i = 0; i < compName.Count; i++)
            {
                H h = hosts[i];
                long tot = h.AsSrc + h.AsDst;
                double fr = (h.Fail + h.Success) > 0 ? (double)h.Fail / (h.Fail + h.Success) : 0.0;
                double span = (h.Last >= h.First) ? (h.Last - h.First) / 86400.0 : 0.0;
                w.WriteLine(string.Format(
                    "{0},{1},{2},{3},{4},{5},{6},{7},{8},{9:F6},{10},{11},{12:F3}",
                    compName[i], h.AsSrc, h.AsDst, tot, h.Users.Count, h.Peers.Count,
                    h.Days.Count, h.Fail, h.Success, fr,
                    h.First == long.MaxValue ? 0 : h.First,
                    h.Last  == long.MinValue ? 0 : h.Last, span));
            }
        }
    }

    void Handle(byte[] b, int off, int len, int[] comma)
    {
        int nc = 0, end = off + len;
        for (int i = off; i < end && nc < 16; i++) if (b[i] == (byte)',') comma[nc++] = i;
        if (nc < 8) { Lines++; return; }
        Lines++;

        long t = 0;
        for (int i = off; i < comma[0]; i++)
        {
            byte c = b[i];
            if (c < (byte)'0' || c > (byte)'9') { t = -1; break; }
            t = t * 10 + (c - (byte)'0');
        }
        if (t < 0) return;
        int day = (int)(t / 86400);

        string u = Encoding.ASCII.GetString(b, comma[0] + 1, comma[1] - comma[0] - 1);
        string s = Encoding.ASCII.GetString(b, comma[2] + 1, comma[3] - comma[2] - 1);
        string d = Encoding.ASCII.GetString(b, comma[3] + 1, comma[4] - comma[3] - 1);

        int uid = User(u);
        int sid = Comp(s);
        int did = Comp(d);

        // outcome is the last field; Success or Fail
        bool fail = false;
        int oOff = comma[nc - 1] + 1;
        if (oOff < end && (b[oOff] == (byte)'F' || b[oOff] == (byte)'f')) fail = true;

        H hs = hosts[sid];
        hs.AsSrc++; hs.Users.Add(uid); hs.Peers.Add(did); hs.Days.Add(day);
        if (t < hs.First) hs.First = t; if (t > hs.Last) hs.Last = t;
        if (fail) hs.Fail++; else hs.Success++;

        if (did != sid)
        {
            H hd = hosts[did];
            hd.AsDst++; hd.Users.Add(uid); hd.Peers.Add(sid); hd.Days.Add(day);
            if (t < hd.First) hd.First = t; if (t > hd.Last) hd.Last = t;
            if (fail) hd.Fail++; else hd.Success++;
        }
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp

$dir = Split-Path $Out -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
if (Test-Path -LiteralPath $ProgressLog) { Remove-Item -LiteralPath $ProgressLog -Force }

$hp = New-Object HostProfile
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$hp.Run($AuthPath, $Out, $ProgressLog)
$sw.Stop()

Write-Host ('scanned {0:N0} lines in {1:N0} s' -f $hp.Lines, $sw.Elapsed.TotalSeconds)
Write-Host ('wrote ' + $Out)
