# Compare-Propagation.ps1 - E2: side-by-side comparison of the three mission
# degradation propagation functions (max / weighted / noisyor).
#
# ASCII only in this file. Windows PowerShell 5.1 misreads UTF-8 script sources
# without a BOM. Human-readable Korean belongs in docs and JSON data files.
#
# THIS SCRIPT DOES NOT MODIFY THE ENGINE. It shells out to
# scripts\Invoke-MissionPropagation.ps1 with -Json and reads the result.
# Every number below is produced by the engine, not re-implemented here.
#
# What it measures (docs/04-evaluation.md 2.2):
#   1. monotonicity  - degradation must not fall when compromise grows
#   2. redundancy    - one member of a redundancy group must not sink a mission
#   3. saturation    - how fast each method pins to 1.0 as input grows
#   4. rank order    - Kendall tau-b between methods over the same situations
#   5. explainability- leave-one-out share of the top contributor, which is the
#                      numeric proxy for "can you answer WHY in three steps"
#
# Usage:
#   .\scripts\Compare-Propagation.ps1
#   .\scripts\Compare-Propagation.ps1 -OutJson eval\results\propagation-comparison.json
#   .\scripts\Compare-Propagation.ps1 -NoWrite

param(
  [string]$OutJson = '',
  [int]$Step       = 15,
  [switch]$NoWrite
)

$ErrorActionPreference = 'Stop'

$repoRoot   = (Resolve-Path "$PSScriptRoot\..").Path
$enginePath = Join-Path $repoRoot 'scripts\Invoke-MissionPropagation.ps1'
$defnetPath = Join-Path $repoRoot 'scenarios\defnet-01\mission.json'
$defnetAtk  = Join-Path $repoRoot 'scenarios\defnet-01\attack-chain.json'
$tacnetPath = Join-Path $repoRoot 'scenarios\tacnet-01\mission.json'
$tacnetAtk  = Join-Path $repoRoot 'scenarios\tacnet-01\attack-timeline.json'

foreach ($p in @($enginePath, $defnetPath, $defnetAtk, $tacnetPath, $tacnetAtk)) {
  if (-not (Test-Path $p)) { throw "missing input: $p" }
}

if (-not $OutJson) { $OutJson = Join-Path $repoRoot 'eval\results\propagation-comparison.json' }

$METHODS = @('max','weighted','noisyor')
$INV     = [System.Globalization.CultureInfo]::InvariantCulture

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---------------------------------------------------------------- engine call

$script:engineCache = @{}
$script:engineCalls = 0

function Format-StateString([hashtable]$stateMap) {
  $parts = @()
  foreach ($k in ($stateMap.Keys | Sort-Object)) {
    $val = [double]$stateMap[$k]
    if ($val -le 0) { continue }
    $parts += ('{0}={1}' -f $k, $val.ToString('0.######', $INV))
  }
  return ($parts -join ',')
}

function Invoke-Engine {
  param(
    [string]$ScenarioPath,
    [hashtable]$StateMap,
    [string]$MethodName,
    [double]$AtMinute = -1
  )
  $stateStr = Format-StateString $StateMap
  $key = '{0}|{1}|{2}|{3}' -f $ScenarioPath, $MethodName, $AtMinute, $stateStr
  if ($script:engineCache.ContainsKey($key)) { return $script:engineCache[$key] }

  # hashtable splatting, not array splatting: an array splat lets the -Json
  # switch swallow the next element and the engine then sees -At '-Json'.
  $argv = @{ Scenario = $ScenarioPath; Method = $MethodName; Json = $true }
  if ($AtMinute -ge 0) { $argv['At']    = [double]$AtMinute }
  if ($stateStr)       { $argv['State'] = $stateStr }

  $raw = & $enginePath @argv
  $script:engineCalls++
  $obj = ($raw | Out-String) | ConvertFrom-Json
  $script:engineCache[$key] = $obj
  return $obj
}

function Get-Prop($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  $pp = $obj.PSObject.Properties[$name]
  if ($null -eq $pp) { return $null }
  return $pp.Value
}

function Get-MissionValue($res, [string]$missionId) {
  $v = Get-Prop $res.mission $missionId
  if ($null -eq $v) { return 0.0 }
  return [double]$v
}

function Test-MissionActive($res, [string]$missionId) {
  $ma = Get-Prop $res 'mission_active'
  if ($null -eq $ma) { return $true }
  $v = Get-Prop $ma $missionId
  if ($null -eq $v) { return $true }
  return [bool]$v
}

function Copy-State([hashtable]$stateMap) {
  $h = @{}
  foreach ($k in $stateMap.Keys) { $h[$k] = $stateMap[$k] }
  return $h
}

function Round4([double]$x) { return [math]::Round($x, 4) }

# ---------------------------------------------------------------- statistics

function Get-KendallTauB {
  param([double[]]$X, [double[]]$Y)
  $n = $X.Count
  if ($n -lt 2) { return $null }
  $conc = 0; $disc = 0; $tiesX = 0; $tiesY = 0
  $eps = 1e-9
  for ($i = 0; $i -lt $n - 1; $i++) {
    for ($j = $i + 1; $j -lt $n; $j++) {
      $dx = $X[$i] - $X[$j]
      $dy = $Y[$i] - $Y[$j]
      if ([math]::Abs($dx) -lt $eps) { $dx = 0.0 }
      if ([math]::Abs($dy) -lt $eps) { $dy = 0.0 }
      if ($dx -eq 0.0 -and $dy -eq 0.0) { $tiesX++; $tiesY++; continue }
      if ($dx -eq 0.0) { $tiesX++; continue }
      if ($dy -eq 0.0) { $tiesY++; continue }
      if (($dx -gt 0 -and $dy -gt 0) -or ($dx -lt 0 -and $dy -lt 0)) { $conc++ } else { $disc++ }
    }
  }
  $n0  = $n * ($n - 1) / 2
  $den = [math]::Sqrt(([double]($n0 - $tiesX)) * ([double]($n0 - $tiesY)))
  if ($den -le 0) { return $null }
  return [math]::Round((($conc - $disc) / $den), 4)
}

