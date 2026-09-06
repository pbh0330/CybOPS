# ADR-0002 as a test, not a promise.
#
# ASCII only in this file.
#
# ADR-0002 says external IP geolocation never feeds a judgement: it is kept in
# the schema as a reference value and must not reach a score, a priority or an
# automated response. Until now that was a sentence in a document. A sentence
# does not stop anyone from wiring geo into the engine six months from now.
#
# This test makes it falsifiable. It perturbs every geolocation-ish field it can
# find - the country code on synthetic events, and the whole Asset.geo block on
# a scenario - and asserts that the deterministic layer produces byte-identical
# mission numbers. If someone starts reading geo in the engine, this fails.
#
# Note the two are different things and both are tested:
#   enrichment geo (event geo_country)  external, wrong at country granularity,
#                                       and forbidden from judgement (ADR-0002)
#   Asset.geo (scenario)                asset register data, trustworthy, and
#                                       still not an input to degradation - it
#                                       is a display layer (ADR-0001, docs/17)
#
# Usage:
#   .\scripts\Test-GeoInvariance.ps1
#   .\scripts\Test-GeoInvariance.ps1 -Scenario scenarios\defnet-01\mission.json
#
# Exit 0 = geo does not influence the deterministic layer. Exit 1 = it does.

param(
  [string]$Scenario = "$PSScriptRoot\..\scenarios\tacnet-01\mission.json",
  [string]$Method   = 'weighted',
  [string]$OutJson  = '',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$engine = Join-Path $PSScriptRoot 'Invoke-MissionPropagation.ps1'
if (-not (Test-Path $engine)) { throw "engine not found: $engine" }
if (-not (Test-Path $Scenario)) { throw "scenario not found: $Scenario" }

$scratch = Join-Path $env:TEMP ("mccycop-geo-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $scratch | Out-Null

function Get-MissionSeries($path, $times, $state) {
  $out = [ordered]@{}
  foreach ($t in $times) {
    $args = @{ Scenario = $path; Method = $Method; Json = $true }
    if ($null -ne $t) { $args['At'] = $t }
    if ($state) { $args['State'] = $state }
    $j = & $engine @args | ConvertFrom-Json
    foreach ($p in $j.mission.PSObject.Properties) {
      $out["t$t.$($p.Name)"] = [double]$p.Value
    }
    if ($j.mission_attack) {
      foreach ($p in $j.mission_attack.PSObject.Properties) { $out["t$t.atk.$($p.Name)"] = [double]$p.Value }
      foreach ($p in $j.mission_env.PSObject.Properties)    { $out["t$t.env.$($p.Name)"] = [double]$p.Value }
    }
  }
  return $out
}

$g = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
$temporal = ($null -ne $g.timeline)
$times = @($null)
if ($temporal) {
  $times = @()
  $step = 15
  if ($g.timeline.step) { $step = [int]$g.timeline.step }
  for ($t = 0; $t -lt [int]$g.timeline.horizon; $t += $step) { $times += $t }
}

# a state with something compromised, so the comparison is not all zeros
$state = ''
$cj = @($g.crown_jewels)
if ($cj.Count -ge 2) { $state = "$($cj[0])=1.0,$($cj[1])=0.6" }
elseif ($cj.Count -eq 1) { $state = "$($cj[0])=1.0" }

Write-Output ''
Write-Output "geo invariance check   scenario=$($g.scenario_id)  method=$Method"
Write-Output ("  time points {0}, state '{1}'" -f $times.Count, $state)

$baseline = Get-MissionSeries $Scenario $times $state
Write-Output ("  baseline values: {0}" -f $baseline.Count)

# ---------------------------------------------------------------- mutations
#
# Each mutation changes only geolocation-shaped data. Anything the engine is
# allowed to read (links, outages, weights, transit) is left alone.

$mutations = @()

# 1. move every asset to the other side of the planet
$m1 = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($a in $m1.assets) {
  if ($null -eq $a.geo) { continue }
  if ($a.geo.at) { $a.geo.at.x = [double]$a.geo.at.x + 999999; $a.geo.at.y = [double]$a.geo.at.y - 777777 }
  foreach ($s in @($a.geo.segments)) {
    if ($s.at)    { $s.at.x    = [double]$s.at.x + 999999;    $s.at.y    = [double]$s.at.y - 777777 }
    if ($s.to_at) { $s.to_at.x = [double]$s.to_at.x + 999999; $s.to_at.y = [double]$s.to_at.y - 777777 }
  }
}
$mutations += @{ name = 'assets displaced 1000 km'; obj = $m1 }

# 2. strip Asset.geo entirely
$m2 = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($a in $m2.assets) { if ($a.PSObject.Properties['geo']) { $a.PSObject.Properties.Remove('geo') } }
$mutations += @{ name = 'Asset.geo removed'; obj = $m2 }

# 3. move the whole grid anchor (georef) somewhere else
$m3 = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
if ($m3.geo -and $m3.geo.georef -and $m3.geo.georef.anchor) {
  $m3.geo.georef.anchor.lat = 37.5
  $m3.geo.georef.anchor.lon = 127.0
  $mutations += @{ name = 'grid anchor moved to land'; obj = $m3 }
}

# 4. inject a country code onto every asset, the ADR-0002 shape exactly
$m4 = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
$i = 0
foreach ($a in $m4.assets) {
  $cc = @('XX', 'RU', 'CN', 'KP', 'IR')[$i % 5]
  $a | Add-Member -NotePropertyName geo_country -NotePropertyValue $cc -Force
  $i++
}
$mutations += @{ name = 'hostile country codes injected'; obj = $m4 }

# 5. self-test. A test that only ever passes proves nothing: it could be
# comparing two identical runs and calling that a result. This mutation
# changes something the engine IS supposed to read (a transport link), so it
# MUST be reported as a difference. Run with -SelfTest; it is expected to fail
# the check, and that failure is the pass.
#
# The mutation has to be one that provably moves the number. "Remove a link"
# is not: defnet-01 shrugged it off because the redundant provider was still
# reachable, and a self-test that silently fails to perturb anything is worse
# than none. Adding an undegraded task to a degraded mission always lowers the
# weighted average, so this one cannot be absorbed.
if ($SelfTest) {
  $m5 = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json
  $ph = @($m5.phases)[0]
  $svc = @($m5.services)[0]
  $host0 = @($m5.assets | Where-Object { $_.transit -ne $false })[0]
  if ($ph -and $svc -and $host0) {
    $newTask = [pscustomobject]@{
      id = 'SELFTEST-TASK'; phase = $ph.id; name = 'selftest'
      criticality = 1.0; performed_at = $host0.id
    }
    $m5.tasks = @($m5.tasks) + $newTask
    $m5.edges.requires = @($m5.edges.requires) + [pscustomobject]@{
      from = 'SELFTEST-TASK'; to = $svc.id; w = 1.0
    }
    $mutations += @{ name = 'SELFTEST: extra task added'; obj = $m5; expect_diff = $true }
  }
}

# ---------------------------------------------------------------- run

$rows = New-Object System.Collections.ArrayList
$failures = 0

foreach ($m in $mutations) {
  $path = Join-Path $scratch (($m.name -replace '[^0-9A-Za-z]', '_') + '.json')
  [IO.File]::WriteAllText($path, ($m.obj | ConvertTo-Json -Depth 14), (New-Object Text.UTF8Encoding($false)))

  $series = Get-MissionSeries $path $times $state
  $diffs = New-Object System.Collections.ArrayList
  foreach ($k in $baseline.Keys) {
    $b = [double]$baseline[$k]
    $v = [double]$series[$k]
    if ([math]::Abs($b - $v) -gt 1e-12) {
      [void]$diffs.Add([ordered]@{ key = $k; baseline = $b; mutated = $v })
    }
  }
  # a geo mutation must change nothing; the self-test mutation must change
  # something, otherwise the comparison itself is broken
  $wantDiff = [bool]$m.expect_diff
  $ok = if ($wantDiff) { $diffs.Count -gt 0 } else { $diffs.Count -eq 0 }
  if (-not $ok) { $failures++ }
  [void]$rows.Add([ordered]@{
    mutation = $m.name; compared = $baseline.Count; differences = $diffs.Count
    expect_difference = $wantDiff; pass = $ok; detail = @($diffs | Select-Object -First 20)
  })
  $verdict = if ($ok) { 'PASS' } else { "FAIL x$($diffs.Count)" }
  if ($wantDiff) { $verdict = if ($ok) { "PASS (detected $($diffs.Count) difference(s))" } else { 'FAIL (comparison detected nothing)' } }
  Write-Output ("  {0,-34} {1}  ({2} values)" -f $m.name, $verdict, $baseline.Count)
  if ($wantDiff) { continue }
  foreach ($d in ($diffs | Select-Object -First 5)) {
    Write-Output ("      {0}  {1} -> {2}" -f $d.key, $d.baseline, $d.mutated)
  }
}

Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue

Write-Output ''
if ($failures -eq 0) {
  Write-Output ("RESULT: PASS   geo does not reach the deterministic layer (ADR-0002, ADR-0001)")
} else {
  Write-Output ("RESULT: FAIL   {0} mutation(s) changed mission values. Geolocation is feeding a judgement." -f $failures)
}
Write-Output ''

if ($OutJson) {
  $dir = Split-Path $OutJson -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $report = [ordered]@{
    generated = (Get-Date).ToString('o')
    generator = 'scripts/Test-GeoInvariance.ps1'
    adr       = @('ADR-0001', 'ADR-0002')
    scenario  = $g.scenario_id
    method    = $Method
    state     = $state
    time_points = $times.Count
    values_compared = $baseline.Count
    mutations = @($rows)
    failures  = $failures
    pass      = ($failures -eq 0)
  }
  [IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  Write-Output ("report: {0}" -f $OutJson)
  Write-Output ''
}

if ($failures -gt 0) { exit 1 } else { exit 0 }
