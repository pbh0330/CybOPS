# Measure-RedteamGroundTruth.ps1
# Characterize the LANL cyber1 red team ground truth.
#
# redteam.txt.gz is the only labelled file in the dataset. Everything an
# evaluation can claim about detection rests on these rows, so their shape -
# how many, how concentrated, which hosts, over what window - decides what
# experiments are even possible. Run this before writing an evaluation plan.
#
# Format: time,user@domain,source computer,destination computer
# A row means "this authentication was part of the red team campaign".
#
# ASCII only: Windows PowerShell 5.1 misreads BOM-less UTF-8 script files.
#
# Usage:
#   .\scripts\Measure-RedteamGroundTruth.ps1
#   .\scripts\Measure-RedteamGroundTruth.ps1 -OutJson data\redteam-profile.json

[CmdletBinding()]
param(
    [string] $Path = 'F:\mc-cycop-data\raw\lanl-cyber1\redteam.txt.gz',
    [string] $OutJson = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) { throw ('Not found: ' + $Path) }

# Small file - read it all.
$fs = [System.IO.File]::OpenRead($Path)
$gz = New-Object System.IO.Compression.GzipStream($fs, [System.IO.Compression.CompressionMode]::Decompress)
$sr = New-Object System.IO.StreamReader($gz)
$raw = $sr.ReadToEnd()
$sr.Close(); $fs.Close()

$rows = @()
foreach ($line in ($raw -split "`n")) {
    $l = $line.Trim()
    if ($l -eq '') { continue }
    $p = $l -split ','
    if ($p.Count -lt 4) { continue }
    $rows += [PSCustomObject]@{
        Time = [long]$p[0]
        User = $p[1]
        Src  = $p[2]
        Dst  = $p[3]
        Day  = [math]::Floor([long]$p[0] / 86400)
    }
}

$n = $rows.Count
$first = ($rows | Measure-Object Time -Minimum).Minimum
$last  = ($rows | Measure-Object Time -Maximum).Maximum

$users = $rows | Group-Object User    | Sort-Object Count -Descending
$srcs  = $rows | Group-Object Src     | Sort-Object Count -Descending
$dsts  = $rows | Group-Object Dst     | Sort-Object Count -Descending
$days  = $rows | Group-Object Day     | Sort-Object { [int]$_.Name }

$hosts = @{}
foreach ($r in $rows) { $hosts[$r.Src] = $true; $hosts[$r.Dst] = $true }

Write-Host ''
Write-Host '=== LANL cyber1 red team ground truth ==='
Write-Host ('  events            : {0:N0}' -f $n)
Write-Host ('  window            : t={0:N0} .. {1:N0}  (day {2:N2} .. {3:N2})' -f `
            $first, $last, ($first/86400), ($last/86400))
Write-Host ('  distinct users    : {0:N0}' -f $users.Count)
Write-Host ('  distinct sources  : {0:N0}' -f $srcs.Count)
Write-Host ('  distinct targets  : {0:N0}' -f $dsts.Count)
Write-Host ('  distinct hosts    : {0:N0}' -f $hosts.Count)
Write-Host ('  active days       : {0} of 58' -f $days.Count)

# Event counts from the LANL cyber1 documentation.
#
# The denominator matters. A red team row IS an authentication event, so the
# honest imbalance figure is against auth.txt, not against every file in the
# dataset. Quoting the all-files number understates the rate by ~1.6x and
# describes a population the labels do not cover.
$authEvents  = 1051430459
$totalEvents = 1648275307   # auth + proc + flows + dns + redteam

Write-Host ''
Write-Host ('  share of auth events : {0:E3} %  (1 in {1:N0})' -f `
            ($n / $authEvents * 100), ($authEvents / $n))