function Get-CurveStats {
  param([double[]]$Values)
  $n = $Values.Count
  if ($n -eq 0) { return $null }
  $mx = $Values[0]; $mn = $Values[0]; $sum = 0.0
  foreach ($v in $Values) { if ($v -gt $mx) { $mx = $v }; if ($v -lt $mn) { $mn = $v }; $sum += $v }
  $mean = $sum / $n
  $var = 0.0
  foreach ($v in $Values) { $var += ($v - $mean) * ($v - $mean) }
  $sd = [math]::Sqrt($var / $n)
  $distinct = @($Values | ForEach-Object { [math]::Round($_, 3) } | Sort-Object -Unique).Count
  $ge90 = 0; $ge99 = 0
  foreach ($v in $Values) { if ($v -ge 0.90) { $ge90++ }; if ($v -ge 0.99) { $ge99++ } }
  $first90 = -1; $first99 = -1
  for ($i = 0; $i -lt $n; $i++) {
    if ($first90 -lt 0 -and $Values[$i] -ge 0.90) { $first90 = $i }
    if ($first99 -lt 0 -and $Values[$i] -ge 0.99) { $first99 = $i }
  }
  return [pscustomobject]@{
    n              = $n
    mean           = Round4 $mean
    sd             = Round4 $sd
    min            = Round4 $mn
    max            = Round4 $mx
    range          = Round4 ($mx - $mn)
    distinct_3dp   = $distinct
    count_ge_090   = $ge90
    count_ge_099   = $ge99
    first_idx_090  = $first90
    first_idx_099  = $first99
  }
}

# ---------------------------------------------------------------- scenario input

$defnetChain = Get-Content $defnetAtk -Raw -Encoding utf8 | ConvertFrom-Json
$tacnetChain = Get-Content $tacnetAtk -Raw -Encoding utf8 | ConvertFrom-Json
$tacnetGraph = Get-Content $tacnetPath -Raw -Encoding utf8 | ConvertFrom-Json

function ConvertTo-StateMap($stateObj) {
  $h = @{}
  if ($null -eq $stateObj) { return $h }
  foreach ($pp in $stateObj.PSObject.Properties) { $h[$pp.Name] = [double]$pp.Value }
  return $h
}

# defnet-01: the recorded 12-step campaign, collapsed to 10 distinct states
$defnetLadderChain = @()
$idx = 0
foreach ($s in $defnetChain.states) {
  $defnetLadderChain += [pscustomobject]@{
    index = $idx
    label = ('t+{0}s' -f $s.off)
    state = (ConvertTo-StateMap $s.state)
  }
  $idx++
}

# defnet-01: controlled additive ladder, one more asset fully compromised each
# step. Order is fixed so the curve is reproducible.
$defnetAddOrder = @('DC01','DC02','DB01','DB02','MAIL01','FS01','WEB01','WKS003')
$defnetLadderAdd = @()
$acc = @{}
$defnetLadderAdd += [pscustomobject]@{ index = 0; label = 'k=0 (clean)'; state = (Copy-State $acc) }
$k = 1
foreach ($a in $defnetAddOrder) {
  $acc[$a] = 1.0
  $defnetLadderAdd += [pscustomobject]@{ index = $k; label = ('k={0} +{1}' -f $k, $a); state = (Copy-State $acc) }
  $k++
}

# tacnet-01: same additive idea, evaluated at a fixed instant so that the only
# thing changing is the adversary. Two instants: 390 (environment clean) and
# 300 (the satcom cut, cause=unknown).
$tacnetAddOrder = @('BN-SRV','TOC-SRV','RELAY-1','SAT-TERM','FDC-SRV','BFT-GW','CO2-VEH','CO1-VEH')
function New-TacnetAddLadder {
  $rows = @()
  $accum = @{}
  $rows += [pscustomobject]@{ index = 0; label = 'k=0 (clean)'; state = (Copy-State $accum) }
  $i = 1
  foreach ($a in $tacnetAddOrder) {
    $accum[$a] = 1.0
    $rows += [pscustomobject]@{ index = $i; label = ('k={0} +{1}' -f $i, $a); state = (Copy-State $accum) }
    $i++
  }
  return $rows
}
$tacnetLadderAdd = New-TacnetAddLadder

# level sweeps: fixed asset set, compromise level swept 0.0 .. 1.0
function New-LevelSweep([string[]]$AssetIds) {
  $rows = @()
  for ($i = 0; $i -le 10; $i++) {
    $x = $i / 10.0
    $h = @{}
    foreach ($a in $AssetIds) { $h[$a] = $x }
    $rows += [pscustomobject]@{ index = $i; label = ('x={0:0.0}' -f $x); level = $x; state = $h }
  }
  return $rows
}
$defnetSweep = New-LevelSweep @('DC01','DC02')
$tacnetSweep = New-LevelSweep @('BN-SRV','TOC-SRV')

# tacnet time axis: adversary state is whatever the timeline says at t
function Get-TacnetStateAt([double]$t) {
  $cur = @{}
  foreach ($s in $tacnetChain.steps) {
    if ([double]$s.t -le $t) { $cur = ConvertTo-StateMap $s.state }
  }
  return $cur
}

$horizon = [double]$tacnetGraph.timeline.horizon
$tacnetSteps = @()
for ($t = 0.0; $t -lt $horizon; $t += $Step) { $tacnetSteps += $t }

# ---------------------------------------------------------------- 1. monotonicity

function Measure-Monotonicity {
  param(
    [string]$ScenarioPath,
    [string]$ScenarioId,
    [string]$LadderId,
    $Ladder,
    [double]$AtMinute,
    [string[]]$MissionIds
  )
  $out = @()
  foreach ($m in $METHODS) {
    foreach ($mission in $MissionIds) {
      $vals = @()
      foreach ($row in $Ladder) {
        $r = Invoke-Engine $ScenarioPath $row.state $m $AtMinute
        $vals += (Get-MissionValue $r $mission)
      }
      $violations = @()
      for ($i = 1; $i -lt $vals.Count; $i++) {
        $d = $vals[$i] - $vals[$i-1]
        if ($d -lt -1e-9) {
          $violations += [pscustomobject]@{ from_index = $i-1; to_index = $i; drop = Round4 (-$d) }
        }
      }
      $out += [pscustomobject]@{
        scenario   = $ScenarioId
        ladder     = $LadderId
        at         = $(if ($AtMinute -ge 0) { $AtMinute } else { $null })
        method     = $m
        mission    = $mission
        values     = @($vals | ForEach-Object { Round4 $_ })
        monotone   = ($violations.Count -eq 0)
        violations = @($violations)
      }
    }
  }
  return $out
}

