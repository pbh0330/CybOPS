# E1-b step 1: turn 101 operator actions into (host, window) labels.
#
# ASCII ONLY IN THIS FILE.
#
# WHY THE LABELS CANNOT STAY AS THEY ARE
#
# analysis/optc/redteam-labels.json says it plainly: "Labels describe red team
# operator actions at second resolution, not individual telemetry events." There
# is no event id in them. So the unit that has a ground truth is not the eCAR
# record - it is the host and the moment (docs/19-e1b-design.md section 2).
#
# CLOCK
#
# Ground truth times are the eCAR LOCAL clock (-04:00). That was measured, not
# assumed: scripts/Test-OptcTimeAlign.ps1 finds runme.bat created at
# 2019-09-23T11:23:43.956-04:00 against a ground truth line of 11:23:29 - a
# fifteen second gap. A four hour error here would have produced perfectly
# plausible PR-AUC numbers describing nothing.
#
# DC1
#
# DC1 has no eCAR (docs/09-optc-acquisition.md). Its labels are dropped HERE, in
# code, and counted in the output - not removed by hand from a table later. The
# plan's risk register requires exactly this: sections with no endpoint
# telemetry are excluded from evaluation and the exclusion is reported.
#
# Usage:
#   .\scripts\New-OptcWindowLabels.ps1
#   .\scripts\New-OptcWindowLabels.ps1 -WindowSec 60,300,900

param(
  [string] $Events    = "$PSScriptRoot\..\analysis\optc\redteam-events.jsonl",
  [string] $HostIndex = "$PSScriptRoot\..\analysis\optc\host-index.json",
  [string] $OutJson   = "$PSScriptRoot\..\analysis\optc\window-labels.json",
  [int[]]  $WindowSec = @(60, 300, 900),
  [int]    $UtcOffsetHours = -4
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Events))    { throw "events not found: $Events" }
if (-not (Test-Path $HostIndex)) { throw "host index not found: $HostIndex - run Measure-OptcHosts.ps1" }

# hosts that actually have endpoint telemetry
$idx = Get-Content $HostIndex -Raw -Encoding utf8 | ConvertFrom-Json
$observed = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($h in $idx.host_totals) { [void]$observed.Add((([string]$h.host).Split('.')[0]).ToLower()) }

$rows = New-Object System.Collections.ArrayList
foreach ($line in [IO.File]::ReadLines((Resolve-Path $Events))) {
  if (-not $line.Trim()) { continue }
  [void]$rows.Add(($line | ConvertFrom-Json))
}

Write-Output ''
Write-Output 'OpTC window labels'
Write-Output ('-' * 74)
Write-Output ("  ground truth actions : {0}" -f $rows.Count)
Write-Output ("  hosts with eCAR      : {0}" -f $observed.Count)
Write-Output ("  clock                : ground truth = eCAR local ({0:+0;-0}:00), measured by Test-OptcTimeAlign.ps1" -f $UtcOffsetHours)
Write-Output ''

# ---------------------------------------------------------------- expand
#
# An action can name several hosts ("pivoted from A to B"). Each named host that
# has telemetry gets the label: the action happened on it. Hosts without
# telemetry are dropped and counted.

$expanded = New-Object System.Collections.ArrayList
$droppedHosts = @{}
$noHostRows = 0

foreach ($r in $rows) {
  $hs = @()
  if ($r.hosts)        { $hs += @($r.hosts) }
  if ($r.primary_host) { $hs += @($r.primary_host) }
  $hs = @($hs | Where-Object { $_ } | ForEach-Object { ([string]$_).Split('.')[0] } | Sort-Object -Unique)
  if ($hs.Count -eq 0) { $noHostRows++; continue }

  # "09/23/19" + "11:23:29" in the eCAR local clock
  $dt = [datetime]::ParseExact(([string]$r.date + ' ' + [string]$r.time), 'MM/dd/yy HH:mm:ss', $null)
  $epoch = [int64]([datetimeoffset]::new($dt, [timespan]::FromHours($UtcOffsetHours))).ToUnixTimeSeconds()

  foreach ($h in $hs) {
    if (-not $observed.Contains($h.ToLower())) {
      $droppedHosts[$h] = [int]$droppedHosts[$h] + 1
      continue
    }
    [void]$expanded.Add([ordered]@{
      host  = $h
      epoch = $epoch
      date  = [string]$r.date
      time  = [string]$r.time
      tags  = @($r.action_tags)
      text  = [string]$r.text
    })
  }
}

Write-Output ("  (action, host) pairs kept    : {0}" -f $expanded.Count)
Write-Output ("  rows with no host named      : {0}" -f $noHostRows)
if ($droppedHosts.Count -gt 0) {
  Write-Output '  DROPPED - no endpoint telemetry:'
  foreach ($k in ($droppedHosts.Keys | Sort-Object)) {
    Write-Output ("    {0,-16} {1} action(s)" -f $k, $droppedHosts[$k])
  }
  Write-Output '    These are excluded from E1-b evaluation. Recall over them would be a'
  Write-Output '    property of the data, not of a detector (docs/19 section 3).'
}
Write-Output ''

# ---------------------------------------------------------------- windows

$byWindow = [ordered]@{}
foreach ($w in $WindowSec) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($e in $expanded) {
    $b = [math]::Floor([double]$e.epoch / $w)
    [void]$set.Add(("{0}|{1}" -f $e.host, $b))
  }
  $byWindow["$w"] = @($set)
  $hosts = @($expanded | ForEach-Object { $_.host } | Sort-Object -Unique).Count
  Write-Output ("  window {0,4} s : {1,4} positive (host, window) cells across {2} hosts" -f $w, $set.Count, $hosts)
}
Write-Output ''

$report = [ordered]@{
  generated       = (Get-Date).ToString('o')
  generator       = 'scripts/New-OptcWindowLabels.ps1'
  experiment      = 'E1-b'
  design          = 'docs/19-e1b-design.md'
  source_events   = (Resolve-Path $Events).Path
  actions_total   = $rows.Count
  pairs_kept      = $expanded.Count
  rows_no_host    = $noHostRows
  dropped_hosts   = $droppedHosts
  dropped_reason  = 'no eCAR telemetry for this host; excluded from evaluation and reported (docs/19 section 3)'
  utc_offset_hours = $UtcOffsetHours
  clock_evidence  = 'scripts/Test-OptcTimeAlign.ps1: runme.bat CREATE at 2019-09-23T11:23:43.956-04:00 vs ground truth 09/23/19 11:23:29, gap 15 s'
  window_seconds  = $WindowSec
  positive_cells  = $byWindow
  cells_note      = 'key format host|floor(epoch/window)'
  actions         = @($expanded)
}
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