Write-Host ('  share of all events  : {0:E3} %  (1 in {1:N0})   <- do not quote this as the detection rate' -f `
            ($n / $totalEvents * 100), ($totalEvents / $n))

Write-Host ''
Write-Host '--- events per active day ---'
foreach ($d in $days) {
    $bar = '#' * [math]::Min(60, [int]$d.Count)
    Write-Host ('  day {0,2}  {1,4}  {2}' -f $d.Name, $d.Count, $bar)
}

Write-Host ''
Write-Host '--- top 10 compromised accounts ---'
$users | Select-Object -First 10 | ForEach-Object {
    Write-Host ('  {0,5}  {1}' -f $_.Count, $_.Name)
}

Write-Host ''
Write-Host '--- top 10 source hosts (attacker footholds) ---'
$srcs | Select-Object -First 10 | ForEach-Object {
    Write-Host ('  {0,5}  {1}' -f $_.Count, $_.Name)
}

Write-Host ''
Write-Host '--- top 10 target hosts ---'
$dsts | Select-Object -First 10 | ForEach-Object {
    Write-Host ('  {0,5}  {1}' -f $_.Count, $_.Name)
}

# A host that is both a target and later a source is a foothold the campaign
# pivoted through - the lateral movement chain the mission graph must model.
$pivots = @()
foreach ($h in $hosts.Keys) {
    $asDst = @($rows | Where-Object { $_.Dst -eq $h })
    $asSrc = @($rows | Where-Object { $_.Src -eq $h })
    if ($asDst.Count -gt 0 -and $asSrc.Count -gt 0) {
        $firstIn  = ($asDst | Measure-Object Time -Minimum).Minimum
        $firstOut = ($asSrc | Measure-Object Time -Minimum).Minimum
        $pivots += [PSCustomObject]@{
            Host      = $h
            FirstIn   = $firstIn
            FirstOut  = $firstOut
            DwellSecs = $firstOut - $firstIn
            InCount   = $asDst.Count
            OutCount  = $asSrc.Count
        }
    }
}
$pivots = $pivots | Sort-Object FirstIn

Write-Host ''
Write-Host ('--- pivot hosts (compromised, then used to attack): {0} ---' -f $pivots.Count)
Write-Host '  host        first_in    first_out   dwell        in   out'
foreach ($p in ($pivots | Select-Object -First 15)) {
    $dw = if ($p.DwellSecs -ge 0) { '{0,8:N0}s' -f $p.DwellSecs } else { '  (out first)' }
    Write-Host ('  {0,-10} {1,10:N0} {2,11:N0}  {3} {4,5} {5,5}' -f `
                $p.Host, $p.FirstIn, $p.FirstOut, $dw, $p.InCount, $p.OutCount)
}

if ($OutJson -ne '') {
    $profile = [ordered]@{
        source            = $Path
        events            = $n
        first_time        = $first
        last_time         = $last
        first_day         = [math]::Round($first/86400, 3)
        last_day          = [math]::Round($last/86400, 3)
        active_days       = $days.Count
        distinct_users    = $users.Count
        distinct_sources  = $srcs.Count
        distinct_targets  = $dsts.Count
        distinct_hosts    = $hosts.Count
        auth_events_ref   = $authEvents
        total_events_ref  = $totalEvents
        malicious_share_of_auth_pct = [double]('{0:G6}' -f ($n / $authEvents * 100))
        one_in_auth       = [long]($authEvents / $n)
        malicious_share_of_all_pct  = [double]('{0:G6}' -f ($n / $totalEvents * 100))
        one_in_all        = [long]($totalEvents / $n)
        per_day           = @($days | ForEach-Object { [ordered]@{ day = [int]$_.Name; events = $_.Count } })
        top_users         = @($users | Select-Object -First 20 | ForEach-Object { [ordered]@{ user = $_.Name; events = $_.Count } })
        top_sources       = @($srcs  | Select-Object -First 20 | ForEach-Object { [ordered]@{ host = $_.Name; events = $_.Count } })
        top_targets       = @($dsts  | Select-Object -First 20 | ForEach-Object { [ordered]@{ host = $_.Name; events = $_.Count } })
        pivot_hosts       = @($pivots | ForEach-Object {
                                [ordered]@{ host = $_.Host; first_in = $_.FirstIn; first_out = $_.FirstOut
                                            dwell_secs = $_.DwellSecs; in_count = $_.InCount; out_count = $_.OutCount } })
    }
    $dir = Split-Path $OutJson -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $profile | ConvertTo-Json -Depth 6 | Set-Content -Path $OutJson -Encoding UTF8
    Write-Host ''
    Write-Host ('  wrote ' + $OutJson)
}
