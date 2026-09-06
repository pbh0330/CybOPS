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
# Usage:
#   .\scripts\Compare-BriefingModels.ps1
#   .\scripts\Compare-BriefingModels.ps1 -Models 'qwen2.5:7b-instruct-q4_K_M','qwen2.5:14b-instruct-q4_K_M'
#   .\scripts\Compare-BriefingModels.ps1 -Times 120,300,390 -Repeats 2

param(
  [string[]]$Models = @('qwen2.5:7b-instruct-q4_K_M', 'qwen2.5:14b-instruct-q4_K_M'),
  [int[]]$Times     = @(105, 120, 150, 210, 255, 300, 345, 390),
  [int]$Repeats     = 1,
  [string]$Replay   = "$PSScriptRoot\..\ui\public\data\tacnet-01.replay.json",
  [string]$Endpoint = 'http://127.0.0.1:11434',
  [string]$OutJson  = "$PSScriptRoot\..\eval\results\briefing-model-comparison.json"
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root = Split-Path $PSScriptRoot -Parent
$packDir = Join-Path $root 'analysis\briefing'
$tmpDir  = Join-Path $root 'analysis\briefing\compare'
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
      $tag  = "t$t" + $(if ($Repeats -gt 1) { "-r$r" } else { '' })
      $safe = ($model -replace '[^0-9A-Za-z]', '_')
      $out  = Join-Path $tmpDir ("{0}-{1}.brief.json" -f $safe, $tag)

      $sw = [Diagnostics.Stopwatch]::StartNew()
      $failed = $false
      try {
        & (Join-Path $PSScriptRoot 'Invoke-Briefing.ps1') `
          -Pack $packs[$t] -Adapter ollama -Model $model -Endpoint $Endpoint -Out $out | Out-Null
      } catch {
        $failed = $true
        Write-Output ("  t+{0,-4} GENERATION FAILED: {1}" -f $t, $_.Exception.Message)
      }
      $sw.Stop()
      if ($failed) { continue }

      $rep = Join-Path $tmpDir ("{0}-{1}.check.json" -f $safe, $tag)
      & (Join-Path $PSScriptRoot 'Test-BriefingCitations.ps1') -Briefing $out -OutJson $rep | Out-Null
      $ok = ($LASTEXITCODE -eq 0)

      $c = Get-Content $rep -Raw -Encoding utf8 | ConvertFrom-Json
      $b = Get-Content $out -Raw -Encoding utf8 | ConvertFrom-Json

      [void]$rows.Add([ordered]@{
        model            = $model
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
  })

  Write-Output ("{0,-32} {1,5} {2,6} {3,8:P1} {4,8} {5,9}" -f $model, $mr.Count, $passN, $cite, $viol, [int]$lat)
}

$payload = [ordered]@{
  generated = (Get-Date).ToString('o')
  generator = 'scripts/Compare-BriefingModels.ps1'
  note      = 'Measurement for the 7-8B vs 12-14B question left open by ADR-0016. Compared on verifier violations and latency, not on prose quality.'
  scenario  = 'tacnet-01'
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
