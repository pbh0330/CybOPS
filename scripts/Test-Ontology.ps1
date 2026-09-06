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

# ---------------------------------------------------------------- temporal layer (ADR-0012)
#
# 시간축이 있는 시나리오만 검사한다. defnet-01 처럼 timeline 이 없으면 전부 건너뛴다.

function AsArray($x) { if ($null -eq $x) { return @() } return @($x) }

$CAUSES = @('attack','mobility','terrain','maintenance','unknown')
$temporal = ($null -ne $g.timeline)
$links = AsArray $g.links

$linkIds = @{}
foreach ($l in $links) {
  if (-not $l.id)                       { Err "링크에 id 가 없다" ; continue }
  if ($linkIds.ContainsKey($l.id))      { Err "중복 링크 id: $($l.id)" }
  $linkIds[$l.id] = $true
  if (-not $assetIds.ContainsKey($l.a)) { Err "link $($l.id).a 없는 자산: $($l.a)" }
  if (-not $assetIds.ContainsKey($l.b)) { Err "link $($l.id).b 없는 자산: $($l.b)" }
  if ($l.a -eq $l.b)                    { Err "link $($l.id) 이 자기 자신을 연결한다" }
}

if ($temporal) {
  $horizon = [double]$g.timeline.horizon
  if ($horizon -le 0) { Err "timeline.horizon 이 양수가 아니다: $horizon" }
  if (-not $g.timeline.unit) { Warn "timeline.unit 이 없다 - 시간 단위가 문서화되지 않는다" }

  function Test-Window($w, $label, $horizon) {
    if ($null -eq $w) { return }
    if ($null -eq $w.from -or $null -eq $w.to) { Err "$label 구간에 from/to 가 없다"; return }
    if ([double]$w.from -ge [double]$w.to)     { Err "$label 구간이 비었거나 뒤집혔다: [$($w.from), $($w.to))" }
    if ([double]$w.from -lt 0)                 { Err "$label 구간 시작이 음수다: $($w.from)" }
    if ([double]$w.to -gt $horizon)            { Err "$label 구간 끝이 horizon($horizon)을 넘는다: $($w.to)" }
  }

  foreach ($p in $g.phases) {
    if ($null -eq $p.window) { Err "phase $($p.id) 에 window 가 없다 - 시간축 시나리오에서는 필수다"; continue }
    Test-Window $p.window "phase $($p.id)" $horizon
  }

  # 임무별로 어느 시점에도 활성 단계가 없는 구멍이 있으면 그 구간의 저하도는 정의되지 않는다.
  foreach ($m in $g.missions) {
    $mp = @($g.phases | Where-Object { $_.mission -eq $m.id -and $null -ne $_.window })
    if ($mp.Count -eq 0) { continue }
    $covered = 0
    foreach ($p in $mp) { $covered += ([double]$p.window.to - [double]$p.window.from) }
    $span = (($mp | ForEach-Object { [double]$_.window.to } | Measure-Object -Maximum).Maximum -
             ($mp | ForEach-Object { [double]$_.window.from } | Measure-Object -Minimum).Minimum)
    if ($covered -lt $span) { Warn "임무 $($m.id) 의 단계 사이에 빈 시간이 있다 - 그 구간에는 저하도가 정의되지 않는다" }
  }

  foreach ($t in $g.tasks) {
    if (-not $t.performed_at) { Err "task $($t.id) 에 performed_at 이 없다 - 도달성을 계산할 수 없다"; continue }
    if (-not $assetIds.ContainsKey($t.performed_at)) { Err "task $($t.id).performed_at 없는 자산: $($t.performed_at)" }
  }

  $outageOwners = @()
  foreach ($a in $g.assets) { $outageOwners += ,@("asset $($a.id)", (AsArray $a.outages)) }
  foreach ($l in $links)    { $outageOwners += ,@("link $($l.id)",  (AsArray $l.outages)) }
  foreach ($ow in $outageOwners) {
    foreach ($o in $ow[1]) {
      Test-Window $o $ow[0] $horizon
      $c = 'unknown'
      if ($o.cause) { $c = [string]$o.cause }
      if ($CAUSES -notcontains $c) { Err "$($ow[0]) outage 의 cause 가 정의되지 않았다: $c (허용: $($CAUSES -join ', '))" }
      if (-not $o.cause) { Warn "$($ow[0]) outage 에 cause 가 없다 - unknown 으로 처리된다" }
      if ($c -eq 'attack') { Err "$($ow[0]) outage 에 cause=attack 을 쓰지 않는다. 공격 상태는 attack-timeline 입력으로 넣는다" }
    }
  }

  if ($links.Count -eq 0) { Err "시간축 시나리오인데 links 가 없다 - 도달성 모델이 성립하지 않는다" }

  # 정적 도달성: 모든 링크가 살아 있다고 가정해도 작업이 요구 서비스에 닿지 못하면 모델링 오류다.
  # (경유 불가 단말 transit=false 는 남의 트래픽을 중계하지 않는다)
  $transit = @{}
  foreach ($a in $g.assets) {
    $transit[$a.id] = $true
    if ($null -ne $a.transit -and -not $a.transit) { $transit[$a.id] = $false }
  }
  $adj = @{}
  foreach ($a in $g.assets) { $adj[$a.id] = New-Object System.Collections.ArrayList }
  foreach ($l in $links) {
    if (-not ($assetIds.ContainsKey($l.a) -and $assetIds.ContainsKey($l.b))) { continue }
    [void]$adj[$l.a].Add($l.b); [void]$adj[$l.b].Add($l.a)
  }
  function Get-StaticReach($start, $adj, $transit) {
    $seen = @{}; $seen[$start] = $true
    $stack = New-Object System.Collections.Stack
    foreach ($m in $adj[$start]) { if (-not $seen.ContainsKey($m)) { $seen[$m] = $true; if ($transit[$m]) { $stack.Push($m) } } }
    while ($stack.Count -gt 0) {
      $n = $stack.Pop()
      foreach ($m in $adj[$n]) {
        if ($seen.ContainsKey($m)) { continue }
        $seen[$m] = $true
        if ($transit[$m]) { $stack.Push($m) }
      }
    }
    return $seen
  }
  foreach ($t in $g.tasks) {
    if (-not $t.performed_at -or -not $assetIds.ContainsKey($t.performed_at)) { continue }
    $reach = Get-StaticReach $t.performed_at $adj $transit
    foreach ($r in @($g.edges.requires | Where-Object { $_.from -eq $t.id })) {
      $ok = $false
      foreach ($pr in @($g.edges.provided_by | Where-Object { $_.from -eq $r.to })) {
        if ($reach.ContainsKey($pr.to)) { $ok = $true; break }
      }
      if (-not $ok) {
        Err "task $($t.id)(@$($t.performed_at)) 가 요구 서비스 $($r.to) 의 어떤 제공 자산에도 도달할 수 없다 (모든 링크가 살아 있다고 가정해도)"
      }
    }
  }
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
  if (@($links | Where-Object { $_.a -eq $a.id -or $_.b -eq $a.id }).Count -gt 0) { $used = $true }
  if (-not $used) { Warn "자산 $($a.id) 이 어떤 엣지에도 연결되어 있지 않다" }
}

# crown jewels sanity
foreach ($cj in $g.crown_jewels) {
  if (-not $assetIds.ContainsKey($cj)) { Err "crown_jewels 에 없는 자산: $cj" }
}

# ---------------------------------------------------------------- report

Write-Output ""
Write-Output "ontology check: $($g.scenario_id)"
Write-Output ("  자산 {0}, 서비스 {1}, 작업 {2}, 단계 {3}, 임무 {4}, 링크 {5}" -f `
  $g.assets.Count, $g.services.Count, $g.tasks.Count, $g.phases.Count, $g.missions.Count, $links.Count)
if ($temporal) {
  Write-Output ("  시간축: {0} 단위, horizon {1}, t0 {2}" -f $g.timeline.unit, $g.timeline.horizon, $g.timeline.t0_iso)
}
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