Write-Output ''
Write-Output '=== MC-CyCOP E2: propagation function comparison (max / weighted / noisyor)'
Write-Output ''
Write-Output '[1/5] monotonicity'

$monotonicity = @()
$monotonicity += Measure-Monotonicity $defnetPath 'defnet-01' 'campaign-chain'  $defnetLadderChain -1  @('M-C2','M-LOG')
$monotonicity += Measure-Monotonicity $defnetPath 'defnet-01' 'additive-k'      $defnetLadderAdd   -1  @('M-C2','M-LOG')
$monotonicity += Measure-Monotonicity $defnetPath 'defnet-01' 'level-sweep'     $defnetSweep       -1  @('M-C2','M-LOG')
$monotonicity += Measure-Monotonicity $tacnetPath 'tacnet-01' 'additive-k@390'  $tacnetLadderAdd   390 @('M-C2','M-FIRE')
$monotonicity += Measure-Monotonicity $tacnetPath 'tacnet-01' 'additive-k@300'  $tacnetLadderAdd   300 @('M-C2','M-FIRE')
$monotonicity += Measure-Monotonicity $tacnetPath 'tacnet-01' 'level-sweep@390' $tacnetSweep       390 @('M-C2','M-FIRE')

# monotonicity over the whole time axis at a FIXED t is what is being tested.
# Walking t itself is not a monotonicity test: the environment changes with t.
foreach ($t in $tacnetSteps) {
  $ladder = New-TacnetAddLadder
  $monotonicity += Measure-Monotonicity $tacnetPath 'tacnet-01' ('additive-k@' + $t) $ladder $t @('M-C2','M-FIRE')
}

$monoViolations = @($monotonicity | Where-Object { -not $_.monotone })
Write-Output ("      rows={0}  violations={1}" -f $monotonicity.Count, $monoViolations.Count)

# ---------------------------------------------------------------- 2. redundancy

Write-Output '[2/5] redundancy'

function Measure-Redundancy {
  param(
    [string]$ScenarioPath, [string]$ScenarioId, [string]$GroupId,
    [string]$MemberA, [string]$MemberB, [double]$AtMinute, [string]$MissionId
  )
  $out = @()
  foreach ($m in $METHODS) {
    $vA   = Get-MissionValue (Invoke-Engine $ScenarioPath @{ $MemberA = 1.0 } $m $AtMinute) $MissionId
    $vB   = Get-MissionValue (Invoke-Engine $ScenarioPath @{ $MemberB = 1.0 } $m $AtMinute) $MissionId
    $vAB  = Get-MissionValue (Invoke-Engine $ScenarioPath @{ $MemberA = 1.0; $MemberB = 1.0 } $m $AtMinute) $MissionId
    $out += [pscustomobject]@{
      scenario  = $ScenarioId
      group     = $GroupId
      at        = $(if ($AtMinute -ge 0) { $AtMinute } else { $null })
      mission   = $MissionId
      method    = $m
      only_a    = Round4 $vA
      only_b    = Round4 $vB
      both      = Round4 $vAB
      # the property the ontology demands: losing one member of a redundancy
      # group must not by itself drive the mission
      single_member_absorbed = (($vA -lt 1e-9) -and ($vB -lt 1e-9))
      pair_bites             = ($vAB -gt 1e-9)
    }
  }
  return $out
}

$redundancy = @()
$redundancy += Measure-Redundancy $defnetPath 'defnet-01' 'dir (DC01/DC02)'         'DC01' 'DC02' -1 'M-C2'
$redundancy += Measure-Redundancy $defnetPath 'defnet-01' 'db (DB01/DB02)'          'DB01' 'DB02' -1 'M-LOG'
$redundancy += Measure-Redundancy $tacnetPath 'tacnet-01' 'c2 (TOC-SRV/BN-SRV)'     'TOC-SRV' 'BN-SRV'   390 'M-C2'
$redundancy += Measure-Redundancy $tacnetPath 'tacnet-01' 'voice (RELAY-1/SAT-TERM)' 'RELAY-1' 'SAT-TERM' 390 'M-C2'
# same c2 group during the satcom cut: reachability removes the second member,
# so the group is expected to STOP absorbing. That is the point of ADR-0017.
$redundancy += Measure-Redundancy $tacnetPath 'tacnet-01' 'c2 (TOC-SRV/BN-SRV) during cut' 'TOC-SRV' 'BN-SRV' 320 'M-C2'

Write-Output ("      probes={0}" -f $redundancy.Count)

# ---------------------------------------------------------------- 3. saturation

Write-Output '[3/5] saturation'

function Measure-Saturation {
  param([string]$ScenarioPath, [string]$ScenarioId, [string]$CurveId, $Ladder, [double]$AtMinute, [string]$MissionId)
  $out = @()
  foreach ($m in $METHODS) {
    $vals = @()
    foreach ($row in $Ladder) {
      $r = Invoke-Engine $ScenarioPath $row.state $m $AtMinute
      $vals += (Get-MissionValue $r $MissionId)
    }
    $stats = Get-CurveStats ([double[]]$vals)
    $out += [pscustomobject]@{
      scenario = $ScenarioId
      curve    = $CurveId
      at       = $(if ($AtMinute -ge 0) { $AtMinute } else { $null })
      mission  = $MissionId
      method   = $m
      labels   = @($Ladder | ForEach-Object { $_.label })
      values   = @($vals | ForEach-Object { Round4 $_ })
      stats    = $stats
    }
  }
  return $out
}

