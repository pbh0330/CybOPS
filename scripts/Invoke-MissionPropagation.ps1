# Mission degradation propagation engine - reference implementation.
#
# ASCII only in this file. Windows PowerShell 5.1 misreads UTF-8 script sources
# without BOM. Korean belongs in the JSON data files, which are read with
# an explicit -Encoding utf8.
#
# This is the DETERMINISTIC layer (ADR-0003). No LLM is involved in any value
# produced here. Every number is traceable to an input state and a named rule.
#
# Chain: asset compromise -> reachability -> service availability
#        -> task performance -> mission degradation
#
# TEMPORAL MODE (ADR-0012). When the scenario carries a "timeline" block the
# graph is evaluated at a point in time:
#   - assets and links may be out with a CAUSE (mobility/terrain/maintenance/
#     unknown), independent of any attack;
#   - a task only counts toward its mission while its phase window contains t;
#   - a service counts for a task only if the task's performed_at asset can
#     still REACH a provider over the links that are up at t.
#
# Reachability is why the time axis is not cosmetic: redundancy that cannot be
# reached is not redundancy. In tacnet-01, S-C2MSG has two providers, and the
# battalion still loses it during the satcom outage because the second provider
# sits on the far side of the cut.
#
# Attack degradation and environment degradation are reported SEPARATELY, by
# re-running the same deterministic chain with only one cause class enabled.
# A picture that cannot tell a ridge from an adversary reports the hill as
# enemy action (ADR-0012 section 2).
#
# Usage:
#   .\scripts\Invoke-MissionPropagation.ps1 -State 'WKS003=0.7,DC01=1.0'
#   .\scripts\Invoke-MissionPropagation.ps1 -State 'ESX01=1.0' -Method noisyor
#   .\scripts\Invoke-MissionPropagation.ps1 -StateFile state.json -Explain
#   .\scripts\Invoke-MissionPropagation.ps1 -State 'DC01=1.0' -CompareMethods
#   .\scripts\Invoke-MissionPropagation.ps1 -Scenario scenarios\tacnet-01\mission.json -At 310 -Explain

