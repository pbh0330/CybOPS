# E3 step 3: score a briefing against the golden set.
#
# ASCII ONLY IN THIS FILE. Korean strings live in prompts/*.ko.json.
#
# WHAT THIS ADDS OVER Test-BriefingCitations.ps1
#
# That script asks whether the briefing is well formed and honest about its
# evidence: does every sentence cite, are the citations real, do the numbers
# match the pack, is an unknown cause narrated as an attack. All necessary, none
# of it is accuracy - a briefing can pass every one of those checks and still
# state the wrong mission.
#
# This one asks the other question. The golden set (eval/golden/) holds what the
# deterministic engine computed for that scenario and time, so "is the briefing
# right" has an answer that can be looked up rather than judged.
#
# CALIBRATION IS THE POINT
#
# docs/04-evaluation.md 2.3 calls calibration the most important metric, and
# until prompt v3 it could not be computed at all because the model was never
# asked how sure it was. Now each sentence ends with one of three confidence
# bands (names in prompts/confidence-bands.ko.json), so the accuracy of each
# band is measurable and ECE follows.
#
# Three bands make a coarse ECE. That is deliberate: a free 0-100 number gets
# answered 90, 95, 99 and measures phrasing rather than calibration
# (prompts/briefing.ko.md, "why three bands").
#
# ABSTENTION IS NOT A FAILURE
#
# A sentence tagged with the abstention band is counted separately, never as an
# error. A model
# that says it does not know is behaving as rule 4 asks. Scoring it as wrong
# would train the next prompt revision to remove the option.
#
# Usage:
#   .\scripts\Test-GoldenBriefing.ps1 -Briefing analysis\briefing\v3-tacnet-01-t300.json
#   .\scripts\Test-GoldenBriefing.ps1 -Glob 'analysis\briefing\v3-*.json' -OutJson eval\results\e3-golden.json

