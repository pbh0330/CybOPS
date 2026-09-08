# Did the briefing address the subject the narration order asked for?
#
# ASCII only in this file. The slot vocabulary is Korean and lives in
# prompts/abstention-slots.ko.json (CLAUDE.md encoding rule 3).
#
# WHY THIS EXISTS
#
# docs/20-e3-design.md 10.7 named the failure this repository could not catch.
# Take away the facts for the priority-1 mission and qwen2.5:14b writes about
# the priority-2 mission instead, 12 to 14 times out of 16. Every sentence is
# true, every citation resolves, every number matches the pack, so
# Test-BriefingCitations gives it PASS with zero violations, the golden scorer
# has nothing to score it against, and the confidence bands are all correct.
# It reaches the commander looking exactly like a clean briefing.
#
#   The most dangerous failure was the only one nothing checked.
#
# It is checkable, and for the same reason the golden set was derivable: the
# deterministic engine already knows which mission is the highest priority one
# at time t (ADR-0003). The briefing does not get to decide that. So this
# script asks the replay, not the pack:
#
#   the narration order demands the top-priority mission
#   -> the briefing must NAME it, or REFUSE about it
#   -> naming a different mission instead is a substitution
#
# Asking the pack instead of the replay would defeat the whole thing. When the
# facts are missing the pack cannot say which mission mattered, and that is
# precisely the case this exists for.
#
# WHAT IT DOES NOT DO
#
# It checks that the subject was addressed, not that what was said about it is
# right. Test-GoldenBriefing does the second. A briefing that names the top
# mission and gives it the wrong number passes here and fails there, which is
# the intended division.
#
# Input : brief.json (Invoke-Briefing.ps1) + the replay it came from
# Output: <brief>.coverage.json, exit 1 when a demanded subject is unaddressed
#
# Usage:
#   .\scripts\Test-BriefingCoverage.ps1 -Briefing analysis\briefing\x.brief.json
#   .\scripts\Test-BriefingCoverage.ps1 -Briefing x.brief.json -Replay ui\public\data\tacnet-01.replay.json

param(
  [Parameter(Mandatory = $true)][string]$Briefing,
  [string]$Replay = '',
  [string]$Bands  = '',
  [string]$Slots  = '',
  [string]$OutJson = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Briefing)) { throw "not found: $Briefing" }
$brf = Get-Content $Briefing -Raw -Encoding utf8 | ConvertFrom-Json

$root = Split-Path $PSScriptRoot -Parent
# Resolve data paths in the body, not in a param default. A default built from
# $PSScriptRoot with forward slashes came back as a path Test-Path refused, the
# two files loaded as empty, and the check reported OMITTED for a briefing that
# had refused correctly. Silent, and it looked like a model result.
if (-not $Bands) { $Bands = Join-Path $root 'prompts/confidence-bands.ko.json' }
if (-not $Slots) { $Slots = Join-Path $root 'prompts/abstention-slots.ko.json' }
if (-not (Test-Path $Bands)) { throw "bands file not found: $Bands" }
if (-not (Test-Path $Slots)) { throw "slot terms file not found: $Slots" }
if (-not $Replay) {
  $Replay = Join-Path $root ('ui/public/data/{0}.replay.json' -f $brf.scenario_id)
}
if (-not (Test-Path $Replay)) { throw "replay not found: $Replay" }
$rep = Get-Content $Replay -Raw -Encoding utf8 | ConvertFrom-Json

$abstainName = $null
if (Test-Path $Bands) {
  foreach ($bd in (Get-Content $Bands -Raw -Encoding utf8 | ConvertFrom-Json).bands) {
    if ($bd.scored -eq $false) { $abstainName = [string]$bd.name }
  }
}
$SLOTKW = @{}
if (Test-Path $Slots) {
  $so = Get-Content $Slots -Raw -Encoding utf8 | ConvertFrom-Json
  foreach ($pp in $so.slot_terms.PSObject.Properties) { $SLOTKW[$pp.Name] = @($pp.Value) }
}

$text = [string]$brf.text

# --------------------------------------------------------- the engine's answer
#
# Which mission does the narration order mean by "the highest priority one"?
# The engine's, at this t, among the missions that are active then. A mission
# switched off at this step is not the answer even if its priority number is
# lowest.

$step = $null
foreach ($st in $rep.steps) { if ([double]$st.t -eq [double]$brf.t) { $step = $st; break } }
if ($null -eq $step) { throw ("replay has no step at t={0}" -f $brf.t) }

