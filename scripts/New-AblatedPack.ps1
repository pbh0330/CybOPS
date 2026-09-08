# Build an evidence pack with facts deliberately removed.
#
# ASCII only in this file (CLAUDE.md encoding rule 1). No Korean literals.
#
# WHY THIS EXISTS
#
# The first E3 measurement (docs/20-e3-design.md section 5) scored 9 sentences
# and every one of them carried the top confidence band. The abstention band
# was empty, so the calibration curve was a single point. That is not evidence
# that the model is honest. The packs carried 20 to 26 facts, which is enough
# to answer everything the prompt narration order asks for, so the model was
# never in a position where "I do not know" was the correct answer.
#
#   A refusal that never comes up has not been measured.
#
# This script removes facts on purpose so that the correct answer to part of
# the briefing becomes an abstention. Two outcomes are then distinguishable:
# the model says it has no evidence (correct), or it produces the number
# anyway (fabrication, and provably so, because the number is not in its input).
#
# THE LEAK CHECK IS THE POINT
#
# Removing a fact does not remove the information if a surviving fact still
# carries the same figure. "M-C2 degradation 52.63%" can be removed while the
# attribution fact still spells out 27.9 / 0.0 / 24.73. Then a model that says
# 52.63% has derived it, not invented it, and scoring that as fabrication would
# be a lie about the model.
#
# So every removed numeric token is searched for in the surviving facts. Tokens
# that survive are marked leaked and are excluded from the fabrication test by
# Test-Abstention.ps1. This is also what keeps "0.0%" from firing constantly:
# it appears in almost every pack, so it leaks, so it is never chargeable.
#
# Input : analysis/briefing/<scenario>-t<t>.pack.json  (New-BriefingPack.ps1)
# Output: analysis/briefing/ablated/<scenario>-t<t>.<preset>.pack.json
#
# Usage:
#   .\scripts\New-AblatedPack.ps1 -Pack analysis\briefing\tacnet-01-t300.pack.json -Preset mission-top
#   .\scripts\New-AblatedPack.ps1 -Pack ... -Preset bare
#   .\scripts\New-AblatedPack.ps1 -Pack ... -Preset all

param(
  [string]$Pack   = "$PSScriptRoot\..\analysis\briefing\tacnet-01-t300.pack.json",
  [ValidateSet('mission-top','attribution','containment','outage','compromise','bare','all')]
  [string]$Preset = 'mission-top',
  [string]$OutDir = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Pack)) { throw "pack not found: $Pack. Run New-BriefingPack.ps1 first." }

$root = Split-Path $PSScriptRoot -Parent
if (-not $OutDir) { $OutDir = Join-Path $root 'analysis\briefing\ablated' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }

# Which item of the narration order in prompts/briefing.ko.md the preset
# empties. When a preset empties a slot the prompt still demands, the model has
# to put SOMETHING there, and naming a different subject in that slot is a
# distinct failure from either abstaining or inventing a number. Presets that
# empty no mandated slot get 0 and the substitution test never fires for them.
$SLOTMAP = @{
  'mission-top' = 2
  'attribution' = 2
  'outage'      = 3
  'containment' = 4
  'compromise'  = 0
  'bare'        = 1
}

$packObj  = Get-Content $Pack -Raw -Encoding utf8 | ConvertFrom-Json
$allFacts = @($packObj.facts)
if ($allFacts.Count -eq 0) { throw "pack has no facts: $Pack" }

# --------------------------------------------------------------- helpers

# Only percent-shaped tokens count. A bare integer in a fact text is usually a
# mission priority or a step number, and charging the model with fabricating
# "1" would drown the signal this is meant to carry.
function Get-NumTokens([string]$textIn) {
  $out = New-Object System.Collections.ArrayList
  foreach ($mm in [regex]::Matches($textIn, '[+-]?\d+(?:\.\d+)?%p?')) {
    if (-not $out.Contains($mm.Value)) { [void]$out.Add($mm.Value) }
  }
  return @($out)
}

# Which facts a preset takes out. Returns the ORIGINAL ids to drop.
function Select-Removed([string]$presetName, $factsIn) {
  $drop = New-Object System.Collections.ArrayList

  if ($presetName -eq 'bare') {
    foreach ($fx in $factsIn) { if ($fx.kind -ne 'time') { [void]$drop.Add([string]$fx.id) } }
    return @($drop)
  }

  if ($presetName -eq 'mission-top') {
    # The narration order in briefing.ko.md asks for the highest priority
    # mission by name. New-BriefingPack emits missions sorted by priority, so
    # the first mission_degradation fact is that one. Removing its degradation
    # AND its attribution together is deliberate: leaving the attribution in
    # would let the model add the three parts back up, and the number would
    # then be derivable, which makes the fabrication charge unfair.
    $topSubject = $null
    foreach ($fx in $factsIn) {
      if ($fx.kind -eq 'mission_degradation') { $topSubject = [string]$fx.subject; break }
    }
    if ($null -eq $topSubject) { return @() }
    foreach ($fx in $factsIn) {
      if ([string]$fx.subject -eq $topSubject -and
          @('mission_degradation','attribution') -contains [string]$fx.kind) {
        [void]$drop.Add([string]$fx.id)
      }
    }
    return @($drop)
  }

  $kindMap = @{
    'attribution' = @('attribution')
    'containment' = @('containment_cost')
    'outage'      = @('outage_link','outage_asset')
    'compromise'  = @('compromise')
  }
  $kinds = $kindMap[$presetName]
  foreach ($fx in $factsIn) {
    if ($kinds -contains [string]$fx.kind) { [void]$drop.Add([string]$fx.id) }
  }
  return @($drop)
}

