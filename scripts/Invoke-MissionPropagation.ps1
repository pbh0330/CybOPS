# Mission degradation propagation engine - reference implementation.
#
# ASCII only in this file. Windows PowerShell 5.1 misreads UTF-8 script sources
# without BOM. Korean belongs in the JSON data files, which are read with
# an explicit -Encoding utf8.
#
# This is the DETERMINISTIC layer (ADR-0003). No LLM is involved in any value
# produced here. Every number is traceable to an input state and a named rule.
#
# Chain: asset compromise -> service availability -> task performance -> mission degradation
#
# Usage:
#   .\scripts\Invoke-MissionPropagation.ps1 -State 'WKS003=0.7,DC01=1.0'
#   .\scripts\Invoke-MissionPropagation.ps1 -State 'ESX01=1.0' -Method noisyor
#   .\scripts\Invoke-MissionPropagation.ps1 -StateFile state.json -Explain
#   .\scripts\Invoke-MissionPropagation.ps1 -State 'DC01=1.0' -CompareMethods

param(
  [string]$Scenario   = "$PSScriptRoot\..\scenarios\defnet-01\mission.json",
  [string]$State      = '',
  [string]$StateFile  = '',
  [ValidateSet('max','weighted','noisyor')]
  [string]$Method     = 'weighted',
  [switch]$CompareMethods,
  [switch]$Explain,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- load

if (-not (Test-Path $Scenario)) { throw "scenario not found: $Scenario" }
$g = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json

# ---------------------------------------------------------------- input state

$compromise = @{}
foreach ($a in $g.assets) { $compromise[$a.id] = 0.0 }

if ($StateFile) {
  if (-not (Test-Path $StateFile)) { throw "state file not found: $StateFile" }
  $sf = Get-Content $StateFile -Raw -Encoding utf8 | ConvertFrom-Json
  foreach ($p in $sf.PSObject.Properties) { $compromise[$p.Name] = [double]$p.Value }
}
if ($State) {
  foreach ($pair in $State.Split(',')) {
    if (-not $pair.Trim()) { continue }
    $kv = $pair.Split('=')
    if ($kv.Count -ne 2) { throw "bad -State entry: '$pair' (expected ASSET=0.7)" }
    $id = $kv[0].Trim()
    if (-not $compromise.ContainsKey($id)) { throw "unknown asset id: $id" }
    $compromise[$id] = [double]$kv[1].Trim()
  }
}

foreach ($k in @($compromise.Keys)) {
  if ($compromise[$k] -lt 0 -or $compromise[$k] -gt 1) { throw "compromise level for $k out of [0,1]" }
}

# ------------------------------------------------- stage 1+2: asset impact and service degradation

# These two stages are solved together as one fixed point, because they feed
# each other:
#   hosted_on  : a compromised hypervisor implies its guests are compromised (w = 1.0)
#   depends_on : A depends_on X with weight w -> A inherits w * degradation(X),
#                where X is EITHER another asset OR a service.
#
# Depending on a SERVICE rather than a specific asset is the correct modelling
# and it matters. An earlier version of this scenario had MAIL01 depends_on DC01.
# That made a single DC01 compromise degrade the mail server by 80% even though
# DC02 was still serving authentication - the asset-level edge silently bypassed
# the redundancy group. Route dependencies through the service whenever the
# thing being depended on is redundant.
#
# Monotone and bounded, so the iteration converges; the graph is small.
function Get-ServiceDegradation($imp, $g) {
  $svc = @{}
  foreach ($s in $g.services) {
    $providers = @($g.edges.provided_by | Where-Object { $_.from -eq $s.id })
    if ($providers.Count -eq 0) { $svc[$s.id] = 0.0; continue }

    if ($s.redundancy_group) {
      # redundant: the service only fails to the extent that ALL providers fail
      $p = 1.0
      foreach ($pr in $providers) { $p = $p * $imp[$pr.to] }
      $svc[$s.id] = $p
    } else {
      # single provider path: the worst provider decides
      $m = 0.0
      foreach ($pr in $providers) { if ($imp[$pr.to] -gt $m) { $m = $imp[$pr.to] } }
      $svc[$s.id] = $m
    }
  }
  return $svc
}

function Get-AssetAndService($compromise, $g) {
  $serviceIds = @{}
  foreach ($s in $g.services) { $serviceIds[$s.id] = $true }

  $imp = @{}
  foreach ($k in $compromise.Keys) { $imp[$k] = [double]$compromise[$k] }
  $svc = Get-ServiceDegradation $imp $g

  for ($iter = 0; $iter -lt 50; $iter++) {
    $changed = $false

    foreach ($e in $g.edges.hosted_on) {
      if ($imp[$e.to] -gt $imp[$e.from]) { $imp[$e.from] = $imp[$e.to]; $changed = $true }
    }

    foreach ($e in $g.edges.depends_on) {
      if ($serviceIds.ContainsKey($e.to)) {
        $src = $svc[$e.to]
      } else {
        $src = $imp[$e.to]
      }
      $inherited = [double]$e.w * $src
      if ($inherited -gt $imp[$e.from] + 1e-9) { $imp[$e.from] = $inherited; $changed = $true }
    }

    $svc = Get-ServiceDegradation $imp $g
    if (-not $changed) { break }
  }

  return @{ asset = $imp; service = $svc }
}

# ---------------------------------------------------------------- stage 3+4: task and mission

function Combine($pairs, $method) {
  # $pairs: array of @{w=..; v=..}
  if ($pairs.Count -eq 0) { return 0.0 }
  switch ($method) {
    'max' {
      $m = 0.0
      foreach ($p in $pairs) { $x = $p.w * $p.v; if ($x -gt $m) { $m = $x } }
      return $m
    }
    'weighted' {
      $num = 0.0; $den = 0.0
      foreach ($p in $pairs) { $num += $p.w * $p.v; $den += $p.w }
      if ($den -le 0) { return 0.0 }
      return $num / $den
    }
    'noisyor' {
      $prod = 1.0
      foreach ($p in $pairs) { $prod = $prod * (1.0 - ($p.w * $p.v)) }
      return 1.0 - $prod
    }
  }
}

function Get-TaskDegradation($svc, $g, $method) {
  $task = @{}
  foreach ($t in $g.tasks) {
    $reqs = @($g.edges.requires | Where-Object { $_.from -eq $t.id })
    $pairs = @()
    foreach ($r in $reqs) { $pairs += @{ w = [double]$r.w; v = [double]$svc[$r.to] } }
    $task[$t.id] = Combine $pairs $method
  }
  return $task
}

function Get-MissionDegradation($task, $g, $method) {
  $phaseOf = @{}
  foreach ($ph in $g.phases) { $phaseOf[$ph.id] = $ph.mission }

  $mission = @{}
  foreach ($m in $g.missions) {
    $pairs = @()
    foreach ($t in $g.tasks) {
      if ($phaseOf[$t.phase] -eq $m.id) {
        $pairs += @{ w = [double]$t.criticality; v = [double]$task[$t.id] }
      }
    }
    $mission[$m.id] = Combine $pairs $method
  }
  return $mission
}

function Invoke-Chain($compromise, $g, $method) {
  $fp   = Get-AssetAndService $compromise $g
  $task = Get-TaskDegradation $fp.service $g $method
  $mis  = Get-MissionDegradation $task $g $method
  return @{ asset = $fp.asset; service = $fp.service; task = $task; mission = $mis }
}

# ---------------------------------------------------------------- run

$result = Invoke-Chain $compromise $g $Method

# leave-one-out sensitivity: how much of each mission's degradation does this
# compromised asset actually account for? This is the "why is it red" answer.
function Get-Contributions($compromise, $g, $method, $baseline) {
  $rows = @()
  foreach ($k in $compromise.Keys) {
    if ($compromise[$k] -le 0) { continue }
    $alt = @{}
    foreach ($kk in $compromise.Keys) { $alt[$kk] = $compromise[$kk] }
    $alt[$k] = 0.0
    $r = Invoke-Chain $alt $g $method
    foreach ($m in $g.missions) {
      $delta = $baseline.mission[$m.id] - $r.mission[$m.id]
      if ($delta -gt 0.0001) {
        $rows += [pscustomobject]@{ asset = $k; mission = $m.id; delta = [math]::Round($delta,4) }
      }
    }
  }
  return $rows | Sort-Object -Property delta -Descending
}

if ($Json) {
  $out = [pscustomobject]@{
    scenario = $g.scenario_id
    method   = $Method
    input    = $compromise
    asset    = $result.asset
    service  = $result.service
    task     = $result.task
    mission  = $result.mission
  }
  $out | ConvertTo-Json -Depth 6
  exit 0
}

Write-Output ""
Write-Output "scenario : $($g.scenario_id)   method: $Method"
$active = @($compromise.Keys | Where-Object { $compromise[$_] -gt 0 } | Sort-Object)
if ($active.Count -eq 0) {
  Write-Output "input    : (no compromised assets)"
} else {
  $s = ($active | ForEach-Object { "$_=$($compromise[$_])" }) -join ', '
  Write-Output "input    : $s"
}
Write-Output ""

Write-Output "MISSION DEGRADATION"
foreach ($m in ($g.missions | Sort-Object priority)) {
  $v = $result.mission[$m.id]
  $bar = ('#' * [int][math]::Round($v * 40)).PadRight(40, '.')
  Write-Output ("  {0,-6} P{1}  {2}  {3,6:P1}  {4}" -f $m.id, $m.priority, $bar, $v, $m.name)
}

if ($Explain) {
  Write-Output ""
  Write-Output "ASSET IMPACT (nonzero)"
  foreach ($a in ($g.assets | Sort-Object id)) {
    $v = $result.asset[$a.id]
    if ($v -gt 0) {
      $src = if ($compromise[$a.id] -gt 0) { 'direct' } else { 'inherited' }
      Write-Output ("  {0,-8} {1,6:P1}  {2}" -f $a.id, $v, $src)
    }
  }
  Write-Output ""
  Write-Output "SERVICE DEGRADATION"
  foreach ($s in $g.services) {
    $red = if ($s.redundancy_group) { "redundant($($s.redundancy_group))" } else { "single" }
    Write-Output ("  {0,-7} {1,6:P1}  {2}" -f $s.id, $result.service[$s.id], $red)
  }
  Write-Output ""
  Write-Output "TASK DEGRADATION"
  foreach ($t in $g.tasks) {
    Write-Output ("  {0,-10} {1,6:P1}  {2}" -f $t.id, $result.task[$t.id], $t.name)
  }
  Write-Output ""
  Write-Output "TOP CONTRIBUTORS (leave-one-out)"
  $rows = Get-Contributions $compromise $g $Method $result
  if (@($rows).Count -eq 0) { Write-Output "  (none)" }
  foreach ($r in $rows) {
    Write-Output ("  {0,-8} -> {1,-6} {2,6:P1}" -f $r.asset, $r.mission, $r.delta)
  }
}

if ($CompareMethods) {
  Write-Output ""
  Write-Output "METHOD COMPARISON"
  # .NET format alignment is "{n,10}" for right, "{n,-10}" for left. There is no ">".
  Write-Output ("  {0,-6} {1,10} {2,10} {3,10}" -f 'mission', 'max', 'weighted', 'noisyor')
  $byMethod = @{}
  foreach ($mm in @('max','weighted','noisyor')) { $byMethod[$mm] = Invoke-Chain $compromise $g $mm }
  foreach ($m in $g.missions) {
    Write-Output ("  {0,-6} {1,10:P1} {2,10:P1} {3,10:P1}" -f $m.id,
      $byMethod['max'].mission[$m.id],
      $byMethod['weighted'].mission[$m.id],
      $byMethod['noisyor'].mission[$m.id])
  }
}

Write-Output ""
