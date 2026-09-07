# Synthetic L1 telemetry generator - offline substitute for OpTC / LANL / AIT.
#
# ASCII ONLY IN THIS FILE. Windows PowerShell 5.1 misreads UTF-8 script sources
# without a BOM. An earlier version of this generator held the Korean stage
# labels inline; they were silently corrupted on read and the corruption went
# straight into the generated labels.jsonl before it was caught. All human
# language strings now live in the JSON data files, which are read with an
# explicit -Encoding utf8.
#
# WHY THIS EXISTS
#   The public datasets are large, slow to fetch, and two of them need manual
#   access approval. This generator produces OCSF-shaped events with ground
#   truth so the normalization pipeline, the deterministic engine and the UI can
#   be built and tested with no network at all. It is NOT a substitute for the
#   real datasets in any evaluation claim - see docs/07-synthetic-data.md.
#
# WHAT IT PRODUCES
#   events.jsonl    OCSF-shaped events, one JSON object per line, time ordered
#   labels.jsonl    ground truth: which event ids are malicious, with ATT&CK ids
#   states.jsonl    asset compromise trajectory, feeds Invoke-MissionPropagation
#   summary.json    counts, class balance, time range
#
# Usage:
#   .\scripts\New-SyntheticTelemetry.ps1
#   .\scripts\New-SyntheticTelemetry.ps1 -BenignEvents 20000 -Seed 7

param(
  [string]$Scenario     = "$PSScriptRoot\..\scenarios\defnet-01\mission.json",
  [string]$AttackChain  = "$PSScriptRoot\..\scenarios\defnet-01\attack-chain.json",
  [string]$OutDir       = "$PSScriptRoot\..\scenarios\defnet-01\synthetic",
  [int]   $BenignEvents = 8000,
  [int]   $Seed         = 42,
  [int]   $DurationHours = 8
)

$ErrorActionPreference = 'Stop'

$g  = Get-Content $Scenario    -Raw -Encoding utf8 | ConvertFrom-Json
$ac = Get-Content $AttackChain -Raw -Encoding utf8 | ConvertFrom-Json
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$rand = New-Object System.Random($Seed)

$workstations = @($g.assets | Where-Object { $_.type -eq 'workstation' } | ForEach-Object { $_.id })
$servers      = @($g.assets | Where-Object { $_.type -notin @('workstation','hypervisor','firewall','switch') } | ForEach-Object { $_.id })
$users        = @('kim.ch','park.bh','lee.jw','choi.sy','jung.mk','svc_backup','svc_monitor')

$t0 = [datetime]::ParseExact('2026-09-01 08:00:00','yyyy-MM-dd HH:mm:ss',$null)
$durationSec = $DurationHours * 3600

$eventId = 0
$events  = New-Object System.Collections.ArrayList
$labels  = New-Object System.Collections.ArrayList

# OCSF 1.9.0 (pinned to commit 856d462b in configs/ocsf-mapping.json).
#
# category_uid, activity_id and type_uid are REQUIRED and were missing until
# 2026-09-07. type_uid is not a free field: OCSF defines it as
# class_uid * 100 + activity_id, so it is computed, never typed in.
#
# The authentication subject also moved. It used to sit in actor.user, which is
# optional in the host profile; Authentication (3002) makes `user` required.
# An account-centric query over the old data returned nothing, which is the
# whole point of the class.
$classMap = @{
  'process' = @{ uid = 1007; name = 'Process Activity';     category = 1; activity = 1; activity_name = 'Launch' }
  'auth'    = @{ uid = 3002; name = 'Authentication';        category = 3; activity = 1; activity_name = 'Logon' }
  'network' = @{ uid = 4001; name = 'Network Activity';      category = 4; activity = 6; activity_name = 'Traffic' }
  'file'    = @{ uid = 1001; name = 'File System Activity';  category = 1; activity = 1; activity_name = 'Create' }
}

