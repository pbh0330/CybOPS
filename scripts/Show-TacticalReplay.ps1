# Time-stepped mission picture replay for a TEMPORAL scenario (ADR-0012).
#
# ASCII only in this file.
#
# Walks the scenario timeline, applies the attack state that is in force at
# each step, and runs the deterministic engine three times per step:
#   total  - everything that is happening
#   attack - only adversary-caused impact (the environment pretended perfect)
#   env    - only mobility/terrain/maintenance/unknown outages (no adversary)
#
# The three columns exist because of the failure this whole scenario is built
# to avoid: a picture that cannot tell a ridge from an adversary reports the
# hill as enemy action. 'inter' is total - attack - env; when it is large,
# neither cause alone would have degraded the mission and the coincidence is
# the story.
#
# Usage:
#   .\scripts\Show-TacticalReplay.ps1
#   .\scripts\Show-TacticalReplay.ps1 -Method noisyor
#   .\scripts\Show-TacticalReplay.ps1 -Step 30
#   .\scripts\Show-TacticalReplay.ps1 -WhatIfIsolate BN-SRV

param(
  [string]$Scenario  = "$PSScriptRoot\..\scenarios\tacnet-01\mission.json",
  [string]$Timeline  = "$PSScriptRoot\..\scenarios\tacnet-01\attack-timeline.json",
  [ValidateSet('max','weighted','noisyor')]
  [string]$Method    = 'weighted',
  [double]$Step      = 0,
  [string]$WhatIfIsolate = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$g = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
if ($null -eq $g.timeline) { throw "scenario has no timeline block: $Scenario" }

$engine = Join-Path $PSScriptRoot 'Invoke-MissionPropagation.ps1'
if (-not (Test-Path $engine)) { throw "engine not found: $engine" }

$tl = $null
if ($Timeline -and (Test-Path $Timeline)) {
  $tl = Get-Content $Timeline -Raw -Encoding utf8 | ConvertFrom-Json
}

if ($Step -le 0) {
  $Step = 15
  if ($g.timeline.step) { $Step = [double]$g.timeline.step }
}
$horizon = [double]$g.timeline.horizon
$t0 = $null
if ($g.timeline.t0_iso) { $t0 = [datetime]$g.timeline.t0_iso }

# Isolating an asset means it stops serving. Containment has a mission cost of
# its own and the operator has to see it before approving the action (ADR-0004).
$isolated = @()
if ($WhatIfIsolate) { $isolated = @($WhatIfIsolate.Split(',') | ForEach-Object { $_.Trim() }) }

function Get-StateAt($tl, $t) {
  $state = @{}
  $label = ''
  if ($null -eq $tl) { return @{ state = $state; label = $label } }
  foreach ($s in $tl.steps) {
    if ([double]$s.t -gt $t) { continue }
    $state = @{}
    foreach ($p in $s.state.PSObject.Properties) { $state[$p.Name] = [double]$p.Value }
    $label = [string]$s.label
  }
  return @{ state = $state; label = $label }
}

function Bar($v, $width) {
  $n = [int][math]::Round($v * $width)
  if ($n -lt 0) { $n = 0 }
  if ($n -gt $width) { $n = $width }
  return ('#' * $n).PadRight($width, '.')
}

Write-Output ""
Write-Output "TACTICAL MISSION PICTURE REPLAY   scenario=$($g.scenario_id)  method=$Method  step=$Step min"
if ($isolated.Count -gt 0) { Write-Output "WHAT-IF: isolating $($isolated -join ', ')" }
Write-Output ("-" * 118)

$missions = @($g.missions | Sort-Object priority)
$header = "{0,5} {1,6}  {2,-18}" -f 't', 'clock', 'attack step'
foreach ($m in $missions) { $header += ("{0,-30}" -f $m.id) }
$header += 'cut (cause)'
Write-Output $header
Write-Output ("{0,5} {1,6}  {2,-18}{3}" -f '', '', '', (($missions | ForEach-Object { "{0,-30}" -f 'total  (att/env/inter)' }) -join ''))
Write-Output ("-" * 118)

for ($t = 0; $t -lt $horizon; $t += $Step) {
  $st = Get-StateAt $tl $t
  $stateMap = $st.state
  foreach ($iso in $isolated) { $stateMap[$iso] = 1.0 }

  $pairs = @()
  foreach ($k in $stateMap.Keys) { $pairs += "$k=$($stateMap[$k])" }
  $stateArg = $pairs -join ','

  $json = & $engine -Scenario $Scenario -State $stateArg -Method $Method -At $t -Json | ConvertFrom-Json

  $clock = ''
  if ($t0) { $clock = $t0.AddMinutes($t).ToString('HH:mm') }
  $line = "{0,5} {1,6}  {2,-18}" -f ("+$t"), $clock, $st.label

  foreach ($m in $missions) {
    if (-not $json.mission_active.($m.id)) {
      $line += ("{0,-30}" -f '(phase inactive)')
      continue
    }
    $v = [double]$json.mission.($m.id)
    $a = [double]$json.mission_attack.($m.id)
    $e = [double]$json.mission_env.($m.id)
    $i = $v - $a - $e
    $line += ("{0} {1,5:P0} ({2,3:P0}/{3,3:P0}/{4,3:P0})  " -f (Bar $v 8), $v, $a, $e, $i)
  }

  $cuts = @()
  foreach ($p in $json.asset_outage.PSObject.Properties) {
    if ($p.Value) { $cuts += "$($p.Name):$($p.Value)" }
  }
  foreach ($p in $json.link_outage.PSObject.Properties) {
    if ($p.Value) { $cuts += "$($p.Name):$($p.Value)" }
  }
  $line += ($cuts -join ' ')

  Write-Output $line
}

Write-Output ("-" * 118)
Write-Output ""
Write-Output "att = adversary only, env = mobility/terrain/unknown only, inter = total - att - env."
Write-Output "inter > 0 means neither cause alone would have caused this degradation."
Write-Output "all four numbers come from the deterministic layer; the LLM explains them,"
Write-Output "it never produces them (ADR-0003)."
Write-Output ""
