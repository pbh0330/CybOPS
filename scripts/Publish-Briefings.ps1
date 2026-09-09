# Generate the briefings the bundle ships, and refuse to ship a bad one.
#
# ASCII only in this file.
#
# ADR-0022. Verification is a step of publishing, not a report written next to
# it. Before this script the briefings in ui/public/data were copied there by
# hand and nothing stood between generation and the bundle.
#
# The failure that forced it: with the priority-1 mission's facts missing, a
# model writes about the priority-2 mission instead. Every sentence true, every
# citation valid, so Test-BriefingCitations returns PASS. What is absent is any
# statement that the top mission is unknown, and the containment-cost line
# mentions it once in passing, which makes the gap read as "nothing to report".
# Test-BriefingCoverage catches that; nothing else does.
#
# RETRY IS A PUBLISHING TOOL AND NEVER AN EVALUATION TOOL
#
# This script regenerates a briefing that fails, up to -Attempts times. That is
# legitimate here: publishing is choosing an artifact, and the choice is honest
# as long as it is recorded (each published briefing carries the attempt number
# it came from).
#
# It would not be legitimate in evaluation. Compare-BriefingModels.ps1,
# Invoke-AbstentionProbe.ps1 and Invoke-InjectionProbe.ps1 generate once and
# score what they get, and none of them has a retry option. Do not use this
# script to produce evaluation numbers.
#
# Input : the replay, the prompt, a model
# Output: ui/public/data/<scenario>-t<t>.brief.json and .pack.json for the
#         timesteps that passed, plus eval/results/briefing-publish.json
#
# Usage:
#   .\scripts\Publish-Briefings.ps1
#   .\scripts\Publish-Briefings.ps1 -Times 120,300,390 -Model qwen2.5:7b-instruct-q4_K_M
#   .\scripts\Publish-Briefings.ps1 -DryRun        # check without touching the bundle

