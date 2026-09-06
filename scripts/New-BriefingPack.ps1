# Build the evidence pack a briefing must be written from.
#
# ASCII only in this file. Korean phrasing lives in prompts/briefing-labels.ko.json
# and is read with -Encoding utf8 (CLAUDE.md encoding rule 3).
#
# Note the label object is $LBL, not $L: PowerShell variable names are
# case-insensitive, so the link loop variable $l silently overwrote $L and the
# templates came back null. The facts still rendered, just as bare values.
#
# This is still the DETERMINISTIC side (ADR-0003). Every fact here comes from
# the engine's own output; nothing is inferred. Each fact gets a stable id
# (F1, F2, ...) so the model can cite it and the verifier can check the
# citation (ADR-0009). A claim that cannot point at an F-id has no business
# being in the briefing.
#
# Input : ui/public/data/<scenario>.replay.json (from Export-ReplayData.ps1)
# Output: analysis/briefing/<scenario>-t<t>.pack.json
#
# Usage:
#   .\scripts\New-BriefingPack.ps1 -At 300
#   .\scripts\New-BriefingPack.ps1 -At 390 -Out analysis\briefing\end.pack.json

param(
  [string]$Replay = "$PSScriptRoot\..\ui\public\data\tacnet-01.replay.json",
  [double]$At     = 300,
  [string]$Labels = "$PSScriptRoot\..\prompts\briefing-labels.ko.json",
  [string]$Out    = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Replay)) { throw "replay not found: $Replay. Run Export-ReplayData.ps1 first." }
if (-not (Test-Path $Labels)) { throw "labels not found: $Labels" }

$r = Get-Content $Replay -Raw -Encoding utf8 | ConvertFrom-Json
$LBL = Get-Content $Labels -Raw -Encoding utf8 | ConvertFrom-Json
$g = $r.graph

$step = $null
foreach ($s in $r.steps) { if ([double]$s.t -eq $At) { $step = $s; break } }
if ($null -eq $step) {
  $avail = ($r.steps | ForEach-Object { $_.t }) -join ', '
  throw "no step at t=$At. available: $avail"
}

if (-not $Out) {
  $dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'analysis\briefing'
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $Out = Join-Path $dir ("{0}-t{1}.pack.json" -f $r.scenario_id, [int]$At)
}

function Pct($v) { return [math]::Round(([double]$v) * 100, 2) }
function Fmt($template) { return [string]::Format($template, $args) }

$phaseName = @{}
foreach ($p in $g.phases) { $phaseName[$p.id] = $p.name }

$facts = New-Object System.Collections.ArrayList
$script:n = 0
function Add-Fact($kind, $subject, $text, $value) {
  $script:n++
  [void]$script:facts.Add([ordered]@{
    id = "F$script:n"; kind = $kind; subject = $subject; text = $text; value = $value
  })
}

# ---------------------------------------------------------------- facts

$clock = ''
if ($step.time_iso) { $clock = ([datetime]$step.time_iso).ToString('HH:mm') }

$phaseNames = @()
foreach ($phId in @($step.active_phases)) { if ($phaseName.ContainsKey($phId)) { $phaseNames += $phaseName[$phId] } }
if ($phaseNames.Count -gt 0) {
  Add-Fact 'time' $r.scenario_id (Fmt $LBL.time $r.scenario_id $clock ([int]$step.t) ($phaseNames -join ', ')) $step.t
} else {
  Add-Fact 'time' $r.scenario_id (Fmt $LBL.time_no_phase $r.scenario_id $clock ([int]$step.t)) $step.t
}

foreach ($m in ($g.missions | Sort-Object priority)) {
  $active = $true
  if ($null -ne $step.mission_active) { $active = ($step.mission_active.($m.id) -ne $false) }
  if (-not $active) { continue }

  $tot = Pct $step.mission.($m.id)
  Add-Fact 'mission_degradation' $m.id (Fmt $LBL.mission_degradation $m.id $m.name $m.priority $tot) ([double]$step.mission.($m.id))

  if ($null -ne $step.mission_attack) {
    $att = Pct $step.mission_attack.($m.id)
    $env = Pct $step.mission_env.($m.id)
    $int = [math]::Round($tot - $att - $env, 2)
    Add-Fact 'attribution' $m.id (Fmt $LBL.attribution $m.id $att $env $int) $int
  }
}

