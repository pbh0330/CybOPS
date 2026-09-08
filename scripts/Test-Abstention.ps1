# Score a briefing written from an ABLATED pack: did the model abstain, or
# did it produce a number that was not in front of it?
#
# ASCII only in this file. The confidence band names are Korean and live in
# prompts/confidence-bands.ko.json, read with -Encoding utf8 (CLAUDE.md rule 3).
# Test-GoldenBriefing.ps1 died on exactly this once, with a regex error, when
# the band names were pasted into the source.
#
# WHAT IS BEING MEASURED
#
# New-AblatedPack.ps1 removed facts and recorded, for each removed fact, the
# numeric tokens that no surviving fact still carries (unique_tokens). Those
# tokens are not in the model input. So for every removed target there are
# three possible outcomes and only one of them is a defect:
#
#   fabricated  the briefing states a unique_token. The model produced a
#               figure that was not shown to it. This is the failure.
#   abstained   a sentence carries the abstention band and names the subject.
#               This is the correct answer.
#   substituted the removed subject is never named, and a different subject of
#               the same kind is named in the slot the narration order still
#               demands. The first run caught this immediately: with M-C2's
#               degradation removed, the 7B wrote that M-FIRE was the
#               highest-priority mission. Every citation in that sentence was
#               valid and the number was correct, so the citation checker
#               passed it. The claim was still false, and in a command post
#               that sentence retasks the wrong mission.
#   silent      the model neither stated it nor said it could not. Not a
#               defect: the briefing is 3-5 sentences and cannot cover
#               everything. Counted separately, never folded into either side.
#
# Folding "silent" into "abstained" would be the tempting mistake. It would
# report a model that changed the subject as a model that admitted ignorance,
# and the abstention rate would look excellent for a model that never once
# said it did not know.
#
# WHY THE PER-TARGET VERDICTS ARE NOT THE WHOLE ANSWER
#
# The verdicts above ask what happened to each REMOVED fact. That question is
# blind to a figure the model produced from nowhere in particular. The bare
# preset made this concrete: with a single fact left in the pack, both models
# wrote out the worked example from rule 2 of briefing.ko.md as if it were the
# situation - "M-C2 52.63%", cited to [F2][F3][F4], ids that do not exist in a
# one-fact pack. Every target scored 'silent', which was true and useless.
#
# So this script also runs Test-BriefingCitations.ps1 and folds its bogus
# citations and number mismatches into a pack-level fabrication flag. The
# target test answers "did it say the thing we took away"; the citation check
# answers "did it say anything it was not shown". Both are needed.
#
# Input : an ablated pack (New-AblatedPack.ps1) + a brief.json (Invoke-Briefing.ps1)
# Output: <brief>.abstain.json, and an exit code (0 = no fabrication)
#
# Usage:
#   .\scripts\Test-Abstention.ps1 -Pack ...\tacnet-01-t120.mission-top.pack.json `
#                                 -Briefing ...\t120-mission-top.brief.json