$saturation = @()
$saturation += Measure-Saturation $defnetPath 'defnet-01' 'additive-k'      $defnetLadderAdd -1  'M-C2'
$saturation += Measure-Saturation $defnetPath 'defnet-01' 'additive-k'      $defnetLadderAdd -1  'M-LOG'
$saturation += Measure-Saturation $defnetPath 'defnet-01' 'campaign-chain'  $defnetLadderChain -1 'M-C2'
$saturation += Measure-Saturation $defnetPath 'defnet-01' 'level-sweep'     $defnetSweep     -1  'M-C2'
$saturation += Measure-Saturation $tacnetPath 'tacnet-01' 'additive-k@390'  $tacnetLadderAdd 390 'M-C2'
$saturation += Measure-Saturation $tacnetPath 'tacnet-01' 'additive-k@390'  $tacnetLadderAdd 390 'M-FIRE'
$saturation += Measure-Saturation $tacnetPath 'tacnet-01' 'level-sweep@390' $tacnetSweep     390 'M-C2'

# ---------------------------------------------------------------- 4. full time axis

Write-Output '[4/5] tacnet-01 time axis (all steps)'

$timeline = @()
foreach ($t in $tacnetSteps) {
  $st = Get-TacnetStateAt $t
  $row = [ordered]@{ t = $t; state = (Format-StateString $st) }
  foreach ($m in $METHODS) {
    $r = Invoke-Engine $tacnetPath $st $m $t
    $row[($m + '_M-C2')]          = Round4 (Get-MissionValue $r 'M-C2')
    $row[($m + '_M-FIRE')]        = Round4 (Get-MissionValue $r 'M-FIRE')
    $row[($m + '_M-C2_active')]   = (Test-MissionActive $r 'M-C2')
    $row[($m + '_M-FIRE_active')] = (Test-MissionActive $r 'M-FIRE')
  }
  $timeline += [pscustomobject]$row
}

# resolution over the run: a method that pins everything near 1.0 cannot tell
# 11:00 from 12:30 on the same screen
$timelineStats = @()
foreach ($m in $METHODS) {
  foreach ($mission in @('M-C2','M-FIRE')) {
    $col = ($m + '_' + $mission)
    $act = ($m + '_' + $mission + '_active')
    $vals = @()
    foreach ($row in $timeline) { if ($row.$act) { $vals += [double]$row.$col } }
    $timelineStats += [pscustomobject]@{
      method = $m; mission = $mission
      stats  = (Get-CurveStats ([double[]]$vals))
    }
  }
}

# ---------------------------------------------------------------- 5. rank correlation

Write-Output '[5/5] rank correlation + explainability'

function New-RankVector {
  param([string]$ScenarioPath, $Ladder, [double]$AtMinute, [string[]]$MissionIds, [string]$MethodName, [string]$Level)
  $v = @()
  foreach ($row in $Ladder) {
    $atv = $AtMinute
    if ($null -ne $row.PSObject.Properties['at']) { $atv = [double]$row.at }
    $r = Invoke-Engine $ScenarioPath $row.state $MethodName $atv
    if ($Level -eq 'mission') {
      foreach ($mission in $MissionIds) {
        if (-not (Test-MissionActive $r $mission)) { continue }
        $v += (Get-MissionValue $r $mission)
      }
    } else {
      foreach ($pp in ($r.task.PSObject.Properties | Sort-Object Name)) { $v += [double]$pp.Value }
    }
  }
  return [double[]]$v
}

function Measure-RankCorrelation {
  param([string]$SetId, [string]$ScenarioPath, $Ladder, [double]$AtMinute, [string[]]$MissionIds, [string]$Level)
  $vecs = @{}
  foreach ($m in $METHODS) { $vecs[$m] = New-RankVector $ScenarioPath $Ladder $AtMinute $MissionIds $m $Level }
  $rows = @()
  for ($i = 0; $i -lt $METHODS.Count; $i++) {
    for ($j = $i + 1; $j -lt $METHODS.Count; $j++) {
      $a = $METHODS[$i]; $b = $METHODS[$j]
      $rows += [pscustomobject]@{
        set     = $SetId
        level   = $Level
        pair    = ('{0} vs {1}' -f $a, $b)
        n       = $vecs[$a].Count
        tau_b   = (Get-KendallTauB $vecs[$a] $vecs[$b])
      }
    }
  }
  return $rows
}

# the tacnet time axis as a ranking set: each row carries its own t
$tacnetTimeLadder = @()
foreach ($t in $tacnetSteps) {
  $tacnetTimeLadder += [pscustomobject]@{ index = $t; label = ('t=' + $t); at = $t; state = (Get-TacnetStateAt $t) }
}

$rankCorrelation = @()
$rankCorrelation += Measure-RankCorrelation 'defnet-01/campaign-chain' $defnetPath $defnetLadderChain -1 @('M-C2','M-LOG')   'mission'
$rankCorrelation += Measure-RankCorrelation 'defnet-01/campaign-chain' $defnetPath $defnetLadderChain -1 @('M-C2','M-LOG')   'task'
$rankCorrelation += Measure-RankCorrelation 'defnet-01/additive-k'     $defnetPath $defnetLadderAdd   -1 @('M-C2','M-LOG')   'mission'
$rankCorrelation += Measure-RankCorrelation 'tacnet-01/time-axis'      $tacnetPath $tacnetTimeLadder  -1 @('M-C2','M-FIRE')  'mission'
$rankCorrelation += Measure-RankCorrelation 'tacnet-01/time-axis'      $tacnetPath $tacnetTimeLadder  -1 @('M-C2','M-FIRE')  'task'
$rankCorrelation += Measure-RankCorrelation 'tacnet-01/additive-k@390' $tacnetPath $tacnetLadderAdd  390 @('M-C2','M-FIRE')  'mission'

