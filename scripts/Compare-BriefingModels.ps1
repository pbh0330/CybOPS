# Compare briefing models on the same evidence packs.
#
# ASCII only in this file.
#
# ADR-0016 left a question open: 7-8B with a long context, or 12-14B with a
# short one? It said to settle it by measurement rather than by argument. This
# is that measurement, and the thing being measured is not "which sounds
# better" - it is the four checks the verifier already runs, plus the script
# check added after a 7B leaked Chinese into 5 of 48 adversary rationales
# (docs/13-adversary-comparison.md section 5).
#
# For each (model, t) it generates a briefing and verifies it, then reports
# violations and latency per model. Nothing here judges prose quality; a model
# that writes beautifully and cites a fact that does not exist still fails.
#
# Since the golden set exists (eval/golden/, 488 items derived from the engine
# rather than hand written) each model is also scored on fact accuracy and on
# calibration. The two halves answer different questions and a model can pass
# one and fail the other: the verifier asks whether every claim is anchored,
# the golden scorer asks whether the anchored claims are the engine's numbers,
# and ECE asks whether the model's own stated confidence tracks how often it is
# right. A model with a clean verifier report and an ECE of 0.30 is a model
# that is wrong confidently and in the correct format.
#
# The model list spans two families on purpose. Comparing 7B against 14B of the
# same family measures size; it says nothing about whether the result is a
# property of Qwen. exaone3.5 is Korean-first and gemma2 is a third lineage, so
# a finding that survives all four is about the task rather than about one
# vendor's instruction tuning.
#
# Usage:
#   .\scripts\Compare-BriefingModels.ps1
#   .\scripts\Compare-BriefingModels.ps1 -Models 'qwen2.5:7b-instruct-q4_K_M','qwen2.5:14b-instruct-q4_K_M'
#   .\scripts\Compare-BriefingModels.ps1 -Times 120,300,390 -Repeats 2