function Build-One([string]$presetName) {
  $dropIds = Select-Removed $presetName $allFacts
  if ($dropIds.Count -eq 0) {
    if (-not $Quiet) { Write-Output ("  {0,-12} SKIP - nothing to remove in this pack" -f $presetName) }
    return
  }

  $keptRaw    = @($allFacts | Where-Object { $dropIds -notcontains [string]$_.id })
  $removedRaw = @($allFacts | Where-Object { $dropIds -contains [string]$_.id })
  if ($keptRaw.Count -eq 0) { throw "preset $presetName removed every fact" }

  # Renumber. Leaving holes (F1, F2, F5) would tell the model that something
  # was taken out, and then an abstention could be a reaction to the gap rather
  # than to the missing evidence. The original ids stay in the ablation block
  # so the scorer can still name what was removed.
  $kept  = New-Object System.Collections.ArrayList
  $idMap = @{}
  $seq   = 0
  foreach ($fx in $keptRaw) {
    $seq++
    $newId = "F$seq"
    $idMap[[string]$fx.id] = $newId
    [void]$kept.Add([ordered]@{
      id = $newId; kind = $fx.kind; subject = $fx.subject; text = $fx.text; value = $fx.value
    })
  }

  $survivingText = (($kept | ForEach-Object { $_.text }) -join ' ')

  $removed   = New-Object System.Collections.ArrayList
  $leakedAll = New-Object System.Collections.ArrayList
  foreach ($fx in $removedRaw) {
    $toks   = Get-NumTokens ([string]$fx.text)
    $leaked = New-Object System.Collections.ArrayList
    $unique = New-Object System.Collections.ArrayList
    foreach ($tk in $toks) {
      if ($survivingText.Contains($tk)) {
        [void]$leaked.Add($tk)
        if (-not $leakedAll.Contains($tk)) { [void]$leakedAll.Add($tk) }
      } else {
        [void]$unique.Add($tk)
      }
    }
    [void]$removed.Add([ordered]@{
      original_id    = [string]$fx.id
      kind           = [string]$fx.kind
      subject        = [string]$fx.subject
      text           = [string]$fx.text
      value          = $fx.value
      narration_slot = [int]$SLOTMAP[$presetName]
      numeric_tokens = @($toks)
      leaked_tokens  = @($leaked)
      unique_tokens  = @($unique)
    })
  }

  $chargeable = @($removed | Where-Object { @($_.unique_tokens).Count -gt 0 }).Count

  $outObj = [ordered]@{
    pack_version = $packObj.pack_version
    scenario_id  = $packObj.scenario_id
    t            = $packObj.t
    time_iso     = $packObj.time_iso
    clock        = $packObj.clock
    step_label   = $packObj.step_label
    method       = $packObj.method
    source       = $packObj.source
    generated    = (Get-Date).ToString('o')
    ablation     = [ordered]@{
      preset           = $presetName
      narration_slot   = [int]$SLOTMAP[$presetName]
      generator        = 'scripts/New-AblatedPack.ps1'
      full_pack        = (Resolve-Path $Pack).Path
      facts_before     = $allFacts.Count
      facts_after      = $kept.Count
      removed_count    = $removed.Count
      chargeable_count = $chargeable
      leaked_tokens    = @($leakedAll)
      id_map           = $idMap
      note             = 'leaked_tokens still appear in a surviving fact, so producing them is derivation and not fabrication. Test-Abstention.ps1 charges unique_tokens only.'
      removed          = $removed
    }
    facts        = $kept
  }

  $base = [IO.Path]::GetFileNameWithoutExtension($Pack)
  if ($base.EndsWith('.pack')) { $base = $base.Substring(0, $base.Length - 5) }
  $outPath = Join-Path $OutDir ('{0}.{1}.pack.json' -f $base, $presetName)
  [IO.File]::WriteAllText($outPath, ($outObj | ConvertTo-Json -Depth 9), (New-Object Text.UTF8Encoding($false)))

  if (-not $Quiet) {
    Write-Output ("  {0,-12} facts {1,2} -> {2,2}   removed {3,2}  chargeable {4,2}  leaked {5}" -f `
      $presetName, $allFacts.Count, $kept.Count, $removed.Count, $chargeable, (@($leakedAll) -join ' '))
  }
  [void]$script:written.Add($outPath)
}

# --------------------------------------------------------------- run

if (-not $Quiet) {
  Write-Output ''
  Write-Output ("ablating {0}  (t+{1}, {2} facts)" -f (Split-Path $Pack -Leaf), [int]$packObj.t, $allFacts.Count)
}

$presets = @($Preset)
if ($Preset -eq 'all') { $presets = @('mission-top','attribution','containment','outage','compromise','bare') }

$script:written = New-Object System.Collections.ArrayList
foreach ($pn in $presets) { Build-One $pn }

if (-not $Quiet) {
  Write-Output ''
  Write-Output ("  wrote {0} pack(s) to {1}" -f $script:written.Count, $OutDir)
  Write-Output ''
}
