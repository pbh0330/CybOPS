# E3 step 4: run the ablated packs through the models and aggregate.
#
# ASCII only in this file.
#
# For every (t, preset) it generates two briefings with the same model, the
# same prompt and the same temperature:
#
#   control  the full pack           -> did the model state the figure at all?
#   ablated  the pack minus the fact -> did it abstain, or say it anyway?
#
# The control half is not optional. Abstention rate on its own is trivially
# gamed by a model that never commits to anything, and we would have no way to
# tell that apart from a model that tracks its evidence. The paired design
# turns the question into: of the figures this model DOES report when shown
# them, how many does it still report when they are gone?
#
# Only (t, preset) pairs with chargeable_count > 0 are worth running. At the
# saturated end of tacnet-01 every degradation is 100% or 0%, those tokens
# appear in half the pack, and removing one proves nothing because the model
# can read the same number off a neighbouring fact. New-AblatedPack.ps1 already
# marks those as leaked; this script skips the pair outright.
#
# Output: eval/results/e3-abstention.json
#
# Usage:
#   .\scripts\Invoke-AbstentionProbe.ps1
#   .\scripts\Invoke-AbstentionProbe.ps1 -Models 'qwen2.5:7b-instruct-q4_K_M'

param(
  [string[]]$Models = @('qwen2.5:7b-instruct-q4_K_M', 'qwen2.5:14b-instruct-q4_K_M'),
  [string]$Replay   = "$PSScriptRoot\..\ui\public\data\tacnet-01.replay.json",
  [string]$Endpoint = 'http://127.0.0.1:11434',
  [double]$Temperature = 0.2,

  # A prompt revision is a variable like any other. Point -Prompt at a variant
  # and give it a -Tag; runs and reports land in their own directory so the
  # same probe can be compared across prompt versions instead of overwriting
  # the result it is meant to be compared with.
  [string]$Prompt   = '',
  [string]$Tag      = 'v3',
  [string]$OutJson  = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root    = Split-Path $PSScriptRoot -Parent
$packDir = Join-Path $root 'analysis\briefing'
$ablDir  = Join-Path $root 'analysis\briefing\ablated'
$runDir  = Join-Path $root (Join-Path 'analysis' (Join-Path 'briefing' (Join-Path 'abstain' $Tag)))
if (-not $OutJson) { $OutJson = Join-Path $root ('eval/results/e3-abstention-{0}.json' -f $Tag) }
if (-not $Prompt)  { $Prompt  = Join-Path $root 'prompts/briefing.ko.md' }
if (-not (Test-Path $Prompt)) { throw "prompt not found: $Prompt" }
foreach ($d in @($packDir, $ablDir, $runDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}

# (t, preset) pairs. Chosen from the chargeability survey: these are the ones
# where the removed figure is not readable off any surviving fact.
$PROBES = @(
  @{ t = 105; preset = 'mission-top' }, @{ t = 120; preset = 'mission-top' },
  @{ t = 150; preset = 'mission-top' }, @{ t = 165; preset = 'mission-top' },
  @{ t = 180; preset = 'mission-top' }, @{ t = 195; preset = 'mission-top' },
  @{ t = 210; preset = 'mission-top' }, @{ t = 225; preset = 'mission-top' },
  @{ t = 150; preset = 'attribution' }, @{ t = 165; preset = 'attribution' },
  @{ t = 180; preset = 'attribution' }, @{ t = 210; preset = 'attribution' },
  @{ t = 105; preset = 'containment' }, @{ t = 150; preset = 'containment' },
  @{ t = 195; preset = 'containment' }, @{ t = 345; preset = 'containment' },
  @{ t = 210; preset = 'compromise'  }, @{ t = 225; preset = 'compromise'  },
  @{ t = 270; preset = 'compromise'  }, @{ t = 345; preset = 'compromise'  },
  @{ t = 120; preset = 'bare'        }, @{ t = 300; preset = 'bare'        },
  @{ t = 375; preset = 'bare'        }
)

$times = @($PROBES | ForEach-Object { $_.t } | Sort-Object -Unique)

Write-Output ''
Write-Output ('building packs for {0} timesteps' -f $times.Count)
foreach ($t in $times) {
  $p = Join-Path $packDir ("tacnet-01-t{0}.pack.json" -f $t)
  if (-not (Test-Path $p)) { & (Join-Path $PSScriptRoot 'New-BriefingPack.ps1') -Replay $Replay -At $t -Out $p | Out-Null }
  & (Join-Path $PSScriptRoot 'New-AblatedPack.ps1') -Pack $p -Preset all -Quiet | Out-Null
}

function Invoke-One([string]$modelName, [string]$packPath, [string]$outPath) {
  if (Test-Path $outPath) { return $true }
  try {
    & (Join-Path $PSScriptRoot 'Invoke-Briefing.ps1') `
      -Pack $packPath -Prompt $Prompt -Adapter ollama -Model $modelName -Endpoint $Endpoint `
      -Temperature $Temperature -Out $outPath | Out-Null
    return (Test-Path $outPath)
  } catch {
    Write-Output ("    GENERATION FAILED: {0}" -f $_.Exception.Message)
    return $false
  }
}

$rows = New-Object System.Collections.ArrayList

foreach ($modelName in $Models) {
  $safe = ($modelName -replace '[^0-9A-Za-z]', '_')
  Write-Output ''
  Write-Output ("model: {0}" -f $modelName)
  Write-Output ('-' * 86)

  # controls first: one per distinct t, reused by every preset at that t
  $control = @{}
  foreach ($t in $times) {
    $cp  = Join-Path $packDir ("tacnet-01-t{0}.pack.json" -f $t)
    $co  = Join-Path $runDir ("{0}-t{1}-control.brief.json" -f $safe, $t)
    if (Invoke-One $modelName $cp $co) { $control[$t] = $co }
  }
  Write-Output ("  controls: {0} of {1}" -f $control.Count, $times.Count)

  Write-Output ("  {0,-6} {1,-12} {2,5} {3,5} {4,5} {5,5} {6,5} {7,5} {8,6} {9}" -f 't','preset','targ','fabr','abst','sub','sil','disc','bogus/mm','bands')

  foreach ($pr in $PROBES) {
    $t  = [int]$pr.t
    $pn = [string]$pr.preset
    $ap = Join-Path $ablDir ("tacnet-01-t{0}.{1}.pack.json" -f $t, $pn)
    if (-not (Test-Path $ap)) { Write-Output ("  t+{0,-4} {1,-12} no ablated pack" -f $t, $pn); continue }

    $apo = Get-Content $ap -Raw -Encoding utf8 | ConvertFrom-Json
    if ([int]$apo.ablation.chargeable_count -eq 0) {
      Write-Output ("  t+{0,-4} {1,-12} SKIP - every removed figure leaks into a surviving fact" -f $t, $pn)
      continue
    }

    $bo = Join-Path $runDir ("{0}-t{1}-{2}.brief.json" -f $safe, $t, $pn)
    if (-not (Invoke-One $modelName $ap $bo)) { continue }

    $rep = Join-Path $runDir ("{0}-t{1}-{2}.abstain.json" -f $safe, $t, $pn)
    $ctlArgs = @{}
    if ($control.ContainsKey($t)) { $ctlArgs['ControlBriefing'] = $control[$t] }
    & (Join-Path $PSScriptRoot 'Test-Abstention.ps1') -Pack $ap -Briefing $bo -OutJson $rep -Quiet @ctlArgs | Out-Null

    $rr = Get-Content $rep -Raw -Encoding utf8 | ConvertFrom-Json
    $bandStr = (($rr.band_counts.PSObject.Properties | Where-Object { $_.Value -gt 0 } |
                 ForEach-Object { "{0}:{1}" -f $_.Name, $_.Value }) -join ' ')

    [void]$rows.Add([pscustomobject][ordered]@{
      model         = $modelName
      t             = $t
      preset        = $pn
      facts_before  = $rr.facts_before
      facts_after   = $rr.facts_after
      sentences     = $rr.sentences
      targets       = $rr.targets_total
      fabricated    = $rr.fabricated
      abstained     = ([int]$rr.abstained + [int]$rr.abstained_generic)
      substituted   = $rr.substituted
      silent        = $rr.silent
      discriminative            = $rr.discriminative
      discriminative_abstained  = $rr.discriminative_abstained
      discriminative_fabricated = $rr.discriminative_fabricated
      citation_rate = $rr.citation_rate
      bogus_citations = $rr.bogus_citations
      number_mismatches = $rr.number_mismatches
      unsupported_output = $rr.unsupported_output
      band_counts   = $rr.band_counts
      report        = $rep
    })

    Write-Output ("  t+{0,-4} {1,-12} {2,5} {3,5} {4,5} {5,5} {6,5} {7,5} {8,6} {9}" -f `
      $t, $pn, $rr.targets_total, $rr.fabricated, ([int]$rr.abstained + [int]$rr.abstained_generic), $rr.substituted, $rr.silent, $rr.discriminative, ("{0}/{1}" -f $rr.bogus_citations, $rr.number_mismatches), $bandStr)
  }
}

# --------------------------------------------------------------- summary

Write-Output ''
Write-Output 'SUMMARY'
Write-Output ('-' * 86)
Write-Output ("{0,-32} {1,5} {2,6} {3,6} {4,6} {5,6} {6,7} {7,10} {8,10}" -f 'model','runs','targ','fabr','abst','subst','silent','disc.abst','bogus/mm')

$summary = New-Object System.Collections.ArrayList
foreach ($modelName in $Models) {
  $mr = @($rows | Where-Object { $_.model -eq $modelName })
  if ($mr.Count -eq 0) { continue }
  $tT = ($mr | Measure-Object targets -Sum).Sum
  $tF = ($mr | Measure-Object fabricated -Sum).Sum
  $tA = ($mr | Measure-Object abstained -Sum).Sum
  $tU = ($mr | Measure-Object substituted -Sum).Sum
  $tS = ($mr | Measure-Object silent -Sum).Sum
  $tB = ($mr | Measure-Object bogus_citations -Sum).Sum
  $tM = ($mr | Measure-Object number_mismatches -Sum).Sum
  $tUns = @($mr | Where-Object { $_.unsupported_output }).Count
  $dT = ($mr | Measure-Object discriminative -Sum).Sum
  $dA = ($mr | Measure-Object discriminative_abstained -Sum).Sum
  $dF = ($mr | Measure-Object discriminative_fabricated -Sum).Sum
  $dRate = $null
  if ($dT -gt 0) { $dRate = [math]::Round($dA / [double]$dT, 4) }

  [void]$summary.Add([ordered]@{
    model = $modelName
    runs = $mr.Count
    targets = $tT
    fabricated = $tF
    abstained = $tA
    substituted = $tU
    silent = $tS
    bogus_citations = $tB
    number_mismatches = $tM
    runs_with_unsupported_output = $tUns
    fabrication_rate = $(if ($tT -gt 0) { [math]::Round($tF / [double]$tT, 4) } else { $null })
    substitution_rate = $(if ($tT -gt 0) { [math]::Round($tU / [double]$tT, 4) } else { $null })
    discriminative = $dT
    discriminative_abstained = $dA
    discriminative_fabricated = $dF
    discriminative_abstention_rate = $dRate
  })

  Write-Output ("{0,-32} {1,5} {2,6} {3,6} {4,6} {5,6} {6,7} {7,10} {8,10}" -f `
    $modelName, $mr.Count, $tT, $tF, $tA, $tU, $tS, $(if ($null -ne $dRate) { '{0:P1}' -f $dRate } else { '-' }), ("{0}/{1}" -f $tB, $tM))
}

$payload = [ordered]@{
  generated   = (Get-Date).ToString('o')
  generator   = 'scripts/Invoke-AbstentionProbe.ps1'
  note        = 'E3 step 4. Facts removed on purpose so that abstention is the correct answer. silent is reported separately from abstained: a model that changed the subject did not admit ignorance. Controls are the same model on the full pack; discriminative targets are those it states when shown the fact.'
  scenario    = 'tacnet-01'
  tag         = $Tag
  prompt_file = (Resolve-Path $Prompt).Path
  endpoint    = $Endpoint
  temperature = $Temperature
  probes      = $PROBES
  summary     = $summary
  runs        = $rows
}
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[IO.File]::WriteAllText($OutJson, ($payload | ConvertTo-Json -Depth 9), (New-Object Text.UTF8Encoding($false)))

Write-Output ''
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
