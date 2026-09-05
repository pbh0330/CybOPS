# Mission ontology validator.
#
# ASCII only in this file.
#
# Catches the structural mistakes that silently produce wrong mission numbers:
# dangling references, dependency cycles, out-of-range weights, orphan nodes,
# and the redundancy-bypass mistake (an asset-level depends_on edge pointing at
# a member of a redundancy group, which routes around the redundancy).
#
# Usage:
#   .\scripts\Test-Ontology.ps1
#   .\scripts\Test-Ontology.ps1 -Scenario path\to\mission.json
#
# Exit code 0 = pass, 1 = errors found.

param(
  [string]$Scenario = "$PSScriptRoot\..\scenarios\defnet-01\mission.json"
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$g = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json

$errors   = New-Object System.Collections.ArrayList
$warnings = New-Object System.Collections.ArrayList
function Err($m)  { [void]$script:errors.Add($m) }
function Warn($m) { [void]$script:warnings.Add($m) }

# ---------------------------------------------------------------- id sets

$assetIds   = @{}; foreach ($a  in $g.assets)   { if ($assetIds.ContainsKey($a.id))  { Err "중복 자산 id: $($a.id)" }  ; $assetIds[$a.id]   = $true }
$serviceIds = @{}; foreach ($s  in $g.services) { if ($serviceIds.ContainsKey($s.id)){ Err "중복 서비스 id: $($s.id)" }; $serviceIds[$s.id] = $true }
$taskIds    = @{}; foreach ($t  in $g.tasks)    { $taskIds[$t.id]    = $true }
$phaseIds   = @{}; foreach ($p  in $g.phases)   { $phaseIds[$p.id]   = $true }
$missionIds = @{}; foreach ($m  in $g.missions) { $missionIds[$m.id] = $true }
$unitIds    = @{}; foreach ($u  in $g.units)    { $unitIds[$u.id]    = $true }

# ---------------------------------------------------------------- referential integrity

foreach ($p in $g.phases) {
  if (-not $missionIds.ContainsKey($p.mission)) { Err "phase $($p.id) -> 없는 임무 $($p.mission)" }
}
foreach ($t in $g.tasks) {
  if (-not $phaseIds.ContainsKey($t.phase)) { Err "task $($t.id) -> 없는 단계 $($t.phase)" }
  if ($t.criticality -lt 0 -or $t.criticality -gt 1) { Err "task $($t.id) criticality 범위 이탈: $($t.criticality)" }
}
foreach ($a in $g.assets) {
  if ($a.unit -and -not $unitIds.ContainsKey($a.unit)) { Err "asset $($a.id) -> 없는 부대 $($a.unit)" }
}
foreach ($u in $g.units) {
  if ($u.parent -and -not $unitIds.ContainsKey($u.parent)) { Err "unit $($u.id) -> 없는 상급부대 $($u.parent)" }
}

foreach ($e in $g.edges.requires) {
  if (-not $taskIds.ContainsKey($e.from))    { Err "requires.from 없는 작업: $($e.from)" }
  if (-not $serviceIds.ContainsKey($e.to))   { Err "requires.to 없는 서비스: $($e.to)" }
  if ($e.w -le 0 -or $e.w -gt 1)             { Err "requires $($e.from)->$($e.to) 가중치 범위 이탈: $($e.w)" }
}
foreach ($e in $g.edges.provided_by) {
  if (-not $serviceIds.ContainsKey($e.from)) { Err "provided_by.from 없는 서비스: $($e.from)" }
  if (-not $assetIds.ContainsKey($e.to))     { Err "provided_by.to 없는 자산: $($e.to)" }
}
foreach ($e in $g.edges.hosted_on) {
  if (-not $assetIds.ContainsKey($e.from))   { Err "hosted_on.from 없는 자산: $($e.from)" }
  if (-not $assetIds.ContainsKey($e.to))     { Err "hosted_on.to 없는 자산: $($e.to)" }
}
foreach ($e in $g.edges.depends_on) {
  if (-not $assetIds.ContainsKey($e.from))   { Err "depends_on.from 없는 자산: $($e.from)" }
  if (-not ($assetIds.ContainsKey($e.to) -or $serviceIds.ContainsKey($e.to))) {
    Err "depends_on.to 없는 자산/서비스: $($e.to)"
  }
  if ($e.w -le 0 -or $e.w -gt 1)             { Err "depends_on $($e.from)->$($e.to) 가중치 범위 이탈: $($e.w)" }
}
foreach ($e in $g.edges.communicates_with) {
  if (-not $assetIds.ContainsKey($e.a))      { Err "communicates_with.a 없는 자산: $($e.a)" }
  if (-not $assetIds.ContainsKey($e.b))      { Err "communicates_with.b 없는 자산: $($e.b)" }
}

# ---------------------------------------------------------------- redundancy bypass
#
# The mistake that cost real numbers on 2026-09-05: an asset-level depends_on
# pointing at a member of a redundancy group bypasses the redundancy entirely.
# MAIL01 depends_on DC01 made a single DC01 compromise degrade mail by 80% even
# though DC02 was still authenticating. Depend on the SERVICE instead.

$redundantAssets = @{}
foreach ($s in $g.services) {
  if ($s.redundancy_group) {
    foreach ($pr in @($g.edges.provided_by | Where-Object { $_.from -eq $s.id })) {
      $redundantAssets[$pr.to] = $s.id
    }
  }
}
foreach ($e in $g.edges.depends_on) {
  if ($redundantAssets.ContainsKey($e.to)) {
    Err ("depends_on {0} -> {1} 이 이중화를 우회한다. 서비스 {2} 에 의존을 걸어야 한다." -f $e.from, $e.to, $redundantAssets[$e.to])
  }
}

# ---------------------------------------------------------------- cycles

function Test-Cycle($edges, $fromKey, $toKey, $label) {
  $adj = @{}
  foreach ($e in $edges) {
    $f = $e.$fromKey; $t = $e.$toKey
    if (-not $adj.ContainsKey($f)) { $adj[$f] = New-Object System.Collections.ArrayList }
    [void]$adj[$f].Add($t)
  }
  $state = @{}   # 0 unvisited, 1 in-stack, 2 done
  $found = @()
  function Visit($n, $path) {
    if ($script:state[$n] -eq 1) { $script:found += ,($path + $n); return }
    if ($script:state[$n] -eq 2) { return }
    $script:state[$n] = 1
    if ($script:adj.ContainsKey($n)) {
      foreach ($m in $script:adj[$n]) { Visit $m ($path + $n) }
    }
    $script:state[$n] = 2
  }
  $script:adj = $adj; $script:state = $state; $script:found = @()
  foreach ($n in @($adj.Keys)) { if (-not $script:state.ContainsKey($n)) { Visit $n @() } }
  foreach ($c in $script:found) { Err ("$label 순환 의존: " + ($c -join ' -> ')) }
}

Test-Cycle @($g.edges.depends_on) 'from' 'to' 'depends_on'
Test-Cycle @($g.edges.hosted_on)  'from' 'to' 'hosted_on'

# ---------------------------------------------------------------- orphans / coverage

foreach ($s in $g.services) {
  $providers = @($g.edges.provided_by | Where-Object { $_.from -eq $s.id })
  if ($providers.Count -eq 0) { Err "서비스 $($s.id) 에 제공 자산이 없다" }
  if ($s.redundancy_group -and $providers.Count -lt 2) {
    Warn "서비스 $($s.id) 는 redundancy_group 이 있는데 제공 자산이 $($providers.Count)개뿐이다"
  }
  $consumers = @($g.edges.requires | Where-Object { $_.to -eq $s.id })
  if ($consumers.Count -eq 0) { Warn "서비스 $($s.id) 를 요구하는 작업이 없다" }
}
foreach ($t in $g.tasks) {
  if (@($g.edges.requires | Where-Object { $_.from -eq $t.id }).Count -eq 0) {
    Warn "작업 $($t.id) 이 어떤 서비스도 요구하지 않는다 - 임무 저하도에 영향을 줄 수 없다"
  }
}
foreach ($m in $g.missions) {
  if (@($g.phases | Where-Object { $_.mission -eq $m.id }).Count -eq 0) { Err "임무 $($m.id) 에 단계가 없다" }
}

# assets that participate in nothing
foreach ($a in $g.assets) {
  $used = $false
  if (@($g.edges.provided_by       | Where-Object { $_.to   -eq $a.id }).Count -gt 0) { $used = $true }
  if (@($g.edges.hosted_on         | Where-Object { $_.from -eq $a.id -or $_.to -eq $a.id }).Count -gt 0) { $used = $true }
  if (@($g.edges.depends_on        | Where-Object { $_.from -eq $a.id -or $_.to -eq $a.id }).Count -gt 0) { $used = $true }
  if (@($g.edges.communicates_with | Where-Object { $_.a    -eq $a.id -or $_.b  -eq $a.id }).Count -gt 0) { $used = $true }
  if (-not $used) { Warn "자산 $($a.id) 이 어떤 엣지에도 연결되어 있지 않다" }
}

# crown jewels sanity
foreach ($cj in $g.crown_jewels) {
  if (-not $assetIds.ContainsKey($cj)) { Err "crown_jewels 에 없는 자산: $cj" }
}

# ---------------------------------------------------------------- report

Write-Output ""
Write-Output "ontology check: $($g.scenario_id)"
Write-Output ("  자산 {0}, 서비스 {1}, 작업 {2}, 단계 {3}, 임무 {4}" -f `
  $g.assets.Count, $g.services.Count, $g.tasks.Count, $g.phases.Count, $g.missions.Count)
Write-Output ""

if ($errors.Count -eq 0) {
  Write-Output "  ERRORS   : 0"
} else {
  Write-Output ("  ERRORS   : {0}" -f $errors.Count)
  foreach ($e in $errors) { Write-Output "    [E] $e" }
}
if ($warnings.Count -gt 0) {
  Write-Output ("  WARNINGS : {0}" -f $warnings.Count)
  foreach ($w in $warnings) { Write-Output "    [W] $w" }
} else {
  Write-Output "  WARNINGS : 0"
}
Write-Output ""

if ($errors.Count -gt 0) { exit 1 } else { exit 0 }