param(
  [string]$Replay   = '',
  [int[]]$Times     = @(120, 300, 390),

  # ADR-0022: gemma2 is the default because the two checks below now gate the
  # bundle. Its failure modes (ghost citations, substitution) are the ones the
  # checks catch; its advantage (fact accuracy 74-75% against 50% for the 7b)
  # is the one they cannot supply.
  [string]$Model    = 'gemma2:9b-instruct-q4_K_M',

  [string]$Prompt   = '',
  [string]$Endpoint = 'http://127.0.0.1:11434',
  [double]$Temperature = 0.2,
  [int]$Attempts    = 3,

  # Stricter than the evaluation threshold on purpose.
  #
  # Test-BriefingCitations defaults to 0.8 because an evaluation has to score
  # whatever the model produced. Publishing does not: prompt rule 2 asks every
  # sentence to end with a citation and a confidence band, an uncited sentence
  # shows up in the UI with the unverified label, and we can simply generate
  # again. Shipping an uncited sentence when a retry costs five seconds is a
  # choice, not a constraint.
  [double]$MinCitationRate = 1.0,
  [string]$OutDir   = '',
  [string]$OutJson  = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root = Split-Path $PSScriptRoot -Parent
if (-not $Replay)  { $Replay  = Join-Path $root 'ui/public/data/tacnet-01.replay.json' }
if (-not $Prompt)  { $Prompt  = Join-Path $root 'prompts/briefing.ko.md' }
if (-not $OutDir)  { $OutDir  = Join-Path $root 'ui/public/data' }
if (-not $OutJson) { $OutJson = Join-Path $root 'eval/results/briefing-publish.json' }

foreach ($f in @($Replay, $Prompt)) { if (-not (Test-Path $f)) { throw "not found: $f" } }

$rep = Get-Content $Replay -Raw -Encoding utf8 | ConvertFrom-Json
$scenario = [string]$rep.scenario_id

$stage = Join-Path $root 'analysis/briefing/publish'
if (-not (Test-Path $stage)) { New-Item -ItemType Directory -Force $stage | Out-Null }

Write-Output ''
Write-Output ("publishing briefings for {0}" -f $scenario)
Write-Output ("  model   : {0}" -f $Model)
Write-Output ("  prompt  : {0}" -f (Split-Path $Prompt -Leaf))
Write-Output ("  attempts: up to {0} per timestep" -f $Attempts)
Write-Output ("  target  : {0}{1}" -f $OutDir, $(if ($DryRun) { '   (DRY RUN, nothing is written there)' } else { '' }))
Write-Output ('-' * 78)

$rows = New-Object System.Collections.ArrayList

foreach ($t in $Times) {

  $packPath = Join-Path $stage ("{0}-t{1}.pack.json" -f $scenario, $t)
  & (Join-Path $PSScriptRoot 'New-BriefingPack.ps1') -Replay $Replay -At $t -Out $packPath | Out-Null

  $accepted = $null
  $tries = New-Object System.Collections.ArrayList

  for ($a = 1; $a -le $Attempts; $a++) {
    $briefPath = Join-Path $stage ("{0}-t{1}-a{2}.brief.json" -f $scenario, $t, $a)
    if (Test-Path $briefPath) { Remove-Item $briefPath -Force }

    try {
      & (Join-Path $PSScriptRoot 'Invoke-Briefing.ps1') `
        -Pack $packPath -Prompt $Prompt -Adapter ollama -Model $Model `
        -Endpoint $Endpoint -Temperature $Temperature -Out $briefPath | Out-Null
    } catch {
      [void]$tries.Add([ordered]@{ attempt = $a; failed = ('generation: ' + $_.Exception.Message) })
      continue
    }
    if (-not (Test-Path $briefPath)) {
      [void]$tries.Add([ordered]@{ attempt = $a; failed = 'generation produced no file' })
      continue
    }

    # --- check 1: citations, numbers, cause escalation, confidence bands
    $citeJson = ($briefPath -replace '\.json$', '') + '.check.json'
    & (Join-Path $PSScriptRoot 'Test-BriefingCitations.ps1') -Briefing $briefPath -OutJson $citeJson -MinCitationRate $MinCitationRate | Out-Null
    $cite = Get-Content $citeJson -Raw -Encoding utf8 | ConvertFrom-Json

    # --- check 2: did it address the mission the narration order demanded
    $covJson = ($briefPath -replace '\.json$', '') + '.coverage.json'
    & (Join-Path $PSScriptRoot 'Test-BriefingCoverage.ps1') -Briefing $briefPath -Replay $Replay -OutJson $covJson -Quiet | Out-Null
    $cov = Get-Content $covJson -Raw -Encoding utf8 | ConvertFrom-Json

    $ok = ($cite.violations -eq 0 -and $cov.pass)
    [void]$tries.Add([ordered]@{
      attempt         = $a
      citation_rate   = $cite.citation_rate
      violations      = $cite.violations
      coverage        = $(if ($cov.pass) { 'all slots' } else { 'FAIL: ' + (@($cov.slots_failed) -join ', ') })
      accepted        = $ok
    })

    Write-Output ("  t+{0,-4} attempt {1}  cite {2,6:P0}  viol {3}  coverage {4}  -> {5}" -f `
      $t, $a, $cite.citation_rate, $cite.violations,
      $(if ($cov.pass) { 'all slots' } else { 'FAIL ' + (@($cov.slots_failed) -join ',') }),
      $(if ($ok) { 'accept' } else { 'reject' }))

    if ($ok) {
      $accepted = [ordered]@{
        brief = $briefPath; pack = $packPath; attempt = $a
        citation = $cite; coverage = $cov
      }
      break
    }
  }

  if ($null -eq $accepted) {
    Write-Output ("  t+{0,-4} NOT PUBLISHED after {1} attempt(s)" -f $t, $Attempts)

    # Remove whatever was there before.
    #
    # The first run of this script dropped t+300 and left the old artifact in
    # place - a briefing from prompt v1 and a different model, which no current
    # check has ever passed. "Not published" would then have meant "keep the
    # unverified one", which is exactly the state ADR-0022 exists to prevent.
    #
    # A missing briefing is a state the UI handles; a stale one is not.
    if (-not $DryRun) {
      foreach ($old in @(
        (Join-Path $OutDir ("{0}-t{1}.brief.json" -f $scenario, $t)),
        (Join-Path $OutDir ("{0}-t{1}.pack.json" -f $scenario, $t))
      )) {
        if (Test-Path $old) {
          Remove-Item $old -Force
          Write-Output ("  t+{0,-4} removed the stale artifact {1}" -f $t, (Split-Path $old -Leaf))
        }
      }
    }
    [void]$rows.Add([pscustomobject][ordered]@{
      t = $t; published = $false; attempts = $tries.Count; tries = @($tries)
      reason = 'no attempt passed both checks'
    })
    continue
  }

  # --- write the artifact, with its verification stapled to it
  $brf = Get-Content $accepted.brief -Raw -Encoding utf8 | ConvertFrom-Json
  $out = [ordered]@{}
  foreach ($pp in $brf.PSObject.Properties) { $out[$pp.Name] = $pp.Value }
  $out['verification'] = [ordered]@{
    verified_at      = (Get-Date).ToString('o')
    publisher        = 'scripts/Publish-Briefings.ps1'
    adr              = 'ADR-0022'
    attempt          = $accepted.attempt
    attempts_allowed = $Attempts
    citation_rate    = $accepted.citation.citation_rate
    violations       = $accepted.citation.violations
    coverage_verdict = $accepted.coverage.verdict
    coverage_slots   = @($accepted.coverage.slots | ForEach-Object { $_.slot + '=' + $_.verdict })
    top_mission      = $accepted.coverage.top_mission
    note             = ('attempt is a publishing detail, not a model score. The evaluation ' +
                        'scripts generate once and never retry (ADR-0022).')
  }

  if ($DryRun) {
    Write-Output ("  t+{0,-4} would publish (attempt {1})" -f $t, $accepted.attempt)
  } else {
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }
    $dstBrief = Join-Path $OutDir ("{0}-t{1}.brief.json" -f $scenario, $t)
    $dstPack  = Join-Path $OutDir ("{0}-t{1}.pack.json" -f $scenario, $t)
    [IO.File]::WriteAllText($dstBrief, ($out | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    Copy-Item $accepted.pack $dstPack -Force
    Write-Output ("  t+{0,-4} published (attempt {1})" -f $t, $accepted.attempt)
  }

  [void]$rows.Add([pscustomobject][ordered]@{
    t = $t; published = $true; attempt = $accepted.attempt; attempts = $tries.Count
    citation_rate = $accepted.citation.citation_rate
    violations = $accepted.citation.violations
    coverage_verdict = $accepted.coverage.verdict
    coverage_slots   = @($accepted.coverage.slots | ForEach-Object { $_.slot + '=' + $_.verdict })
    tries = @($tries)
  })
}

# ---------------------------------------------------------------- report

$pub  = @($rows | Where-Object { $_.published })
$drop = @($rows | Where-Object { -not $_.published })

Write-Output ''
Write-Output ('-' * 78)
Write-Output ("published {0} of {1} timestep(s)" -f $pub.Count, $rows.Count)
if ($drop.Count -gt 0) {
  Write-Output ("dropped  : {0}" -f (($drop | ForEach-Object { 't+' + $_.t }) -join ', '))
  Write-Output 'A dropped timestep ships no briefing at all. The UI hides the panel there.'
}
$firstTry = @($pub | Where-Object { $_.attempt -eq 1 }).Count
Write-Output ("first attempt accepted: {0} of {1}" -f $firstTry, $pub.Count)

$payload = [ordered]@{
  generated   = (Get-Date).ToString('o')
  generator   = 'scripts/Publish-Briefings.ps1'
  adr         = 'ADR-0022'
  scenario    = $scenario
  model       = $Model
  prompt      = (Resolve-Path $Prompt).Path
  temperature = $Temperature
  attempts_allowed = $Attempts
  min_citation_rate = $MinCitationRate
  dry_run     = [bool]$DryRun
  published   = $pub.Count
  dropped     = $drop.Count
  first_attempt_accepted = $firstTry
  note        = ('Retries are a publishing tool. The evaluation scripts generate once. ' +
                 'Do not read attempt counts here as a model score.')
  timesteps   = @($rows)
}
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[IO.File]::WriteAllText($OutJson, ($payload | ConvertTo-Json -Depth 9), (New-Object Text.UTF8Encoding($false)))

Write-Output ("report   : {0}" -f $OutJson)
Write-Output ''

if ($drop.Count -gt 0) { exit 1 }
exit 0