param(
  [string]$Briefing = '',
  [string]$Glob     = "$PSScriptRoot\..\analysis\briefing\v3-*.json",
  [string]$GoldenDir = "$PSScriptRoot\..\eval\golden",
  [string]$Bands    = "$PSScriptRoot\..\prompts\confidence-bands.ko.json",
  [string]$OutJson  = "$PSScriptRoot\..\eval\results\e3-golden.json"
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$files = if ($Briefing) { @($Briefing) } else { @(Get-ChildItem $Glob -File | ForEach-Object { $_.FullName }) }
if ($files.Count -eq 0) { throw "no briefings matched" }

# ---------------------------------------------------------------- golden index
# Keyed by scenario and t so a briefing can find the facts that were true when
# it was written. Only the tasks whose answers appear in a briefing are loaded;
# containment has 346 items and a briefing mentions at most one.

$golden = @{}
foreach ($task in @('summary', 'cause', 'query', 'containment')) {
  $dir = Join-Path $GoldenDir $task
  if (-not (Test-Path $dir)) { continue }
  foreach ($f in (Get-ChildItem $dir -Filter *.jsonl -File)) {
    foreach ($line in (Get-Content $f.FullName -Encoding utf8)) {
      if (-not $line.Trim()) { continue }
      $o = $line | ConvertFrom-Json
      $k = "{0}|{1}" -f $o.scenario, $o.t
      if (-not $golden.ContainsKey($k)) { $golden[$k] = New-Object System.Collections.ArrayList }
      [void]$golden[$k].Add($o)
    }
  }
}

# $BANDCONF, not $BAND. $band holds the matched band name a few lines below and
# PowerShell variables are case insensitive, so $BAND was overwritten by a
# string on the first tagged sentence - every lookup after that returned null,
# [double]null became 0, and ECE was computed against a stated confidence of
# zero. It printed 0.8333 for a model that was right 83% of the time.
#
# This is the THIRD time this exact bug has appeared in this repo today:
# $T/$t in New-GoldenSet.ps1, $l/$L in New-BriefingPack.ps1, $BAND/$band here.
# Short or all-caps names are not safe; only names that differ by more than case
# are.
#
# Band names are Korean, so they live in a JSON data file and are read with
# -Encoding utf8. Putting them inline killed the first version of this script:
# PowerShell 5.1 read the ASCII-only source with the system ANSI codepage and
# the regex became "Unrecognized grouping construct" (CLAUDE.md rule 1 and 3).
$bandCfg = Get-Content $Bands -Raw -Encoding utf8 | ConvertFrom-Json
$BANDCONF = [ordered]@{}
$BANDNAMES = @()
$BANDSCORED = @{}
foreach ($b in $bandCfg.bands) {
  $BANDCONF[[string]$b.name] = [double]$b.stated_confidence
  $BANDNAMES += [string]$b.name
  $BANDSCORED[[string]$b.name] = [bool]$b.scored
}
$bandPattern = '\{(' + (($BANDNAMES | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')\}'

$rows = New-Object System.Collections.ArrayList
$agg = [ordered]@{
  sentences = 0; tagged = 0; untagged = 0
  correct = 0; wrong = 0; abstain = 0
  by_band = @{}
}
foreach ($b in $BANDCONF.Keys) { $agg.by_band[$b] = [ordered]@{ n = 0; correct = 0; wrong = 0 } }

foreach ($file in $files) {
  $br = Get-Content $file -Raw -Encoding utf8 | ConvertFrom-Json
  $sid = [string]$br.scenario_id
  $t   = if ($null -ne $br.t) { [int]$br.t } else { -1 }
  $key = "{0}|{1}" -f $sid, $t
  $facts = @($golden[$key])

  # Every number the engine says is true at this instant. A briefing number that
  # is not in here is wrong; the engine owns the numbers (ADR-0003).
  # Compared as NUMBERS, not as strings. The golden set writes 100.0% and the
  # model writes 100%; a string match calls that wrong and the whole score
  # collapses to zero correct - which is what the first version reported.
  # Test-BriefingCitations.ps1 already normalises before comparing and this has
  # to agree with it, or the two scripts disagree about the same briefing.
  $truth = New-Object System.Collections.ArrayList
  foreach ($g in $facts) {
    foreach ($m in @($g.must_contain)) {
      if (-not $m) { continue }
      $v = 0.0
      if ([double]::TryParse(([string]$m -replace '%', ''), [ref]$v)) { [void]$truth.Add($v) }
    }
  }
  $forbidden = New-Object System.Collections.ArrayList
  foreach ($g in $facts) {
    foreach ($m in @($g.must_not_say)) { if ($m) { [void]$forbidden.Add([string]$m) } }
  }

  $text = [string]$br.text
  $sentences = @($text -split '(?<=\.)\s+' | Where-Object { $_.Trim() })

  foreach ($s in $sentences) {
    $agg.sentences++
    $mb = [regex]::Match($s, $bandPattern)
    if (-not $mb.Success) {
      $agg.untagged++
      [void]$rows.Add([ordered]@{ file = (Split-Path $file -Leaf); sentence = $s.Trim(); band = $null; verdict = 'untagged' })
      continue
    }
    $agg.tagged++
    $band = $mb.Groups[1].Value

    if (-not $BANDSCORED[$band]) {
      $agg.abstain++
      $agg.by_band[$band].n++
      [void]$rows.Add([ordered]@{ file = (Split-Path $file -Leaf); sentence = $s.Trim(); band = $band; verdict = 'abstain' })
      continue
    }

    # A sentence is judged on the numbers it asserts. No number to check means
    # nothing to be wrong about here - narrative quality is not this script's
    # question and docs/20 section 4 says so.
    $nums = @([regex]::Matches($s, '\d+(?:\.\d+)?%') | ForEach-Object { $_.Value })
    # 1e-6 because these are percentages the engine rounded to six decimals;
    # anything looser would let a genuinely different number pass.
    $bad = @($nums | Where-Object {
      $v = 0.0
      if (-not [double]::TryParse(($_ -replace '%', ''), [ref]$v)) { return $true }
      -not ($truth | Where-Object { [math]::Abs($_ - $v) -lt 1e-6 })
    })
    $said = @($forbidden | Where-Object { $s.Contains($_) })

    $verdict = if ($said.Count -gt 0) { 'forbidden' }
               elseif ($bad.Count -gt 0) { 'wrong' }
               elseif ($nums.Count -gt 0) { 'correct' }
               else { 'no-number' }

    $agg.by_band[$band].n++
    if ($verdict -eq 'correct') { $agg.correct++; $agg.by_band[$band].correct++ }
    elseif ($verdict -in @('wrong', 'forbidden')) { $agg.wrong++; $agg.by_band[$band].wrong++ }

    [void]$rows.Add([ordered]@{
      file = (Split-Path $file -Leaf); sentence = $s.Trim(); band = $band
      verdict = $verdict; numbers = $nums; unmatched = $bad; forbidden_hit = $said
    })
  }
}

# ---------------------------------------------------------------- calibration
# ECE over the three bands, and Brier over the same. Sentences with no number to
# check are excluded from both: they are neither right nor wrong, and counting
# them as either would move the score without measuring anything.

$ece = 0.0; $brier = 0.0; $nCal = 0
$bandRows = New-Object System.Collections.ArrayList
foreach ($b in $BANDNAMES) {
  $n = $agg.by_band[$b].n
  $c = $agg.by_band[$b].correct
  $w = $agg.by_band[$b].wrong
  $scored = $c + $w
  # [double] on both sides. Without the cast $acc stayed $null in the first
  # version and Abs($null - 0.95) came out 0, which reported a perfect ECE of
  # 0.0000 for a band that was wrong six times out of six. A calibration metric
  # that reads perfect when the model is always wrong is worse than none.
  $acc = if ($scored -gt 0) { [double]$c / [double]$scored } else { $null }
  $conf = [double]$BANDCONF[$b]
  if ($scored -gt 0 -and $BANDSCORED[$b]) {
    $ece += $scored * [math]::Abs([double]$acc - $conf)
    $brier += $c * [math]::Pow(1 - $conf, 2) + $w * [math]::Pow(0 - $conf, 2)
    $nCal += $scored
  }
  [void]$bandRows.Add([ordered]@{ band = $b; stated_confidence = $conf; n = $n; scored = $scored; correct = $c; wrong = $w; accuracy = $acc })
}
if ($nCal -gt 0) { $ece = $ece / $nCal; $brier = $brier / $nCal } else { $ece = $null; $brier = $null }

Write-Output ''
Write-Output 'E3 golden scoring'
Write-Output ('-' * 74)
Write-Output ("  briefings          : {0}" -f $files.Count)
Write-Output ("  sentences          : {0}   tagged {1}, untagged {2}" -f $agg.sentences, $agg.tagged, $agg.untagged)
Write-Output ("  correct / wrong    : {0} / {1}" -f $agg.correct, $agg.wrong)
Write-Output ("  abstentions        : {0}   (not counted as errors)" -f $agg.abstain)
Write-Output ''
Write-Output ("  {0,-10} {1,10} {2,5} {3,7} {4,7} {5,9}" -f 'band', 'stated', 'n', 'correct', 'wrong', 'accuracy')
foreach ($r in $bandRows) {
  $a = if ($null -ne $r.accuracy) { '{0:P1}' -f $r.accuracy } else { '-' }
  Write-Output ("  {0,-10} {1,10:P0} {2,5} {3,7} {4,7} {5,9}" -f $r.band, $r.stated_confidence, $r.n, $r.correct, $r.wrong, $a)
}
Write-Output ''
if ($null -ne $ece) {
  Write-Output ("  ECE   {0:N4}   (3 bands, coarse by design)" -f $ece)
  Write-Output ("  Brier {0:N4}" -f $brier)
} else {
  Write-Output '  ECE/Brier: not computable - no sentence carried a checkable number'
}
Write-Output ''
if ($agg.untagged -gt 0) {
  Write-Output ("  {0} sentence(s) had no confidence tag. Prompt v3 makes the tag part of the" -f $agg.untagged)
  Write-Output '  sentence terminator, so this should be zero; if it is not, the model is'
  Write-Output '  ignoring the output format and the calibration numbers are on partial data.'
  Write-Output ''
}

$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$report = [ordered]@{
  generated  = (Get-Date).ToString('o')
  generator  = 'scripts/Test-GoldenBriefing.ps1'
  experiment = 'E3'
  refs       = @('docs/04-evaluation.md 2.3', 'docs/20-e3-design.md', 'ADR-0009')
  briefings  = @($files | ForEach-Object { Split-Path $_ -Leaf })
  golden_dir = (Resolve-Path $GoldenDir).Path
  band_confidence = $BANDCONF
  totals     = $agg
  bands      = @($bandRows)
  ece        = $ece
  brier      = $brier
  abstention_note = 'abstentions are counted separately and never as errors; scoring them wrong would train the option out of the prompt'
  scope_note = 'this measures whether the stated numbers are the engine numbers. whether the briefing is USEFUL is not measured (docs/20 section 4, ADR-0015)'
  sentences  = @($rows)
}
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
