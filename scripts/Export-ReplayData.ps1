# Export a precomputed replay for the situation-display UI.
#
# ASCII only in this file.
#
# The UI does NOT reimplement the propagation engine. It reads what the
# deterministic layer already produced. Two implementations of the same rules
# drift, and the moment they drift the screen stops being evidence for
# anything (ADR-0003). So the engine runs here, once per time step, and the UI
# is a viewer.
#
# Output: one JSON file holding the graph, the timeline, and every step's
# full engine output (asset/service/task/mission + attack/env attribution +
# outage causes). Static, self-contained, no server (ADR-0018).
#
# Usage:
#   .\scripts\Export-ReplayData.ps1
#   .\scripts\Export-ReplayData.ps1 -Scenario scenarios\defnet-01\mission.json -Out ui\public\data\defnet-01.replay.json
#   .\scripts\Export-ReplayData.ps1 -Step 5

param(
  [string]$Scenario = "$PSScriptRoot\..\scenarios\tacnet-01\mission.json",
  [string]$Timeline = "$PSScriptRoot\..\scenarios\tacnet-01\attack-timeline.json",
  [string]$Out      = '',
  [ValidateSet('max','weighted','noisyor')]
  [string]$Method   = 'weighted',
  [double]$Step     = 0
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$g = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
$engine = Join-Path $PSScriptRoot 'Invoke-MissionPropagation.ps1'
if (-not (Test-Path $engine)) { throw "engine not found: $engine" }

$temporal = ($null -ne $g.timeline)

if (-not $Out) {
  $dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'ui\public\data'
  $Out = Join-Path $dir ("{0}.replay.json" -f $g.scenario_id)
}
$outDir = Split-Path $Out -Parent
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

$tl = $null
if ($Timeline -and (Test-Path $Timeline)) {
  $tl = Get-Content $Timeline -Raw -Encoding utf8 | ConvertFrom-Json
}

function Get-StateAt($tl, $t) {
  $state = @{}; $label = ''; $note = ''
  if ($null -eq $tl) { return @{ state = $state; label = $label; note = $note } }
  foreach ($s in $tl.steps) {
    if ([double]$s.t -gt $t) { continue }
    $state = @{}
    foreach ($p in $s.state.PSObject.Properties) { $state[$p.Name] = [double]$p.Value }
    $label = [string]$s.label
    $note  = [string]$s.note
  }
  return @{ state = $state; label = $label; note = $note }
}

# time grid
$times = @()
if ($temporal) {
  if ($Step -le 0) {
    $Step = 15
    if ($g.timeline.step) { $Step = [double]$g.timeline.step }
  }
  $horizon = [double]$g.timeline.horizon
  for ($t = 0; $t -lt $horizon; $t += $Step) { $times += $t }
} else {
  $times = @(-1)   # single snapshot
}

$steps = @()
foreach ($t in $times) {
  $st = Get-StateAt $tl $t
  $pairs = @()
  foreach ($k in $st.state.Keys) { $pairs += "$k=$($st.state[$k])" }
  $stateArg = $pairs -join ','

  if ($temporal) {
    $json = & $engine -Scenario $Scenario -State $stateArg -Method $Method -At $t -Json | ConvertFrom-Json
  } else {
    $json = & $engine -Scenario $Scenario -State $stateArg -Method $Method -Json | ConvertFrom-Json
  }

  $iso = $null
  if ($temporal -and $g.timeline.t0_iso) {
    $iso = ([datetime]$g.timeline.t0_iso).AddMinutes($t).ToString('o')
  }

  $row = [ordered]@{
    t          = $t
    time_iso   = $iso
    label      = $st.label
    note       = $st.note
    compromise = $st.state
    asset      = $json.asset
    service    = $json.service
    task       = $json.task
    mission    = $json.mission
  }
  if ($temporal) {
    $row.mission_active = $json.mission_active
    $row.mission_attack = $json.mission_attack
    $row.mission_env    = $json.mission_env
    $row.active_phases  = $json.active_phases
    $row.asset_outage   = $json.asset_outage
    $row.link_outage    = $json.link_outage
  }
  $steps += [pscustomobject]$row
  Write-Output ("  t=+{0,-5} {1}" -f $t, $st.label)
}

$payload = [ordered]@{
  generated   = (Get-Date).ToString('o')
  generator   = 'scripts/Export-ReplayData.ps1'
  contract    = 1
  note        = 'Precomputed by the deterministic engine. The UI displays these numbers and never recomputes them (ADR-0003).'
  scenario_id = $g.scenario_id
  method      = $Method
  step        = $(if ($temporal) { $Step } else { $null })
  graph       = $g
  attack      = $tl
  steps       = $steps
}

$json = $payload | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding($false)))

$size = (Get-Item $Out).Length
Write-Output ""
Write-Output ("wrote {0} ({1:N0} bytes, {2} steps)" -f $Out, $size, $steps.Count)

# The SIDC map is an input to the UI, not a product of it. Copy it next to the
# replay so the bundle stays self-contained; if it is absent the UI falls back
# to plain shapes and says so in the console.
$symSrc = Join-Path (Split-Path $PSScriptRoot -Parent) 'configs\symbology-2525.json'
if (Test-Path $symSrc) {
  $symDst = Join-Path (Split-Path $Out -Parent) 'symbology-2525.json'
  Copy-Item $symSrc $symDst -Force
  Write-Output ("copied {0}" -f $symDst)
} else {
  Write-Output "note: configs\symbology-2525.json 없음 - UI 는 심볼 없이 도형으로 그린다"
}
Write-Output ""