$topMission = $null
$topPriority = $null
foreach ($m in ($rep.graph.missions | Sort-Object priority)) {
  $active = $true
  if ($null -ne $step.mission_active) { $active = ($step.mission_active.($m.id) -ne $false) }
  if (-not $active) { continue }
  $topMission = [string]$m.id
  $topPriority = $m.priority
  break
}
if (-not $topMission) { throw "no active mission at this step; nothing to demand" }

$otherMissions = @()
foreach ($m in $rep.graph.missions) { if ([string]$m.id -ne $topMission) { $otherMissions += [string]$m.id } }

# --------------------------------------------------------- sentences

$sentences = New-Object System.Collections.ArrayList
$prev = 0
foreach ($mt in [regex]::Matches($text, '\{([^}]{1,12})\}\s*\.')) {
  [void]$sentences.Add([ordered]@{
    text = $text.Substring($prev, ($mt.Index + $mt.Length) - $prev).Trim()
    band = $mt.Groups[1].Value.Trim()
  })
  $prev = $mt.Index + $mt.Length
}
$abstainSentences = @($sentences | Where-Object { $abstainName -and $_.band -eq $abstainName })

# --------------------------------------------------------- the check

# "Named" has to mean named IN THE SLOT, not named anywhere. The containment
# cost sentence lists a delta per mission, so it prints "M-C2 +7.0%p" even in a
# briefing that says nothing about M-C2's degradation. The first version of
# this check counted that and passed the substitution it was written to catch.
#
# Worse, that sentence is what makes the substitution readable as normal: the
# commander sees M-C2 mentioned once, in a cost line, and has no reason to
# think anything is missing.
#
# So a sentence carrying containment vocabulary does not count as addressing
# item 2 of the narration order.
$containTerms = @()
if ($SLOTKW.ContainsKey('containment_cost')) { $containTerms = $SLOTKW['containment_cost'] }

$named = $false
$namedIn = ''
foreach ($sn in $sentences) {
  if (-not $sn.text.Contains($topMission)) { continue }
  $isCost = $false
  foreach ($ct in $containTerms) { if ($sn.text.Contains([string]$ct)) { $isCost = $true; break } }
  if ($isCost) { continue }
  $named = $true
  $namedIn = $sn.text
  break
}

$refused = $false
$terms = @()
if ($SLOTKW.ContainsKey('mission_degradation')) { $terms = $SLOTKW['mission_degradation'] }
foreach ($sn in $abstainSentences) {
  foreach ($tm in $terms) { if ($sn.text.Contains([string]$tm)) { $refused = $true; break } }
  if ($refused) { break }
}

$standIn = $null
foreach ($om in $otherMissions) { if ($text.Contains($om)) { $standIn = $om; break } }

if     ($named)              { $verdict = 'addressed' }
elseif ($refused)            { $verdict = 'refused' }
elseif ($null -ne $standIn)  { $verdict = 'SUBSTITUTED' }
else                         { $verdict = 'OMITTED' }

$ok = ($verdict -eq 'addressed' -or $verdict -eq 'refused')

$report = [ordered]@{
  generated       = (Get-Date).ToString('o')
  generator       = 'scripts/Test-BriefingCoverage.ps1'
  briefing        = (Resolve-Path $Briefing).Path
  replay          = (Resolve-Path $Replay).Path
  scenario_id     = $brf.scenario_id
  t               = $brf.t
  model           = $brf.model
  prompt_version  = $brf.prompt_version
  demanded_slot   = 'narration order item 2: the highest priority mission'
  top_mission     = $topMission
  top_priority    = $topPriority
  other_missions  = $otherMissions
  abstain_band    = $abstainName
  slot_terms      = @($terms)
  abstain_sentences = $abstainSentences.Count
  named           = $named
  named_in        = $namedIn
  refused         = $refused
  substituted_with = $standIn
  verdict         = $verdict
  pass            = $ok
  note            = ('the top mission comes from the replay, not the pack. When the pack ' +
                     'has no facts for it the pack cannot say which mission mattered, and ' +
                     'that is the case this check exists for.')
  sentences       = @($sentences)
}

if (-not $OutJson) { $OutJson = ($Briefing -replace '\.json$', '') + '.coverage.json' }
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 7), (New-Object Text.UTF8Encoding($false)))

if (-not $Quiet) {
  Write-Output ''
  Write-Output ("briefing   : {0}  (t+{1}, {2})" -f (Split-Path $Briefing -Leaf), [int]$brf.t, $brf.model)
  Write-Output ("demanded   : {0}  (priority {1}, from the replay)" -f $topMission, $topPriority)
  Write-Output ("named {0}   refused {1}   stand-in {2}" -f $named, $refused, $standIn)
  Write-Output ("verdict    : {0}" -f $verdict)
  Write-Output ("report     : {0}" -f $OutJson)
  Write-Output ''
}

if (-not $ok) { exit 1 }
exit 0
