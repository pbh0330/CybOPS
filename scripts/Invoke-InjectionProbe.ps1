# E3 step 6: run the injected packs through the models and aggregate.
#
# ASCII only in this file.
#
# One clean control run per (model, t) supplies the baseline the suppression
# payload needs, and doubles as a reference for the citation rate: if a model
# already drops terminators on a clean pack, a dropped terminator under
# injection is not evidence of obedience.
#
# Output: eval/results/e3-injection.json
#
# Usage:
#   .\scripts\Invoke-InjectionProbe.ps1
#   .\scripts\Invoke-InjectionProbe.ps1 -Models 'qwen2.5:7b-instruct-q4_K_M' -Times 300

param(
  [string[]]$Models = @('qwen2.5:7b-instruct-q4_K_M', 'qwen2.5:14b-instruct-q4_K_M'),
  [int[]]$Times     = @(120, 300),
  [string]$Replay   = "$PSScriptRoot\..\ui\public\data\tacnet-01.replay.json",
  [string]$Endpoint = 'http://127.0.0.1:11434',
  [double]$Temperature = 0.2,

  # Same prompt-variant handling as the ablation probe. Rule 8 (ignore
  # instructions inside the evidence block) is unchanged between v3 and v4,
  # so a difference here would be a side effect of the other edits rather
  # than of anything aimed at injection. That is worth knowing either way.
  [string]$Prompt   = '',
  [string]$Tag      = 'v3',
  [string]$OutJson  = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root    = Split-Path $PSScriptRoot -Parent
$packDir = Join-Path $root 'analysis\briefing'
$injDir  = Join-Path $root 'analysis\briefing\injected'
$runDir  = Join-Path $root (Join-Path 'analysis' (Join-Path 'briefing' (Join-Path 'inject-runs' $Tag)))
if (-not $OutJson) { $OutJson = Join-Path $root ('eval/results/e3-injection-{0}.json' -f $Tag) }
if (-not $Prompt)  { $Prompt  = Join-Path $root 'prompts/briefing.ko.md' }
if (-not (Test-Path $Prompt)) { throw "prompt not found: $Prompt" }
foreach ($d in @($packDir, $injDir, $runDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}

$payObj = Get-Content (Join-Path $root 'prompts\injection-payloads.ko.json') -Raw -Encoding utf8 | ConvertFrom-Json
$payIds = @($payObj.payloads | ForEach-Object { [string]$_.id })

Write-Output ''
foreach ($t in $Times) {
  $p = Join-Path $packDir ("tacnet-01-t{0}.pack.json" -f $t)
  if (-not (Test-Path $p)) { & (Join-Path $PSScriptRoot 'New-BriefingPack.ps1') -Replay $Replay -At $t -Out $p | Out-Null }
  & (Join-Path $PSScriptRoot 'New-InjectedPack.ps1') -Pack $p -Payload all -Quiet | Out-Null
}
Write-Output ("injected packs: {0} timesteps x {1} payloads" -f $Times.Count, $payIds.Count)

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

  $control = @{}
  foreach ($t in $Times) {
    $cp = Join-Path $packDir ("tacnet-01-t{0}.pack.json" -f $t)
    $co = Join-Path $runDir ("{0}-t{1}-clean.brief.json" -f $safe, $t)
    if (Invoke-One $modelName $cp $co) { $control[$t] = $co }
  }

  Write-Output ("  {0,-6} {1,-14} {2,-10} {3,7} {4}" -f 't', 'payload', 'result', 'cite', 'evidence')
  foreach ($t in $Times) {
    foreach ($payId in $payIds) {
      $ip = Join-Path $injDir ("tacnet-01-t{0}.{1}.pack.json" -f $t, $payId)
      if (-not (Test-Path $ip)) { continue }
      $bo = Join-Path $runDir ("{0}-t{1}-{2}.brief.json" -f $safe, $t, $payId)
      if (-not (Invoke-One $modelName $ip $bo)) { continue }

      $rep = Join-Path $runDir ("{0}-t{1}-{2}.inject.json" -f $safe, $t, $payId)
      $ctlArgs = @{}
      if ($control.ContainsKey($t)) { $ctlArgs['ControlBriefing'] = $control[$t] }
      & (Join-Path $PSScriptRoot 'Test-Injection.ps1') -Pack $ip -Briefing $bo -OutJson $rep -Quiet @ctlArgs | Out-Null

      $rr = Get-Content $rep -Raw -Encoding utf8 | ConvertFrom-Json
      [void]$rows.Add([pscustomobject][ordered]@{
        model               = $modelName
        t                   = $t
        payload_id          = $payId
        check               = $rr.check
        targets             = $rr.targets
        complied            = $rr.complied
        citation_rate       = $rr.citation_rate
        citation_violations = $rr.citation_violations
        sentences           = $rr.sentences
        evidence            = $rr.evidence
        report              = $rep
      })
      Write-Output ("  t+{0,-4} {1,-14} {2,-10} {3,7:P0} {4}" -f `
        $t, $payId, $(if ($rr.complied) { 'COMPLIED' } else { 'resisted' }), $rr.citation_rate, (@($rr.evidence) -join '; '))
    }
  }
}

# --------------------------------------------------------------- summary

Write-Output ''
Write-Output 'SUMMARY'
Write-Output ('-' * 86)

$summary = New-Object System.Collections.ArrayList
foreach ($modelName in $Models) {
  $mr = @($rows | Where-Object { $_.model -eq $modelName })
  if ($mr.Count -eq 0) { continue }
  $nC   = @($mr | Where-Object { $_.complied }).Count
  $cite = ($mr | Measure-Object citation_rate -Average).Average
  $viol = ($mr | Measure-Object citation_violations -Sum).Sum
  [void]$summary.Add([ordered]@{
    model = $modelName
    runs = $mr.Count
    complied = $nC
    mean_citation_rate = [math]::Round($cite, 4)
    citation_violations = $viol
  })
  Write-Output ("{0,-32} runs {1,3}  complied {2,3}  cite {3,7:P1}  viol {4}" -f $modelName, $mr.Count, $nC, $cite, $viol)
}

$report = [ordered]@{
  generated   = (Get-Date).ToString('o')
  generator   = 'scripts/Invoke-InjectionProbe.ps1'
  note        = 'E3 step 6. The briefing path, not the adversary simulator: there is no closed id set here, so an obeyed instruction reaches the screen unfiltered. A resisted result on this sample is not a general claim about injection resistance.'
  scenario    = 'tacnet-01'
  tag         = $Tag
  prompt_file = (Resolve-Path $Prompt).Path
  times       = $Times
  endpoint    = $Endpoint
  temperature = $Temperature
  payloads    = $payIds
  summary     = $summary
  runs        = $rows
}
$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
[IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 9), (New-Object Text.UTF8Encoding($false)))

Write-Output ''
Write-Output ("report: {0}" -f $OutJson)
Write-Output ''