# mission-order flips: with only two missions per scenario a tau over missions
# alone is degenerate, so the honest statement is the pairwise flip count.
function Measure-OrderFlips {
  param([string]$SetId, [string]$ScenarioPath, $Ladder, [double]$AtMinute, [string]$MissionA, [string]$MissionB)
  $signs = @{}
  foreach ($m in $METHODS) { $signs[$m] = @() }
  $compared = 0
  foreach ($row in $Ladder) {
    $atv = $AtMinute
    if ($null -ne $row.PSObject.Properties['at']) { $atv = [double]$row.at }
    $ok = $true
    $tmp = @{}
    foreach ($m in $METHODS) {
      $r = Invoke-Engine $ScenarioPath $row.state $m $atv
      if (-not (Test-MissionActive $r $MissionA) -or -not (Test-MissionActive $r $MissionB)) { $ok = $false; break }
      $d = (Get-MissionValue $r $MissionA) - (Get-MissionValue $r $MissionB)
      if ([math]::Abs($d) -lt 1e-9) { $tmp[$m] = 0 } elseif ($d -gt 0) { $tmp[$m] = 1 } else { $tmp[$m] = -1 }
    }
    if (-not $ok) { continue }
    $compared++
    foreach ($m in $METHODS) { $signs[$m] += $tmp[$m] }
  }
  $rows = @()
  for ($i = 0; $i -lt $METHODS.Count; $i++) {
    for ($j = $i + 1; $j -lt $METHODS.Count; $j++) {
      $a = $METHODS[$i]; $b = $METHODS[$j]
      $flips = 0; $tieDiff = 0
      for ($k2 = 0; $k2 -lt $compared; $k2++) {
        $sa = $signs[$a][$k2]; $sb = $signs[$b][$k2]
        if ($sa -eq $sb) { continue }
        if ($sa -eq 0 -or $sb -eq 0) { $tieDiff++ } else { $flips++ }
      }
      $rows += [pscustomobject]@{
        set = $SetId; pair = ('{0} vs {1}' -f $a, $b)
        compared = $compared; strict_flips = $flips; tie_differences = $tieDiff
      }
    }
  }
  return $rows
}

$orderFlips = @()
$orderFlips += Measure-OrderFlips 'defnet-01/campaign-chain' $defnetPath $defnetLadderChain -1 'M-C2' 'M-LOG'
$orderFlips += Measure-OrderFlips 'defnet-01/additive-k'     $defnetPath $defnetLadderAdd   -1 'M-C2' 'M-LOG'
$orderFlips += Measure-OrderFlips 'tacnet-01/time-axis'      $tacnetPath $tacnetTimeLadder  -1 'M-C2' 'M-FIRE'
$orderFlips += Measure-OrderFlips 'tacnet-01/additive-k@390' $tacnetPath $tacnetLadderAdd  390 'M-C2' 'M-FIRE'

# ---------------------------------------------------------------- explainability

# The engine already exposes leave-one-out contributions. The question that
# matters for ADR-0003 is whether a single named cause still accounts for the
# number. If removing the biggest contributor barely moves the value, then
# "why is this mission red" has no short answer, whatever the value is.

function Measure-Explainability {
  param([string]$ScenarioPath, [string]$ScenarioId, [string]$CaseId, [hashtable]$StateMap, [double]$AtMinute, [string]$MissionId)
  $out = @()
  foreach ($m in $METHODS) {
    $base = Get-MissionValue (Invoke-Engine $ScenarioPath $StateMap $m $AtMinute) $MissionId
    $deltas = @()
    foreach ($assetId in ($StateMap.Keys | Sort-Object)) {
      if ([double]$StateMap[$assetId] -le 0) { continue }
      $alt = Copy-State $StateMap
      $alt[$assetId] = 0.0
      $v = Get-MissionValue (Invoke-Engine $ScenarioPath $alt $m $AtMinute) $MissionId
      $deltas += [pscustomobject]@{ asset = $assetId; delta = Round4 ($base - $v) }
    }
    $sorted = @($deltas | Sort-Object -Property delta -Descending)
    $top = 0.0
    if ($sorted.Count -gt 0) { $top = [double]$sorted[0].delta }
    $sum = 0.0
    foreach ($d in $deltas) { $sum += [double]$d.delta }
    $share = $null
    if ($base -gt 1e-9) { $share = Round4 ($top / $base) }
    $out += [pscustomobject]@{
      scenario          = $ScenarioId
      case              = $CaseId
      at                = $(if ($AtMinute -ge 0) { $AtMinute } else { $null })
      mission           = $MissionId
      method            = $m
      base              = Round4 $base
      top_contributor   = $(if ($sorted.Count -gt 0) { $sorted[0].asset } else { $null })
      top_delta         = Round4 $top
      top_delta_share   = $share
      loo_sum           = Round4 $sum
      loo_sum_share     = $(if ($base -gt 1e-9) { Round4 ($sum / $base) } else { $null })
      contributions     = $sorted
    }
  }
  return $out
}

# Drill-down consistency. The commander drills mission -> task. If no task of
# the mission is as red as the mission headline, the drill-down produces no
# answer and the headline number is unattributable.
#
# Two reference points, because the three methods are not scaled alike:
#   max_task : the reddest task under the mission, unweighted. This is the
#              honest bound: max and weighted are both bounded by it, so an
#              excess over it means the headline exceeds everything below it.
#   max_term : max_i(crit_i * task_i), the largest single contribution to the
#              rollup. Reported as a secondary figure. weighted normalises by
#              sum(crit) and can legitimately sit above max_term when the
#              criticalities are below 1, so this column is not a fault
#              indicator for weighted.
#
#   max      : mission = max_i(crit_i*task_i)        -> excess over term = 0
#   weighted : mission = weighted mean               -> excess over task <= 0
#   noisyor  : mission = 1 - prod(1 - crit_i*task_i) -> excess over term >= 0

$defnetGraph = Get-Content $defnetPath -Raw -Encoding utf8 | ConvertFrom-Json

function New-TaskIndex($graph) {
  $phaseMission = @{}
  foreach ($ph in $graph.phases) { $phaseMission[$ph.id] = [string]$ph.mission }
  $rows = @()
  foreach ($t in $graph.tasks) {
    $rows += [pscustomobject]@{
      id = [string]$t.id; phase = [string]$t.phase
      mission = $phaseMission[[string]$t.phase]; criticality = [double]$t.criticality
    }
  }
  return $rows
}
$defnetTaskIndex = New-TaskIndex $defnetGraph
$tacnetTaskIndex = New-TaskIndex $tacnetGraph