param(
  [string]$Scenario   = "$PSScriptRoot\..\scenarios\defnet-01\mission.json",
  [string]$State      = '',
  [string]$StateFile  = '',
  [ValidateSet('max','weighted','noisyor')]
  [string]$Method     = 'weighted',
  [double]$At         = -1,
  [switch]$CompareMethods,
  [switch]$Explain,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- load

if (-not (Test-Path $Scenario)) { throw "scenario not found: $Scenario" }
$g = Get-Content $Scenario -Raw -Encoding utf8 | ConvertFrom-Json

function AsArray($x) { if ($null -eq $x) { return @() } return @($x) }

$hasLinks = (AsArray $g.links).Count -gt 0
$temporal = ($null -ne $g.timeline)

if ($temporal -and $At -lt 0) { $At = 0 }
if ($temporal -and $g.timeline.horizon -and $At -gt [double]$g.timeline.horizon) {
  throw ("-At {0} is past the scenario horizon {1}" -f $At, $g.timeline.horizon)
}
if (-not $temporal -and $At -ge 0) {
  Write-Warning "scenario has no timeline block; -At is ignored"
  $At = -1
}

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

# ---------------------------------------------------------------- cause classes
#
# 'attack' is the only class an adversary produces. Everything else is the
# environment doing what the environment does. Keeping them in separate sets is
# what makes the attribution run possible.

$ALL_CAUSES = @('attack','mobility','terrain','maintenance','unknown')

function New-CauseSet($mode) {
  $h = @{}
  switch ($mode) {
    'all'    { foreach ($c in $ALL_CAUSES) { $h[$c] = $true } }
    'attack' { $h['attack'] = $true }
    'env'    { foreach ($c in $ALL_CAUSES) { if ($c -ne 'attack') { $h[$c] = $true } } }
    'none'   { }
  }
  return $h
}

function Get-ActiveOutage($outages, $t, $causeSet) {
  if ($t -lt 0) { return $null }
  foreach ($o in (AsArray $outages)) {
    $c = 'unknown'
    if ($o.cause) { $c = [string]$o.cause }
    if (-not $causeSet.ContainsKey($c)) { continue }
    if ($t -ge [double]$o.from -and $t -lt [double]$o.to) { return $c }
  }
  return $null
}

# ---------------------------------------------------------------- snapshot at t
#
# Which assets are up, which links are up, and what is connected to what.
# An asset that is out cannot relay: it drops out of the connectivity graph
# entirely rather than passing traffic through.

function Get-Snapshot($g, $t, $causeSet) {
  $assetOut = @{}
  foreach ($a in $g.assets) { $assetOut[$a.id] = Get-ActiveOutage $a.outages $t $causeSet }

  $linkOut = @{}
  foreach ($l in (AsArray $g.links)) { $linkOut[$l.id] = Get-ActiveOutage $l.outages $t $causeSet }

  # transit=false marks an end terminal: it originates and receives its own
  # traffic but does not relay anybody else's. Without this a dismounted
  # observer tablet silently becomes a router and carries the whole brigade
  # around a cut satellite link - found by inspection on 2026-09-06, and it
  # made the satcom outage cost exactly nothing.
  $transit = @{}
  foreach ($a in $g.assets) {
    $transit[$a.id] = $true
    if ($null -ne $a.transit -and -not $a.transit) { $transit[$a.id] = $false }
  }

  $adj = @{}
  foreach ($a in $g.assets) { $adj[$a.id] = New-Object System.Collections.ArrayList }
  foreach ($l in (AsArray $g.links)) {
    if ($linkOut[$l.id]) { continue }
    if ($assetOut[$l.a] -or $assetOut[$l.b]) { continue }
    [void]$adj[$l.a].Add($l.b)
    [void]$adj[$l.b].Add($l.a)
  }

  # Components are built over TRANSIT nodes only. A terminal is then attached to
  # the component of each transit neighbour it still has - possibly more than
  # one, which is how a terminal can talk to both sides of a cut without
  # bridging them.
  $comp = @{}
  foreach ($a in $g.assets) { $comp[$a.id] = -1 }
  $cid = 0
  foreach ($a in $g.assets) {
    if ($assetOut[$a.id] -or -not $transit[$a.id]) { continue }
    if ($comp[$a.id] -ge 0) { continue }
    $cid++
    $comp[$a.id] = $cid
    $stack = New-Object System.Collections.Stack
    $stack.Push($a.id)
    while ($stack.Count -gt 0) {
      $n = $stack.Pop()
      foreach ($m in $adj[$n]) {
        if ($assetOut[$m] -or -not $transit[$m]) { continue }
        if ($comp[$m] -lt 0) { $comp[$m] = $cid; $stack.Push($m) }
      }
    }
  }

  $compSet = @{}
  foreach ($a in $g.assets) {
    $set = @{}
    if (-not $assetOut[$a.id]) {
      if ($transit[$a.id]) {
        $set[$comp[$a.id]] = $true
      } else {
        foreach ($m in $adj[$a.id]) {
          if ($assetOut[$m] -or -not $transit[$m]) { continue }
          $set[$comp[$m]] = $true
        }
      }
    }
    $compSet[$a.id] = $set
  }

  return @{ assetOut = $assetOut; linkOut = $linkOut; comp = $comp; compSet = $compSet; adj = $adj; transit = $transit }
}

function Test-Reach($snap, $from, $to, $hasLinks) {
  if (-not $hasLinks) { return $true }          # no transport model: assume reachable
  if (-not $from) { return $true }              # no consumer context (global view)
  if (-not $snap.compSet.ContainsKey($from)) { return $true }
  if (-not $snap.compSet.ContainsKey($to))   { return $true }
  if ($snap.assetOut[$from] -or $snap.assetOut[$to]) { return $false }
  if ($from -eq $to) { return $true }
  foreach ($m in $snap.adj[$from]) { if ($m -eq $to) { return $true } }   # direct link
  foreach ($c in $snap.compSet[$from].Keys) {
    if ($snap.compSet[$to].ContainsKey($c)) { return $true }
  }
  return $false
}

# ------------------------------------------------- stage 1+2: asset impact and service degradation
#
# These two stages are solved together as one fixed point, because they feed
# each other:
#   hosted_on  : a compromised hypervisor implies its guests are compromised
#   depends_on : A depends_on X with weight w -> A inherits w * degradation(X),
#                where X is EITHER another asset OR a service.
#
# Depending on a SERVICE rather than a specific asset is the correct modelling
# and it matters. An earlier version of defnet-01 had MAIL01 depends_on DC01.
# That made a single DC01 compromise degrade the mail server by 80% even though
# DC02 was still serving authentication - the asset-level edge silently bypassed
# the redundancy group. Route dependencies through the service whenever the
# thing being depended on is redundant.
#
# Monotone and bounded, so the iteration converges; the graph is small.

function Get-ServiceDegFor($imp, $g, $snap, $consumer, $hasLinks) {
  $svc = @{}
  foreach ($s in $g.services) {
    $providers = @($g.edges.provided_by | Where-Object { $_.from -eq $s.id })
    if ($providers.Count -eq 0) { $svc[$s.id] = 0.0; continue }

    $eff = @()
    foreach ($pr in $providers) {
      $v = [double]$imp[$pr.to]
      # an unreachable provider is indistinguishable from a dead one, from
      # where this consumer sits
      if (-not (Test-Reach $snap $consumer $pr.to $hasLinks)) { $v = 1.0 }
      $eff += $v
    }

    if ($s.redundancy_group) {
      # redundant: the service only fails to the extent that ALL providers fail
      $p = 1.0
      foreach ($v in $eff) { $p = $p * $v }
      $svc[$s.id] = $p
    } else {
      # single provider path: the worst provider decides
      $m = 0.0
      foreach ($v in $eff) { if ($v -gt $m) { $m = $v } }
      $svc[$s.id] = $m
    }
  }
  return $svc
}

function Get-AssetImpact($compromise, $g, $snap, $hasLinks) {
  $serviceIds = @{}
  foreach ($s in $g.services) { $serviceIds[$s.id] = $true }

  $imp = @{}
  foreach ($a in $g.assets) {
    $v = 0.0
    if ($compromise.ContainsKey($a.id)) { $v = [double]$compromise[$a.id] }
    if ($snap.assetOut[$a.id]) { $v = 1.0 }    # out is out, whatever the cause
    $imp[$a.id] = $v
  }

  for ($iter = 0; $iter -lt 50; $iter++) {
    $changed = $false

    foreach ($e in $g.edges.hosted_on) {
      if ($imp[$e.to] -gt $imp[$e.from] + 1e-9) { $imp[$e.from] = $imp[$e.to]; $changed = $true }
    }

    foreach ($e in $g.edges.depends_on) {
      if ($serviceIds.ContainsKey($e.to)) {
        $svc = Get-ServiceDegFor $imp $g $snap $e.from $hasLinks
        $src = [double]$svc[$e.to]
      } else {
        $src = [double]$imp[$e.to]
        if (-not (Test-Reach $snap $e.from $e.to $hasLinks)) { $src = 1.0 }
      }
      $inherited = [double]$e.w * $src
      if ($inherited -gt $imp[$e.from] + 1e-9) { $imp[$e.from] = $inherited; $changed = $true }
    }

    if (-not $changed) { break }
  }

  return $imp
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

function Get-ActivePhaseSet($g, $t) {
  $act = @{}
  foreach ($ph in $g.phases) {
    if ($t -lt 0 -or $null -eq $ph.window) { $act[$ph.id] = $true; continue }
    if ($t -ge [double]$ph.window.from -and $t -lt [double]$ph.window.to) { $act[$ph.id] = $true }
  }
  return $act
}

function Get-TaskDegradation($imp, $g, $snap, $method, $hasLinks) {
  $task = @{}
  foreach ($t in $g.tasks) {
    $consumer = $null
    if ($t.performed_at) { $consumer = [string]$t.performed_at }
    $svc = Get-ServiceDegFor $imp $g $snap $consumer $hasLinks
    $pairs = @()
    foreach ($r in @($g.edges.requires | Where-Object { $_.from -eq $t.id })) {
      $pairs += @{ w = [double]$r.w; v = [double]$svc[$r.to] }
    }
    $v = Combine $pairs $method
    # The terminal the work is done on is part of the work. A task cannot be
    # performed better than the machine performing it: a compromised or
    # unavailable performer floors the task at its own impact. Without this a
    # compromised company terminal shows zero mission effect, because a
    # terminal provides no service to anyone.
    if ($consumer -and $imp[$consumer] -gt $v) { $v = [double]$imp[$consumer] }
    $task[$t.id] = $v
  }
  return $task
}

function Get-MissionDegradation($task, $g, $method, $activePhases) {
  $phaseOf = @{}
  foreach ($ph in $g.phases) { $phaseOf[$ph.id] = $ph.mission }

  $mission = @{}
  $active  = @{}
  foreach ($m in $g.missions) {
    $pairs = @()
    foreach ($t in $g.tasks) {
      if ($phaseOf[$t.phase] -ne $m.id) { continue }
      if (-not $activePhases.ContainsKey($t.phase)) { continue }
      $pairs += @{ w = [double]$t.criticality; v = [double]$task[$t.id] }
    }
    $active[$m.id]  = ($pairs.Count -gt 0)
    $mission[$m.id] = Combine $pairs $method
  }
  return @{ value = $mission; active = $active }
}

function Invoke-Chain($compromise, $g, $method, $t, $causeMode, $hasLinks) {
  $causeSet = New-CauseSet $causeMode
  $snap = Get-Snapshot $g $t $causeSet
  $imp  = Get-AssetImpact $compromise $g $snap $hasLinks
  $svc  = Get-ServiceDegFor $imp $g $snap $null $hasLinks   # global view, for reporting
  $task = Get-TaskDegradation $imp $g $snap $method $hasLinks
  $act  = Get-ActivePhaseSet $g $t
  $mis  = Get-MissionDegradation $task $g $method $act
  return @{
    asset = $imp; service = $svc; task = $task
    mission = $mis.value; missionActive = $mis.active
    snapshot = $snap; activePhases = $act
  }
}

function New-EmptyState($g) {
  $h = @{}
  foreach ($a in $g.assets) { $h[$a.id] = 0.0 }
  return $h
}

# ---------------------------------------------------------------- run

$result = Invoke-Chain $compromise $g $Method $At 'all' $hasLinks

# Cause attribution. Same chain, one cause class at a time:
#   attack-only : the environment is pretended to be perfect
#   env-only    : the adversary is pretended to be absent
# Neither is the truth; the pair tells the operator how much of the red on the
# screen is somebody shooting at them and how much is a hill.
$attribute = $temporal
if ($attribute) {
  $rAttack = Invoke-Chain $compromise $g $Method $At 'attack' $hasLinks
  $rEnv    = Invoke-Chain (New-EmptyState $g) $g $Method $At 'env' $hasLinks
}

# leave-one-out sensitivity: how much of each mission's degradation does this
# compromised asset actually account for? This is the "why is it red" answer.
function Get-Contributions($compromise, $g, $method, $baseline, $t, $hasLinks) {
  $rows = @()
  foreach ($k in $compromise.Keys) {
    if ($compromise[$k] -le 0) { continue }
    $alt = @{}
    foreach ($kk in $compromise.Keys) { $alt[$kk] = $compromise[$kk] }
    $alt[$k] = 0.0
    $r = Invoke-Chain $alt $g $method $t 'all' $hasLinks
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
    t        = $(if ($temporal) { $At } else { $null })
    input    = $compromise
    asset    = $result.asset
    service  = $result.service
    task     = $result.task
    mission  = $result.mission
    mission_active = $result.missionActive
  }
  if ($attribute) {
    $out | Add-Member -NotePropertyName mission_attack -NotePropertyValue $rAttack.mission
    $out | Add-Member -NotePropertyName mission_env    -NotePropertyValue $rEnv.mission
    $out | Add-Member -NotePropertyName asset_outage   -NotePropertyValue $result.snapshot.assetOut
    $out | Add-Member -NotePropertyName link_outage    -NotePropertyValue $result.snapshot.linkOut
    $out | Add-Member -NotePropertyName active_phases  -NotePropertyValue @($result.activePhases.Keys | Sort-Object)
  }
  $out | ConvertTo-Json -Depth 6
  exit 0
}

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

Write-Output ""
if ($temporal) {
  $clock = ''
  if ($g.timeline.t0_iso) {
    $clock = '  (' + ([datetime]$g.timeline.t0_iso).AddMinutes($At).ToString('HH:mm') + ')'
  }
  Write-Output "scenario : $($g.scenario_id)   method: $Method   t=+$At min$clock"
} else {
  Write-Output "scenario : $($g.scenario_id)   method: $Method"
}
$active = @($compromise.Keys | Where-Object { $compromise[$_] -gt 0 } | Sort-Object)
if ($active.Count -eq 0) {
  Write-Output "input    : (no compromised assets)"
} else {
  $s = ($active | ForEach-Object { "$_=$($compromise[$_])" }) -join ', '
  Write-Output "input    : $s"
}
Write-Output ""

Write-Output "MISSION DEGRADATION"
if ($attribute) {
  Write-Output ("  {0,-7} {1,-42} {2,7} {3,8} {4,7} {5,7}" -f 'mission', '', 'total', 'attack', 'env', 'inter')
}
foreach ($m in ($g.missions | Sort-Object priority)) {
  $v = $result.mission[$m.id]
  if ($attribute -and -not $result.missionActive[$m.id]) {
    Write-Output ("  {0,-7} P{1}  {2}  {3}" -f $m.id, $m.priority, '(no active phase at this time)'.PadRight(40), $m.name)
    continue
  }
  $bar = ('#' * [int][math]::Round($v * 40)).PadRight(40, '.')
  if ($attribute) {
    # interaction = total - attack-only - env-only. It is not slack: a nonzero
    # value means neither cause alone would have produced this degradation.
    # Redundancy that survives an attack and survives a cut can still die when
    # both land at once, and that number is where it shows up.
    $inter = $v - $rAttack.mission[$m.id] - $rEnv.mission[$m.id]
    Write-Output ("  {0,-7} P{1} {2} {3,7:P1} {4,8:P1} {5,7:P1} {6,7:P1}  {7}" -f `
      $m.id, $m.priority, $bar, $v, $rAttack.mission[$m.id], $rEnv.mission[$m.id], $inter, $m.name)
  } else {
    Write-Output ("  {0,-6} P{1}  {2}  {3,6:P1}  {4}" -f $m.id, $m.priority, $bar, $v, $m.name)
  }
}

if ($Explain) {
  if ($temporal) {
    Write-Output ""
    Write-Output "ACTIVE PHASES"
    $any = $false
    foreach ($ph in $g.phases) {
      if (-not $result.activePhases.ContainsKey($ph.id)) { continue }
      $any = $true
      Write-Output ("  {0,-10} {1,-14} [{2}, {3})" -f $ph.id, $ph.name, $ph.window.from, $ph.window.to)
    }
    if (-not $any) { Write-Output "  (none)" }

    Write-Output ""
    Write-Output "OUTAGES AT t (cause-labelled, NOT attributed to the adversary)"
    $any = $false
    foreach ($a in $g.assets) {
      $c = $result.snapshot.assetOut[$a.id]
      if ($c) { $any = $true; Write-Output ("  asset  {0,-10} cause={1}" -f $a.id, $c) }
    }
    foreach ($l in (AsArray $g.links)) {
      $c = $result.snapshot.linkOut[$l.id]
      if ($c) { $any = $true; Write-Output ("  link   {0,-10} cause={1}  ({2} <-> {3}, {4})" -f $l.id, $c, $l.a, $l.b, $l.bearer) }
    }
    if (-not $any) { Write-Output "  (none)" }
  }

  Write-Output ""
  Write-Output "ASSET IMPACT (nonzero)"
  foreach ($a in ($g.assets | Sort-Object id)) {
    $v = $result.asset[$a.id]
    if ($v -gt 0) {
      $src = 'inherited'
      if ($compromise[$a.id] -gt 0) { $src = 'direct' }
      if ($result.snapshot.assetOut[$a.id]) { $src = 'outage:' + $result.snapshot.assetOut[$a.id] }
      Write-Output ("  {0,-9} {1,6:P1}  {2}" -f $a.id, $v, $src)
    }
  }
  Write-Output ""
  Write-Output "SERVICE DEGRADATION (global view; per-task view accounts for reachability)"
  foreach ($s in $g.services) {
    $red = 'single'
    if ($s.redundancy_group) { $red = "redundant($($s.redundancy_group))" }
    Write-Output ("  {0,-8} {1,6:P1}  {2}" -f $s.id, $result.service[$s.id], $red)
  }
  Write-Output ""
  Write-Output "TASK DEGRADATION"
  foreach ($t in $g.tasks) {
    $mark = ' '
    if ($temporal -and -not $result.activePhases.ContainsKey($t.phase)) { $mark = '-' }
    $where = ''
    if ($t.performed_at) { $where = "@$($t.performed_at)" }
    Write-Output ("  {0} {1,-10} {2,6:P1}  {3,-10} {4}" -f $mark, $t.id, $result.task[$t.id], $where, $t.name)
  }
  if ($temporal) { Write-Output "  ('-' = phase not active at this time; excluded from mission rollup)" }
  Write-Output ""
  Write-Output "TOP CONTRIBUTORS (leave-one-out)"
  $rows = Get-Contributions $compromise $g $Method $result $At $hasLinks
  if (@($rows).Count -eq 0) { Write-Output "  (none)" }
  foreach ($r in $rows) {
    Write-Output ("  {0,-9} -> {1,-7} {2,6:P1}" -f $r.asset, $r.mission, $r.delta)
  }
}

if ($CompareMethods) {
  Write-Output ""
  Write-Output "METHOD COMPARISON"
  # .NET format alignment is "{n,10}" for right, "{n,-10}" for left. There is no ">".
  Write-Output ("  {0,-7} {1,10} {2,10} {3,10}" -f 'mission', 'max', 'weighted', 'noisyor')
  $byMethod = @{}
  foreach ($mm in @('max','weighted','noisyor')) { $byMethod[$mm] = Invoke-Chain $compromise $g $mm $At 'all' $hasLinks }
  foreach ($m in $g.missions) {
    Write-Output ("  {0,-7} {1,10:P1} {2,10:P1} {3,10:P1}" -f $m.id,
      $byMethod['max'].mission[$m.id],
      $byMethod['weighted'].mission[$m.id],
      $byMethod['noisyor'].mission[$m.id])
  }
}

Write-Output ""