function New-Event {
  # note: do not name a parameter $host - it is a read-only automatic variable
  param($ts, $class, $hostName, $user, $summary, $extra, $gt)

  $script:eventId++
  $id = 'EV{0:D7}' -f $script:eventId

  $cm  = $script:classMap[$class]
  $usr = [ordered]@{ name = $user; type_id = 1 }

  $e = [ordered]@{
    event_uid     = $id
    time          = [int64]([datetimeoffset]$ts).ToUnixTimeMilliseconds()
    time_iso      = $ts.ToString('yyyy-MM-ddTHH:mm:ss')
    category_uid  = $cm.category
    class_uid     = $cm.uid
    class_name    = $cm.name
    activity_id   = $cm.activity
    activity_name = $cm.activity_name
    type_uid      = $cm.uid * 100 + $cm.activity
    severity_id   = 1
    status_id     = 1
    device        = [ordered]@{ hostname = $hostName; uid = $hostName; type_id = 0 }
    actor         = [ordered]@{ user = $usr }
    message       = $summary
    metadata      = [ordered]@{
      version     = '1.9.0'
      product     = [ordered]@{ name = 'mc-cycop-synth'; vendor_name = 'mc-cycop' }
      logged_time = [int64]([datetimeoffset]$ts).ToUnixTimeMilliseconds()
    }
    unmapped      = $extra
  }

  # Authentication requires `user` at the top level and at least one of
  # service / dst_endpoint. Both were missing; an account-centric query over
  # this data used to come back empty.
  if ($class -eq 'auth') {
    $e['user'] = $usr
    $e['dst_endpoint'] = [ordered]@{ hostname = $hostName; uid = $hostName }
    $e['auth_protocol_id'] = 0
  }

  [void]$script:events.Add($e)

  if ($gt) {
    [void]$script:labels.Add([ordered]@{
      event_uid = $id
      malicious = $true
      technique = $gt.technique
      tactic    = $gt.tactic
      stage     = $gt.stage
      campaign  = $script:ac.campaign_id
    })
  }
  return $id
}

# ---------------------------------------------------------------- benign baseline

$benignProcs = @('explorer.exe','outlook.exe','chrome.exe','excel.exe','svchost.exe','teams.exe','hwp.exe')
$comms = @($g.edges.communicates_with)

for ($i = 0; $i -lt $BenignEvents; $i++) {
  $ts = $t0.AddSeconds($rand.Next(0, $durationSec))
  $roll = $rand.NextDouble()

  if ($roll -lt 0.45) {
    New-Event $ts 'process' $workstations[$rand.Next(0,$workstations.Count)] $users[$rand.Next(0,$users.Count)] `
      "process started" ([ordered]@{
        process_name = $benignProcs[$rand.Next(0,$benignProcs.Count)]
        pid = $rand.Next(1000,9000); integrity = 'medium'
      }) $null | Out-Null
  }
  elseif ($roll -lt 0.75) {
    $c = $comms[$rand.Next(0,$comms.Count)]
    New-Event $ts 'network' $c.a $users[$rand.Next(0,$users.Count)] `
      "flow $($c.a) -> $($c.b)" ([ordered]@{
        dst_host = $c.b; dst_port = @(445,389,443,25,1433)[$rand.Next(0,5)]
        bytes_out = $rand.Next(200, 40000); bytes_in = $rand.Next(200, 90000)
      }) $null | Out-Null
  }
  elseif ($roll -lt 0.92) {
    New-Event $ts 'auth' $servers[$rand.Next(0,$servers.Count)] $users[$rand.Next(0,$users.Count)] `
      "logon success" ([ordered]@{
        logon_type = @('interactive','network','service')[$rand.Next(0,3)]
        src_host = $workstations[$rand.Next(0,$workstations.Count)]; result = 'success'
      }) $null | Out-Null
  }
  else {
    New-Event $ts 'file' $workstations[$rand.Next(0,$workstations.Count)] $users[$rand.Next(0,$users.Count)] `
      "file accessed" ([ordered]@{
        path = "D:\share\doc_$($rand.Next(1,400)).hwp"; action = 'read'
      }) $null | Out-Null
  }
}