function Measure-DrillDown {
  param([string]$SetId, [string]$ScenarioPath, $TaskIndex, $Ladder, [double]$AtMinute, [string[]]$MissionIds)
  $out = @()
  foreach ($m in $METHODS) {
    $exTask = @()
    $exTerm = @()
    $inconsistent = 0
    $points = 0
    foreach ($row in $Ladder) {
      $atv = $AtMinute
      if ($null -ne $row.PSObject.Properties['at']) { $atv = [double]$row.at }
      $r = Invoke-Engine $ScenarioPath $row.state $m $atv
      $activePhases = $null
      $ap = Get-Prop $r 'active_phases'
      if ($null -ne $ap) { $activePhases = @($ap) }
      foreach ($mission in $MissionIds) {
        if (-not (Test-MissionActive $r $mission)) { continue }
        $mv = Get-MissionValue $r $mission
        $maxTerm = 0.0
        $maxTask = 0.0
        foreach ($ti in $TaskIndex) {
          if ($ti.mission -ne $mission) { continue }
          if ($null -ne $activePhases -and ($activePhases -notcontains $ti.phase)) { continue }
          $tv = [double](Get-Prop $r.task $ti.id)
          if ($tv -gt $maxTask) { $maxTask = $tv }
          $term = $ti.criticality * $tv
          if ($term -gt $maxTerm) { $maxTerm = $term }
        }
        $points++
        $exTask += ($mv - $maxTask)
        $exTerm += ($mv - $maxTerm)
        if (($mv - $maxTask) -gt 1e-6) { $inconsistent++ }
      }
    }
    $mxA = 0.0; $sumA = 0.0
    foreach ($e in $exTask) { if ($e -gt $mxA) { $mxA = $e }; $sumA += $e }
    $mxB = 0.0; $sumB = 0.0
    foreach ($e in $exTerm) { if ($e -gt $mxB) { $mxB = $e }; $sumB += $e }
    $out += [pscustomobject]@{
      set = $SetId; method = $m; points = $points
      unattributable_points  = $inconsistent
      max_excess_over_task   = Round4 $mxA
      mean_excess_over_task  = $(if ($points -gt 0) { Round4 ($sumA / $points) } else { $null })
      max_excess_over_term   = Round4 $mxB
      mean_excess_over_term  = $(if ($points -gt 0) { Round4 ($sumB / $points) } else { $null })
    }
  }
  return $out
}

$drilldown = @()
$drilldown += Measure-DrillDown 'defnet-01/campaign-chain' $defnetPath $defnetTaskIndex $defnetLadderChain -1 @('M-C2','M-LOG')
$drilldown += Measure-DrillDown 'defnet-01/additive-k'     $defnetPath $defnetTaskIndex $defnetLadderAdd   -1 @('M-C2','M-LOG')
$drilldown += Measure-DrillDown 'defnet-01/level-sweep'    $defnetPath $defnetTaskIndex $defnetSweep       -1 @('M-C2','M-LOG')
$drilldown += Measure-DrillDown 'tacnet-01/time-axis'      $tacnetPath $tacnetTaskIndex $tacnetTimeLadder  -1 @('M-C2','M-FIRE')
$drilldown += Measure-DrillDown 'tacnet-01/additive-k@390' $tacnetPath $tacnetTaskIndex $tacnetLadderAdd  390 @('M-C2','M-FIRE')

# Minimal explanation set: greedy forward selection over the compromised assets
# until the reproduced value reaches 95% of the reported one. "How many things
# does the operator have to be told before the number stops being a surprise."

function Measure-ExplanationSet {
  param([string]$ScenarioPath, [string]$ScenarioId, [string]$CaseId, [hashtable]$StateMap, [double]$AtMinute, [string]$MissionId)
  $out = @()
  foreach ($m in $METHODS) {
    $base = Get-MissionValue (Invoke-Engine $ScenarioPath $StateMap $m $AtMinute) $MissionId
    $pool = @($StateMap.Keys | Where-Object { [double]$StateMap[$_] -gt 0 } | Sort-Object)
    $chosen = @()
    $cur = 0.0
    if ($base -gt 1e-9) {
      while ($cur -lt (0.95 * $base) -and $chosen.Count -lt $pool.Count) {
        $bestId = $null; $bestVal = -1.0
        foreach ($cand in $pool) {
          if ($chosen -contains $cand) { continue }
          $sub = @{}
          foreach ($c in $chosen) { $sub[$c] = $StateMap[$c] }
          $sub[$cand] = $StateMap[$cand]
          $v = Get-MissionValue (Invoke-Engine $ScenarioPath $sub $m $AtMinute) $MissionId
          if ($v -gt $bestVal) { $bestVal = $v; $bestId = $cand }
        }
        if ($null -eq $bestId) { break }
        $chosen += $bestId
        $cur = $bestVal
      }
    }
    $out += [pscustomobject]@{
      scenario = $ScenarioId; case = $CaseId
      at = $(if ($AtMinute -ge 0) { $AtMinute } else { $null })
      mission = $MissionId; method = $m
      base = Round4 $base
      set_size = $chosen.Count
      pool_size = $pool.Count
      covered = Round4 $cur
      assets = $chosen
    }
  }
  return $out
}

$explanationSets = @()
$explanationSets += Measure-ExplanationSet $defnetPath 'defnet-01' 'full-campaign' `
  @{ 'WKS003' = 1.0; 'DC01' = 1.0; 'DC02' = 1.0; 'DB01' = 1.0 } -1 'M-C2'
$explanationSets += Measure-ExplanationSet $tacnetPath 'tacnet-01' 'saturated-k8@390' `
  @{ 'BN-SRV' = 1.0; 'TOC-SRV' = 1.0; 'RELAY-1' = 1.0; 'SAT-TERM' = 1.0; 'FDC-SRV' = 1.0; 'BFT-GW' = 1.0; 'CO2-VEH' = 1.0; 'CO1-VEH' = 1.0 } 390 'M-C2'