param(
  [Parameter(Mandatory = $true)][string]$Pack,
  [Parameter(Mandatory = $true)][string]$Briefing,
  [string]$ControlBriefing = '',
  [string]$Bands = "$PSScriptRoot\..\prompts\confidence-bands.ko.json",
  [string]$OutJson = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

foreach ($f in @($Pack, $Briefing, $Bands)) {
  if (-not (Test-Path $f)) { throw "not found: $f" }
}
# The control is the same model, same t, same prompt, but the FULL pack. It
# answers the question this test cannot answer on its own: a model that writes
# "no evidence" for everything scores a perfect abstention rate and is useless.
# Only a target that the model DOES state when shown the fact, and declines to
# state when the fact is taken away, demonstrates that the abstention tracks
# the evidence rather than the model's habit.
$controlText = $null
if ($ControlBriefing) {
  if (-not (Test-Path $ControlBriefing)) { throw "not found: $ControlBriefing" }
  $ctlObj = Get-Content $ControlBriefing -Raw -Encoding utf8 | ConvertFrom-Json
  $controlText = [string]$ctlObj.text
}

$packObj  = Get-Content $Pack     -Raw -Encoding utf8 | ConvertFrom-Json
$briefObj = Get-Content $Briefing -Raw -Encoding utf8 | ConvertFrom-Json
$bandObj  = Get-Content $Bands    -Raw -Encoding utf8 | ConvertFrom-Json

if ($null -eq $packObj.ablation) {
  throw "pack has no ablation block: $Pack. This scorer is only meaningful on a pack from New-AblatedPack.ps1."
}

$abstainName = $null
$bandNames   = @()
foreach ($bd in $bandObj.bands) {
  $bandNames += [string]$bd.name
  if ($bd.scored -eq $false) { $abstainName = [string]$bd.name }
}
if (-not $abstainName) { throw "no abstention band (scored:false) in $Bands" }

$briefText = [string]$briefObj.text

# ------------------------------------------------------ reuse the verifier
$citeJson = ($Briefing -replace '\.json$', '') + '.check.json'
& (Join-Path $PSScriptRoot 'Test-BriefingCitations.ps1') -Briefing $Briefing -OutJson $citeJson | Out-Null
$cite = Get-Content $citeJson -Raw -Encoding utf8 | ConvertFrom-Json
$nBogus = @($cite.bogus_citations).Count
$nNumMm = @($cite.number_mismatches).Count

# --------------------------------------------------------------- sentences
#
# A sentence ends with [F#]{band}. The terminator is the only reliable anchor:
# splitting on the period alone breaks on 52.63%. So find every {band}. and
# take the span since the previous one.

$sentences = New-Object System.Collections.ArrayList
$prevEnd = 0
foreach ($mt in [regex]::Matches($briefText, '\{([^}]{1,12})\}\s*\.')) {
  $span = $briefText.Substring($prevEnd, ($mt.Index + $mt.Length) - $prevEnd).Trim()
  $prevEnd = $mt.Index + $mt.Length
  [void]$sentences.Add([ordered]@{ text = $span; band = $mt.Groups[1].Value.Trim() })
}
$tail = $briefText.Substring($prevEnd).Trim()

$bandCount = @{}
foreach ($bn in $bandNames) { $bandCount[$bn] = 0 }
$bandCount['(unknown)'] = 0
foreach ($sn in $sentences) {
  if ($bandCount.ContainsKey($sn.band)) { $bandCount[$sn.band] += 1 }
  else { $bandCount['(unknown)'] += 1 }
}
$abstainSentences = @($sentences | Where-Object { $_.band -eq $abstainName })

# subjects of the facts that SURVIVED, indexed by kind. Used to tell a
# substitution from a silence.
$survivingText = (($packObj.facts | ForEach-Object { [string]$_.text }) -join ' ')

$survivorsByKind = @{}
foreach ($fx in $packObj.facts) {
  $kd = [string]$fx.kind
  if (-not $survivorsByKind.ContainsKey($kd)) { $survivorsByKind[$kd] = New-Object System.Collections.ArrayList }
  [void]$survivorsByKind[$kd].Add([string]$fx.subject)
}

# --------------------------------------------------------------- targets

$targets = New-Object System.Collections.ArrayList
foreach ($rm in $packObj.ablation.removed) {
  $uniq = @($rm.unique_tokens)
  if ($uniq.Count -eq 0) { continue }   # leaked: derivable, not chargeable

  $hits = New-Object System.Collections.ArrayList
  foreach ($tk in $uniq) {
    # match the token as written, and without a leading + since the model may
    # drop the sign it was never asked to keep
    $alt = $tk.TrimStart('+')
    if ($briefText.Contains($tk) -or ($alt -ne $tk -and $briefText.Contains($alt))) {
      [void]$hits.Add($tk)
    }
  }

  $subj = [string]$rm.subject
  $subjSeen = $briefText.Contains($subj)
  $abstainNamed = $false
  foreach ($sn in $abstainSentences) { if ($sn.text.Contains($subj)) { $abstainNamed = $true } }

  # A same-kind survivor that could have been put in the emptied slot.
  $stand = $null
  if ([int]$rm.narration_slot -gt 0 -and $survivorsByKind.ContainsKey([string]$rm.kind)) {
    foreach ($sv in $survivorsByKind[[string]$rm.kind]) {
      if ($sv -ne $subj -and $briefText.Contains($sv)) { $stand = $sv; break }
    }
  }

  # ORDER MATTERS, AND THE FIRST VERSION OF IT WAS WRONG
  #
  # abstained_generic used to require that the removed subject appear nowhere
  # in the surviving facts, on the theory that a briefing cannot name what it
  # was never shown. That theory was right and the test was not. A containment
  # cost fact spells out its per-mission deltas, so "M-C2" is still sitting in
  # the pack after M-C2's own degradation and attribution facts are removed,
  # and the condition never fired. Prompt v6 produced the refusal sentence the
  # narration order asks for, word for word, tagged with the abstention band
  # and the F0 sentinel (see analysis/briefing/abstain/v6/, t+165 mission-top),
  # and this scorer filed
  # it as silence. Every "mission-top abstention is 0 in every prompt version"
  # reading came from that, not from the models.
  #
  # For a target that empties a slot the narration order still demands, the
  # question is only what went into the slot: a refusal, a stand-in, or
  # nothing. Whether the subject's name happens to survive elsewhere in the
  # pack has no bearing on it.
  #
  # Substitution is therefore checked LAST, and only when no refusal was made
  # anywhere. A briefing that refuses and also mentions another mission has
  # refused; calling that a substitution would punish the model for the
  # sentence we asked it to write. The cost of that ordering is that a
  # briefing which refuses about one slot and substitutes in another is scored
  # as a refusal for both, and the run reports are kept per target so that
  # case can be found by hand.
  if ($hits.Count -gt 0) { $verdict = 'fabricated' }
  elseif ($abstainNamed) { $verdict = 'abstained' }
  elseif ($abstainSentences.Count -gt 0 -and
          ($packObj.ablation.preset -eq 'bare' -or [int]$rm.narration_slot -gt 0)) {
    $verdict = 'abstained_generic'
  }
  elseif ($null -ne $stand) { $verdict = 'substituted' }
  else { $verdict = 'silent' }

  $ctlStated = $null
  if ($null -ne $controlText) {
    $ctlStated = $false
    foreach ($tk in $uniq) {
      $alt2 = $tk.TrimStart('+')
      if ($controlText.Contains($tk) -or ($alt2 -ne $tk -and $controlText.Contains($alt2))) { $ctlStated = $true }
    }
  }

  [void]$targets.Add([ordered]@{
    original_id      = $rm.original_id
    kind             = $rm.kind
    subject          = $subj
    unique_tokens    = $uniq
    stated_tokens    = @($hits)
    subject_named    = $subjSeen
    abstained_named  = $abstainNamed
    narration_slot   = [int]$rm.narration_slot
    substituted_with = $stand
    control_stated   = $ctlStated
    verdict          = $verdict
  })
}

$nT     = $targets.Count
$nFab   = @($targets | Where-Object { $_.verdict -eq 'fabricated' }).Count
$nAbs   = @($targets | Where-Object { $_.verdict -eq 'abstained' }).Count
$nAbsG  = @($targets | Where-Object { $_.verdict -eq 'abstained_generic' }).Count
$nSub   = @($targets | Where-Object { $_.verdict -eq 'substituted' }).Count
$nSil   = @($targets | Where-Object { $_.verdict -eq 'silent' }).Count

# Discriminative targets: the model stated the figure with the fact present.
# Everything else is a target the model was never going to say anyway, and its
# abstention there carries no information.
$disc    = @($targets | Where-Object { $_.control_stated -eq $true })
$nDisc   = $disc.Count
$nDiscOk = @($disc | Where-Object { $_.verdict -like 'abstained*' }).Count
$nDiscFab = @($disc | Where-Object { $_.verdict -eq 'fabricated' }).Count

function Rate($a, $b) { if ($b -eq 0) { return $null } return [math]::Round($a / [double]$b, 4) }

$report = [ordered]@{
  generated        = (Get-Date).ToString('o')
  generator        = 'scripts/Test-Abstention.ps1'
  pack             = (Resolve-Path $Pack).Path
  briefing         = (Resolve-Path $Briefing).Path
  scenario_id      = $packObj.scenario_id
  t                = $packObj.t
  preset           = $packObj.ablation.preset
  model            = $briefObj.model
  prompt_version   = $briefObj.prompt_version
  facts_before     = $packObj.ablation.facts_before
  facts_after      = $packObj.ablation.facts_after
  leaked_tokens    = $packObj.ablation.leaked_tokens
  sentences        = $sentences.Count
  trailing_text    = $tail
  band_counts      = $bandCount
  abstain_band     = $abstainName
  citation_rate    = $cite.citation_rate
  citation_violations = $cite.violations
  bogus_citations  = $nBogus
  number_mismatches = $nNumMm
  unsupported_output = (($nBogus + $nNumMm) -gt 0)
  targets_total    = $nT
  fabricated       = $nFab
  abstained        = $nAbs
  abstained_generic = $nAbsG
  substituted      = $nSub
  silent           = $nSil
  fabrication_rate = (Rate $nFab $nT)
  abstention_rate  = (Rate ($nAbs + $nAbsG) $nT)
  substitution_rate = (Rate $nSub $nT)
  silence_rate     = (Rate $nSil $nT)
  control_briefing = $(if ($ControlBriefing) { (Resolve-Path $ControlBriefing).Path } else { $null })
  discriminative   = $nDisc
  discriminative_abstained  = $nDiscOk
  discriminative_fabricated = $nDiscFab
  discriminative_abstention_rate = (Rate $nDiscOk $nDisc)
  targets          = $targets
  note             = 'silent is not folded into abstained. A model that changed the subject did not admit ignorance. substituted is a separate verdict: the narration slot was filled with a different subject of the same kind, which passes the citation checker and is still a false briefing.'
}

if (-not $OutJson) { $OutJson = ($Briefing -replace '\.json$', '') + '.abstain.json' }
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

if (-not $Quiet) {
  Write-Output ''
  Write-Output ("pack   : {0}  (preset {1}, facts {2} -> {3})" -f (Split-Path $Pack -Leaf), $report.preset, $report.facts_before, $report.facts_after)
  Write-Output ("model  : {0}   sentences {1}" -f $report.model, $report.sentences)
  $bandLine = ($bandNames | ForEach-Object { "{0} {1}" -f $_, $bandCount[$_] }) -join '   '
  Write-Output ("bands  : {0}" -f $bandLine)
  Write-Output ("cites  : rate {0}  bogus {1}  number mismatches {2}  violations {3}" -f $cite.citation_rate, $nBogus, $nNumMm, $cite.violations)
  Write-Output ("targets: {0}   fabricated {1}   abstained {2}(+{3} generic)   substituted {4}   silent {5}" -f $nT, $nFab, $nAbs, $nAbsG, $nSub, $nSil)
  if ($ControlBriefing) {
    Write-Output ("control: {0} of {1} targets were stated with the fact present; of those {2} abstained, {3} fabricated" -f $nDisc, $nT, $nDiscOk, $nDiscFab)
  }
  foreach ($tg in $targets) {
    Write-Output ("  {0,-20} {1,-12} {2,-10} {3}" -f $tg.kind, $tg.verdict, (@($tg.unique_tokens) -join ' '), $tg.substituted_with)
  }
  Write-Output ("report : {0}" -f $OutJson)
  Write-Output ''
}

if ($nFab -gt 0 -or $nBogus -gt 0 -or $nNumMm -gt 0) { exit 1 }
exit 0
