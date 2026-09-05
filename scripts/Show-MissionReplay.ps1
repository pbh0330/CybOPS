# Time-stepped mission picture replay.
#
# ASCII only in this file.
#
# Reads the attack state trajectory produced by New-SyntheticTelemetry.ps1 and
# runs the deterministic propagation engine at each step, so you can watch the
# mission picture degrade as the intrusion progresses. This is the terminal
# stand-in for the situation display until the UI exists.
#
# Usage:
#   .\scripts\Show-MissionReplay.ps1
#   .\scripts\Show-MissionReplay.ps1 -Method noisyor
#   .\scripts\Show-MissionReplay.ps1 -WhatIfIsolate DC01

param(
  [string]$Scenario  = "$PSScriptRoot\..\scenarios\defnet-01\mission.json",
  [string]$StatesFile= "$PSScriptRoot\..\scenarios\defnet-01\synthetic\states.jsonl",
  [ValidateSet('max','weighted','noisyor')]
  [string]$Method    = 'weighted',
  [string]$WhatIfIsolate = ''
)

$ErrorActionPreference = 'Stop'

# The scenario labels are Korean. Without this the console renders them as
# mojibake on a cp949 host.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$g = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
$engine = Join-Path $PSScriptRoot 'Invoke-MissionPropagation.ps1'
if (-not (Test-Path $engine)) { throw "engine not found: $engine" }
if (-not (Test-Path $StatesFile)) { throw "states file not found. Run New-SyntheticTelemetry.ps1 first." }

$steps = @(Get-Content $StatesFile -Encoding utf8 | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })

# Isolating an asset means it stops serving. In this model that is the same as
# full unavailability - which is exactly why the what-if matters: containment
# has a mission cost of its own, and the operator has to see it before approving
# the action (ADR-0004).
$isolated = @()
if ($WhatIfIsolate) { $isolated = @($WhatIfIsolate.Split(',') | ForEach-Object { $_.Trim() }) }

function Bar($v, $width = 30) {
  $n = [int][math]::Round($v * $width)
  return ('#' * $n).PadRight($width, '.')
}

Write-Output ""
Write-Output "MISSION PICTURE REPLAY   scenario=$($g.scenario_id)  method=$Method"
if ($isolated.Count -gt 0) { Write-Output "WHAT-IF: isolating $($isolated -join ', ')" }
Write-Output ("-" * 78)

$header = "{0,-8} {1,-24}" -f 'time', 'stage'
foreach ($m in ($g.missions | Sort-Object priority)) { $header += ("{0,-34}" -f $m.id) }
Write-Output $header

foreach ($s in $steps) {
  $stateMap = @{}
  foreach ($p in $s.state.PSObject.Properties) { $stateMap[$p.Name] = [double]$p.Value }
  foreach ($iso in $isolated) { $stateMap[$iso] = 1.0 }

  $pairs = @()
  foreach ($k in $stateMap.Keys) { $pairs += "$k=$($stateMap[$k])" }
  $stateArg = $pairs -join ','

  $json = & $engine -Scenario $Scenario -State $stateArg -Method $Method -Json | ConvertFrom-Json

  $hhmm = ([datetime]$s.time_iso).ToString('HH:mm')
  $line = "{0,-8} {1,-24}" -f $hhmm, $s.label
  foreach ($m in ($g.missions | Sort-Object priority)) {
    $v = [double]$json.mission.($m.id)
    $line += ("{0} {1,6:P1}   " -f (Bar $v 22), $v)
  }
  Write-Output $line
}

Write-Output ("-" * 78)
Write-Output ""
Write-Output "note: mission degradation is produced by the deterministic layer."
Write-Output "      the LLM explains these numbers, it never produces them (ADR-0003)."
Write-Output ""