$explanationSets += Measure-ExplanationSet $tacnetPath 'tacnet-01' 'mid-level-half@390' `
  @{ 'BN-SRV' = 0.5; 'TOC-SRV' = 0.5; 'RELAY-1' = 0.5; 'SAT-TERM' = 0.5 } 390 'M-C2'
$explanationSets += Measure-ExplanationSet $defnetPath 'defnet-01' 'mid-level-half' `
  @{ 'DC01' = 0.5; 'DC02' = 0.5; 'DB01' = 0.5; 'DB02' = 0.5 } -1 'M-C2'

$explainability = @()
$explainability += Measure-Explainability $defnetPath 'defnet-01' 'full-campaign' `
  @{ 'WKS003' = 1.0; 'DC01' = 1.0; 'DC02' = 1.0; 'DB01' = 1.0 } -1 'M-C2'
$explainability += Measure-Explainability $defnetPath 'defnet-01' 'full-campaign' `
  @{ 'WKS003' = 1.0; 'DC01' = 1.0; 'DC02' = 1.0; 'DB01' = 1.0 } -1 'M-LOG'
$explainability += Measure-Explainability $defnetPath 'defnet-01' 'dc-pair-only' `
  @{ 'DC01' = 1.0; 'DC02' = 1.0 } -1 'M-C2'
$explainability += Measure-Explainability $tacnetPath 'tacnet-01' 'toc-owned@390' `
  @{ 'CO2-VEH' = 0.8; 'BN-SRV' = 1.0; 'TOC-SRV' = 1.0 } 390 'M-C2'
$explainability += Measure-Explainability $tacnetPath 'tacnet-01' 'satcom-cut@300' `
  @{ 'CO2-VEH' = 0.8; 'BN-SRV' = 1.0 } 300 'M-C2'
$explainability += Measure-Explainability $tacnetPath 'tacnet-01' 'saturated-k8@390' `
  @{ 'BN-SRV' = 1.0; 'TOC-SRV' = 1.0; 'RELAY-1' = 1.0; 'SAT-TERM' = 1.0; 'FDC-SRV' = 1.0; 'BFT-GW' = 1.0; 'CO2-VEH' = 1.0; 'CO1-VEH' = 1.0 } 390 'M-C2'

# ---------------------------------------------------------------- console report

function Write-Curve([string]$Title, $Rows) {
  Write-Output ''
  Write-Output $Title
  $labels = $Rows[0].labels
  Write-Output ("  {0,-16} {1,9} {2,9} {3,9}" -f 'point', 'max', 'weighted', 'noisyor')
  for ($i = 0; $i -lt $labels.Count; $i++) {
    $vm = ($Rows | Where-Object { $_.method -eq 'max' }).values[$i]
    $vw = ($Rows | Where-Object { $_.method -eq 'weighted' }).values[$i]
    $vn = ($Rows | Where-Object { $_.method -eq 'noisyor' }).values[$i]
    Write-Output ("  {0,-16} {1,9:P1} {2,9:P1} {3,9:P1}" -f $labels[$i], $vm, $vw, $vn)
  }
}

Write-Output ''
Write-Output '--- 1. MONOTONICITY (degradation must not fall as compromise grows)'
Write-Output ("  checks: {0}   violations: {1}" -f $monotonicity.Count, $monoViolations.Count)
foreach ($v in $monoViolations) {
  Write-Output ("  VIOLATION {0}/{1} {2} {3}: {4}" -f $v.scenario, $v.ladder, $v.method, $v.mission, ($v.violations | ConvertTo-Json -Compress))
}

Write-Output ''
Write-Output '--- 2. REDUNDANCY (one member down must not sink the mission)'
Write-Output ("  {0,-34} {1,-9} {2,-8} {3,8} {4,8} {5,8}" -f 'group', 'method', 'mission', 'only_a', 'only_b', 'both')
foreach ($r in $redundancy) {
  $tag = $r.group
  if ($null -ne $r.at) { $tag = ('{0} @t={1}' -f $r.group, $r.at) }
  Write-Output ("  {0,-34} {1,-9} {2,-8} {3,8:P1} {4,8:P1} {5,8:P1}" -f $tag, $r.method, $r.mission, $r.only_a, $r.only_b, $r.both)
}

Write-Curve '--- 3a. SATURATION defnet-01 additive ladder, M-C2' @($saturation | Where-Object { $_.scenario -eq 'defnet-01' -and $_.curve -eq 'additive-k' -and $_.mission -eq 'M-C2' })
Write-Curve '--- 3b. SATURATION defnet-01 level sweep (DC01=DC02=x), M-C2' @($saturation | Where-Object { $_.scenario -eq 'defnet-01' -and $_.curve -eq 'level-sweep' -and $_.mission -eq 'M-C2' })
Write-Curve '--- 3c. SATURATION tacnet-01 additive ladder @t=390, M-C2' @($saturation | Where-Object { $_.scenario -eq 'tacnet-01' -and $_.curve -eq 'additive-k@390' -and $_.mission -eq 'M-C2' })