param(
  [string[]]$Models = @(
    'qwen2.5:7b-instruct-q4_K_M',
    'qwen2.5:14b-instruct-q4_K_M',
    'exaone3.5:7.8b',
    'gemma2:9b-instruct-q4_K_M'
  ),
  [int[]]$Times     = @(105, 120, 150, 210, 255, 300, 345, 390),
  [int]$Repeats     = 1,
  [string]$Replay   = "$PSScriptRoot\..\ui\public\data\tacnet-01.replay.json",
  [string]$Endpoint = 'http://127.0.0.1:11434',

  # A prompt revision is a variable. Point -Prompt at a variant and give it a
  # -Tag so its runs and reports do not overwrite the ones they are meant to
  # be compared with. The ablation probe already showed v4 fixing the missing
  # abstention; this is where we find out what it cost on a full pack.
  [string]$Prompt   = '',
  [string]$Tag      = 'v3',
  [string]$OutJson  = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root = Split-Path $PSScriptRoot -Parent
$packDir = Join-Path $root 'analysis\briefing'
$tmpDir  = Join-Path $root (Join-Path 'analysis' (Join-Path 'briefing' (Join-Path 'compare' $Tag)))
if (-not $OutJson) { $OutJson = Join-Path $root ('eval/results/briefing-model-comparison-{0}.json' -f $Tag) }
if (-not $Prompt)  { $Prompt  = Join-Path $root 'prompts/briefing.ko.md' }
if (-not (Test-Path $Prompt)) { throw "prompt not found: $Prompt" }
foreach ($d in @($packDir, $tmpDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null } }

# packs first: same evidence for every model, so the comparison is about the
# model and not about what it was shown
Write-Output ''
Write-Output 'building evidence packs'
$packs = @{}
foreach ($t in $Times) {
  $p = Join-Path $packDir ("tacnet-01-t{0}.pack.json" -f $t)
  & (Join-Path $PSScriptRoot 'New-BriefingPack.ps1') -Replay $Replay -At $t -Out $p | Out-Null
  $packs[$t] = $p
  $obj = Get-Content $p -Raw -Encoding utf8 | ConvertFrom-Json
  Write-Output ("  t+{0,-4} facts {1}" -f $t, $obj.facts.Count)
}

$rows = New-Object System.Collections.ArrayList

foreach ($model in $Models) {
  Write-Output ''
  Write-Output ("model: {0}" -f $model)
  Write-Output ('-' * 78)

  foreach ($t in $Times) {
    for ($r = 1; $r -le $Repeats; $r++) {
      $runTag = "t$t" + $(if ($Repeats -gt 1) { "-r$r" } else { '' })
      $safe = ($model -replace '[^0-9A-Za-z]', '_')
      $out  = Join-Path $tmpDir ("{0}-{1}.brief.json" -f $safe, $runTag)

      $sw = [Diagnostics.Stopwatch]::StartNew()
      $failed = $false
      try {
        & (Join-Path $PSScriptRoot 'Invoke-Briefing.ps1') `
          -Pack $packs[$t] -Prompt $Prompt -Adapter ollama -Model $model -Endpoint $Endpoint -Out $out | Out-Null
      } catch {
        $failed = $true
        Write-Output ("  t+{0,-4} GENERATION FAILED: {1}" -f $t, $_.Exception.Message)
      }
      $sw.Stop()
      if ($failed) { continue }

      $rep = Join-Path $tmpDir ("{0}-{1}.check.json" -f $safe, $runTag)
      & (Join-Path $PSScriptRoot 'Test-BriefingCitations.ps1') -Briefing $out -OutJson $rep | Out-Null
      $ok = ($LASTEXITCODE -eq 0)

      $c = Get-Content $rep -Raw -Encoding utf8 | ConvertFrom-Json
      $b = Get-Content $out -Raw -Encoding utf8 | ConvertFrom-Json

      [void]$rows.Add([pscustomobject][ordered]@{
        model            = $model
        safe             = $safe
        t                = $t
        repeat           = $r
        pass             = $ok
        sentences        = $c.sentences_total
        citation_rate    = $c.citation_rate
        bogus            = @($c.bogus_citations).Count
        number_mismatch  = @($c.number_mismatches).Count
        unknown_escal    = @($c.unknown_escalations).Count
        script_violation = @($c.script_violations).Count
        off_citation     = @($c.off_citation_numbers).Count
        violations       = $c.violations
        chars            = ([string]$b.text).Length
        latency_ms       = $b.latency_ms
        wall_ms          = [int]$sw.Elapsed.TotalMilliseconds
      })

      Write-Output ("  t+{0,-4} {1}  sent {2,-2} cite {3,6:P0} viol {4}  {5,6} ms" -f `
        $t, $(if ($ok) { 'PASS' } else { 'FAIL' }), $c.sentences_total, $c.citation_rate, $c.violations, $b.latency_ms)
    }
  }
}

# ---------------------------------------------------------------- summary

Write-Output ''
Write-Output 'SUMMARY'
Write-Output ('-' * 78)
Write-Output ("{0,-32} {1,5} {2,6} {3,8} {4,8} {5,9}" -f 'model', 'runs', 'pass', 'cite', 'violat', 'ms/run')

$summary = New-Object System.Collections.ArrayList
foreach ($model in $Models) {
  $mr = @($rows | Where-Object { $_.model -eq $model })
  if ($mr.Count -eq 0) { continue }
  $safe = ($model -replace '[^0-9A-Za-z]', '_')

  # fact accuracy and calibration on the same briefings the verifier just read
  $gJson = Join-Path (Join-Path $root 'eval') ('results/e3-golden-{0}-{1}.json' -f $Tag, $safe)
  $gld = $null
  try {
    & (Join-Path $PSScriptRoot 'Test-GoldenBriefing.ps1') `
      -Glob (Join-Path $tmpDir ("{0}-*.brief.json" -f $safe)) -OutJson $gJson | Out-Null
    $gld = Get-Content $gJson -Raw -Encoding utf8 | ConvertFrom-Json
  } catch {
    Write-Output ("  golden scoring failed for {0}: {1}" -f $model, $_.Exception.Message)
  }
  $passN = @($mr | Where-Object { $_.pass }).Count
  $cite  = ($mr | Measure-Object citation_rate -Average).Average
  $viol  = ($mr | Measure-Object violations -Sum).Sum
  $lat   = ($mr | Measure-Object latency_ms -Average).Average

  [void]$summary.Add([ordered]@{
    model = $model
    runs = $mr.Count
    passed = $passN
    mean_citation_rate = [math]::Round($cite, 4)
    total_violations = $viol
    script_violations = ($mr | Measure-Object script_violation -Sum).Sum
    bogus_citations = ($mr | Measure-Object bogus -Sum).Sum
    number_mismatches = ($mr | Measure-Object number_mismatch -Sum).Sum
    unknown_escalations = ($mr | Measure-Object unknown_escal -Sum).Sum
    mean_latency_ms = [int]$lat
    mean_chars = [int](($mr | Measure-Object chars -Average).Average)
    golden_sentences = $(if ($gld) { $gld.totals.sentences } else { $null })
    golden_untagged  = $(if ($gld) { $gld.totals.untagged } else { $null })
    golden_correct   = $(if ($gld) { $gld.totals.correct } else { $null })
    golden_wrong     = $(if ($gld) { $gld.totals.wrong } else { $null })
    golden_abstain   = $(if ($gld) { $gld.totals.abstain } else { $null })
    ece              = $(if ($gld) { $gld.ece } else { $null })
    brier            = $(if ($gld) { $gld.brier } else { $null })
    golden_report    = $(if ($gld) { $gJson } else { $null })
  })

  $gTxt = '-'
  if ($gld) {
    $gTxt = "{0}/{1} ok  abst {2}  ECE {3}  Brier {4}" -f `
      $gld.totals.correct, ([int]$gld.totals.correct + [int]$gld.totals.wrong), $gld.totals.abstain, `
      $(if ($null -ne $gld.ece) { '{0:N3}' -f $gld.ece } else { 'n/a' }), `
      $(if ($null -ne $gld.brier) { '{0:N3}' -f $gld.brier } else { 'n/a' })
  }
  Write-Output ("{0,-32} {1,5} {2,6} {3,8:P1} {4,8} {5,9}" -f $model, $mr.Count, $passN, $cite, $viol, [int]$lat)
  Write-Output ("{0,-32} {1}" -f '', $gTxt)
}

$payload = [ordered]@{
  generated = (Get-Date).ToString('o')
  generator = 'scripts/Compare-BriefingModels.ps1'
  note      = 'Measurement for the 7-8B vs 12-14B question left open by ADR-0016. Compared on verifier violations, golden fact accuracy, calibration and latency - never on prose quality. Two model families so that a finding is not a property of one vendor.'
  scenario  = 'tacnet-01'
  tag       = $Tag
  prompt_file = (Resolve-Path $Prompt).Path
  times     = $Times
  repeats   = $Repeats
  endpoint  = $Endpoint
  summary   = $summary
  runs      = $rows
}
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[IO.File]::WriteAllText($OutJson, ($payload | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

Write-Output ''
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