# ---------------------------------------------------------------- attack chain
# Multi-stage intrusion, ground truth at every step. Definition lives in
# attack-chain.json so the Korean stage labels survive.

$attackStart = $t0.AddSeconds([int]($durationSec * 0.35))

foreach ($step in $ac.chain) {
  $ts = $attackStart.AddSeconds([int]$step.off)
  $extra = [ordered]@{}
  foreach ($p in $step.extra.PSObject.Properties) { $extra[$p.Name] = $p.Value }
  New-Event $ts $step.class $step.host $step.user $step.msg $extra $step.gt | Out-Null
}

# ---------------------------------------------------------------- state trajectory
# What the deterministic engine would conclude at each stage; input to
# Invoke-MissionPropagation.ps1 (ADR-0003: no LLM produces these values).

$stateLines = New-Object System.Collections.ArrayList
foreach ($s in $ac.states) {
  $ts = $attackStart.AddSeconds([int]$s.off)
  $stateMap = [ordered]@{}
  foreach ($p in $s.state.PSObject.Properties) { $stateMap[$p.Name] = $p.Value }
  [void]$stateLines.Add([ordered]@{
    time_iso = $ts.ToString('yyyy-MM-ddTHH:mm:ss')
    label    = $s.label
    state    = $stateMap
  })
}

# ---------------------------------------------------------------- write
# Sort-Object -Property time does NOT work on [ordered] hashtables: it looks for
# a real property named 'time' and silently leaves the order alone. Use a script
# block so the dictionary key is read instead.

$sorted = @($events | Sort-Object -Property { $_['time'] })

function Write-Jsonl($path, $rows, $depth) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  $sw = New-Object System.IO.StreamWriter($path, $false, $enc)
  foreach ($r in $rows) { $sw.WriteLine(($r | ConvertTo-Json -Depth $depth -Compress)) }
  $sw.Close()
}

$evPath = Join-Path $OutDir 'events.jsonl'
$lbPath = Join-Path $OutDir 'labels.jsonl'
$stPath = Join-Path $OutDir 'states.jsonl'
$smPath = Join-Path $OutDir 'summary.json'

Write-Jsonl $evPath $sorted     6
Write-Jsonl $lbPath $labels     4
Write-Jsonl $stPath $stateLines 4

$total = $sorted.Count
$mal   = $labels.Count
$summary = [ordered]@{
  scenario         = $g.scenario_id
  campaign         = $ac.campaign_id
  generated_at     = (Get-Date).ToString('s')
  seed             = $Seed
  total_events     = $total
  malicious_events = $mal
  malicious_pct    = [math]::Round(100.0 * $mal / $total, 4)
  time_start       = $sorted[0].time_iso
  time_end         = $sorted[$total-1].time_iso
  techniques       = @($labels | ForEach-Object { $_.technique } | Sort-Object -Unique)
  files            = @('events.jsonl','labels.jsonl','states.jsonl')
  warning          = 'Synthetic data. Do not use for any published detection performance claim. See docs/07-synthetic-data.md'
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -Path $smPath -Encoding utf8

Write-Output ""
Write-Output "generated -> $OutDir"
Write-Output ("  events.jsonl   {0,7} events" -f $total)
Write-Output ("  labels.jsonl   {0,7} malicious  ({1}%)" -f $mal, $summary.malicious_pct)
Write-Output ("  states.jsonl   {0,7} state snapshots" -f $stateLines.Count)
Write-Output ("  techniques     {0}" -f ($summary.techniques -join ', '))
Write-Output ("  time range     {0} .. {1}" -f $summary.time_start, $summary.time_end)
Write-Output ""