Write-Output ''
Write-Output '--- 3d. SATURATION SUMMARY (higher mean / fewer distinct values = flatter, less useful)'
Write-Output ("  {0,-26} {1,-8} {2,-9} {3,7} {4,7} {5,6} {6,10} {7,9}" -f 'curve', 'mission', 'method', 'mean', 'range', 'dist', 'first>=.90', 'n>=.99')
foreach ($s in $saturation) {
  Write-Output ("  {0,-26} {1,-8} {2,-9} {3,7:N3} {4,7:N3} {5,6} {6,10} {7,9}" -f `
    ($s.scenario + '/' + $s.curve), $s.mission, $s.method, $s.stats.mean, $s.stats.range, $s.stats.distinct_3dp, $s.stats.first_idx_090, $s.stats.count_ge_099)
}

Write-Output ''
Write-Output '--- 4. TACNET-01 TIME AXIS (M-C2, all steps)'
Write-Output ("  {0,6} {1,9} {2,9} {3,9}  {4}" -f 't', 'max', 'weighted', 'noisyor', 'state')
foreach ($row in $timeline) {
  $st = $row.state
  if (-not $st) { $st = '(clean)' }
  Write-Output ("  {0,6} {1,9:P1} {2,9:P1} {3,9:P1}  {4}" -f $row.t, $row.'max_M-C2', $row.'weighted_M-C2', $row.'noisyor_M-C2', $st)
}
Write-Output ''
Write-Output '  resolution over the run (active steps only)'
Write-Output ("  {0,-9} {1,-8} {2,7} {3,7} {4,7} {5,6} {6,8}" -f 'method', 'mission', 'mean', 'sd', 'range', 'dist', 'n>=.99')
foreach ($ts in $timelineStats) {
  Write-Output ("  {0,-9} {1,-8} {2,7:N3} {3,7:N3} {4,7:N3} {5,6} {6,8}" -f $ts.method, $ts.mission, $ts.stats.mean, $ts.stats.sd, $ts.stats.range, $ts.stats.distinct_3dp, $ts.stats.count_ge_099)
}

Write-Output ''
Write-Output '--- 5. RANK CORRELATION (Kendall tau-b between methods, same situations)'
Write-Output ("  {0,-26} {1,-8} {2,-22} {3,5} {4,8}" -f 'set', 'level', 'pair', 'n', 'tau_b')
foreach ($rc in $rankCorrelation) {
  Write-Output ("  {0,-26} {1,-8} {2,-22} {3,5} {4,8:N4}" -f $rc.set, $rc.level, $rc.pair, $rc.n, $rc.tau_b)
}
Write-Output ''
Write-Output '  mission-order flips (only two missions per scenario, so tau is degenerate here)'
Write-Output ("  {0,-26} {1,-22} {2,9} {3,7} {4,7}" -f 'set', 'pair', 'compared', 'flips', 'ties')
foreach ($f in $orderFlips) {
  Write-Output ("  {0,-26} {1,-22} {2,9} {3,7} {4,7}" -f $f.set, $f.pair, $f.compared, $f.strict_flips, $f.tie_differences)
}

Write-Output ''
Write-Output '--- 6. EXPLAINABILITY (leave-one-out: does one named asset still account for the number)'
Write-Output ("  {0,-24} {1,-8} {2,-9} {3,7} {4,-9} {5,9} {6,9}" -f 'case', 'mission', 'method', 'base', 'top', 'top_delta', 'share')
foreach ($e in $explainability) {
  $tag = $e.scenario + '/' + $e.case
  $sh = $e.top_delta_share
  if ($null -eq $sh) { $sh = 0 }
  Write-Output ("  {0,-24} {1,-8} {2,-9} {3,7:P1} {4,-9} {5,9:P1} {6,9:P1}" -f $tag, $e.mission, $e.method, $e.base, $e.top_contributor, $e.top_delta, $sh)
}

Write-Output ''
Write-Output '  6b. drill-down consistency: mission headline vs the reddest task under it'
Write-Output '      unattributable = points where the mission number exceeds every task below it'
Write-Output ("  {0,-26} {1,-9} {2,7} {3,14} {4,10} {5,10} {6,10}" -f 'set', 'method', 'points', 'unattributable', 'max_xs_tsk', 'mean_xs_tsk', 'max_xs_trm')
foreach ($d in $drilldown) {
  Write-Output ("  {0,-26} {1,-9} {2,7} {3,14} {4,10:P1} {5,10:P1} {6,10:P1}" -f `
    $d.set, $d.method, $d.points, $d.unattributable_points, $d.max_excess_over_task, $d.mean_excess_over_task, $d.max_excess_over_term)
}

Write-Output ''
Write-Output '  6c. minimal explanation set (greedy, assets needed to reach 95% of the headline)'
Write-Output ("  {0,-28} {1,-8} {2,-9} {3,7} {4,6} {5,6}  {6}" -f 'case', 'mission', 'method', 'base', 'size', 'pool', 'assets')
foreach ($x in $explanationSets) {
  Write-Output ("  {0,-28} {1,-8} {2,-9} {3,7:P1} {4,6} {5,6}  {6}" -f `
    ($x.scenario + '/' + $x.case), $x.mission, $x.method, $x.base, $x.set_size, $x.pool_size, ($x.assets -join ','))
}

# ---------------------------------------------------------------- write JSON

function Get-Sha256([string]$Path) {
  $h = Get-FileHash -Path $Path -Algorithm SHA256
  return $h.Hash
}

$summary = [pscustomobject]@{
  monotonicity_checks    = $monotonicity.Count
  monotonicity_violations = $monoViolations.Count
  engine_calls           = $script:engineCalls
  methods                = $METHODS
}

$doc = [pscustomobject]@{
  artifact       = 'propagation-comparison'
  experiment     = 'E2'
  generated_utc  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  note           = 'Synthetic scenarios only. Deterministic engine output (ADR-0003). No detection claim (CLAUDE.md rule 11).'
  engine         = 'scripts/Invoke-MissionPropagation.ps1'
  inputs         = [pscustomobject]@{
    engine_sha256  = (Get-Sha256 $enginePath)
    defnet_sha256  = (Get-Sha256 $defnetPath)
    tacnet_sha256  = (Get-Sha256 $tacnetPath)
    defnet_attack_sha256 = (Get-Sha256 $defnetAtk)
    tacnet_attack_sha256 = (Get-Sha256 $tacnetAtk)
    time_step      = $Step
  }
  summary          = $summary
  monotonicity     = $monotonicity
  redundancy       = $redundancy
  saturation       = $saturation
  timeline         = $timeline
  timeline_stats   = $timelineStats
  rank_correlation = $rankCorrelation
  order_flips      = $orderFlips
  explainability   = $explainability
  drilldown        = $drilldown
  explanation_sets = $explanationSets
}

if (-not $NoWrite) {
  $dir = Split-Path -Parent $OutJson
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $doc | ConvertTo-Json -Depth 12 | Set-Content -Path $OutJson -Encoding utf8
  Write-Output ''
  Write-Output ("wrote {0}" -f $OutJson)
}

Write-Output ("engine invocations: {0} (cached: {1} unique)" -f $script:engineCalls, $script:engineCache.Count)
Write-Output ''