foreach ($a in $g.assets) {
  $c = $step.asset_outage.($a.id)
  if (-not $c) { continue }
  $note = ''
  foreach ($o in @($a.outages)) { if ($step.t -ge $o.from -and $step.t -lt $o.to) { $note = [string]$o.note } }
  $cn = $LBL.cause_names.$c
  if (-not $cn) { $cn = $c }
  Add-Fact 'outage_asset' $a.id (Fmt $LBL.outage_asset $a.id $cn $note) 1.0
}

foreach ($l in $g.links) {
  $c = $step.link_outage.($l.id)
  if (-not $c) { continue }
  $note = ''
  foreach ($o in @($l.outages)) { if ($step.t -ge $o.from -and $step.t -lt $o.to) { $note = [string]$o.note } }
  $cn = $LBL.cause_names.$c
  if (-not $cn) { $cn = $c }
  Add-Fact 'outage_link' $l.id (Fmt $LBL.outage_link $l.id $l.a $l.b $l.bearer $cn $note) 1.0
}

foreach ($p in $step.compromise.PSObject.Properties) {
  if ([double]$p.Value -le 0) { continue }
  Add-Fact 'compromise' $p.Name (Fmt $LBL.compromise $p.Name (Pct $p.Value)) ([double]$p.Value)
}

foreach ($t in $g.tasks) {
  $v = [double]$step.task.($t.id)
  if ($v -le 0.0005) { continue }
  if ($t.performed_at) {
    Add-Fact 'task_degradation' $t.id (Fmt $LBL.task_degradation $t.id $t.name $t.performed_at (Pct $v)) $v
  } else {
    Add-Fact 'task_degradation' $t.id (Fmt $LBL.task_degradation_nowhere $t.id $t.name (Pct $v)) $v
  }
}

foreach ($s in $g.services) {
  $v = [double]$step.service.($s.id)
  if ($v -le 0.0005) { continue }
  if ($s.redundancy_group) { $red = Fmt $LBL.redundant $s.redundancy_group } else { $red = $LBL.single }
  Add-Fact 'service_degradation' $s.id (Fmt $LBL.service_degradation $s.id $s.name $red (Pct $v)) $v
}

if ($null -ne $step.whatif) {
  foreach ($p in $step.whatif.PSObject.Properties) {
    $deltas = @()
    foreach ($m in $g.missions) {
      $d = [double]$p.Value.delta.($m.id)
      if ([math]::Abs($d) -gt 0.0005) { $deltas += ("{0} {1:+0.0;-0.0;0.0}%p" -f $m.id, ($d * 100)) }
    }
    if ($deltas.Count -eq 0) {
      Add-Fact 'containment_cost' $p.Name (Fmt $LBL.containment_cost_zero $p.Name) 0.0
    } else {
      Add-Fact 'containment_cost' $p.Name (Fmt $LBL.containment_cost $p.Name ($deltas -join ', ')) 1.0
    }
  }
}

# ---------------------------------------------------------------- write

$pack = [ordered]@{
  pack_version = 1
  scenario_id  = $r.scenario_id
  t            = $step.t
  time_iso     = $step.time_iso
  clock        = $clock
  step_label   = $step.label
  method       = $r.method
  source       = (Resolve-Path $Replay).Path
  generated    = (Get-Date).ToString('o')
  facts        = $facts
}

[IO.File]::WriteAllText($Out, ($pack | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

Write-Output ""
Write-Output ("pack : {0}" -f $Out)
Write-Output ("t    : +{0} ({1})  facts: {2}" -f $step.t, $clock, $facts.Count)
Write-Output ""
