# Unattended overnight compute chain.
#
# ASCII only in this file.
#
# What this is for: the experiments that need no judgement, only time. It runs
# them in order, keeps going when one fails, and leaves a log and result files
# behind. Nothing here deletes anything (CLAUDE.md: no automatic cleanup), and
# nothing here downloads the large datasets - that runs as its own detached
# process so a GPU stall cannot cost a night of bandwidth.
#
# Steps:
#   1. wait for the 14B model to finish pulling (skips if already there)
#   2. briefing model comparison, 7B vs 14B, repeated (ADR-0016's open question)
#   3. adversary seed sweep, wider than the 3 seeds in docs/13
#
# Usage (detached is the point; a foreground run works too):
#   .\scripts\Invoke-OvernightChain.ps1
#   .\scripts\Invoke-OvernightChain.ps1 -SkipOptcWait -Seeds 6

param(
  [string]$Model14   = 'qwen2.5:14b-instruct-q4_K_M',
  [int]$WaitModelMin = 45,
  [int]$Repeats      = 3,
  [int]$Seeds        = 10,
  [string]$LogPath   = ''
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root = Split-Path $PSScriptRoot -Parent
if (-not $LogPath) { $LogPath = Join-Path $root 'analysis\overnight.log' }
$dir = Split-Path $LogPath -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

function Log($msg) {
  $line = "{0}  {1}" -f (Get-Date).ToString('HH:mm:ss'), $msg
  Write-Output $line
  Add-Content -Path $LogPath -Value $line -Encoding utf8
}

$ollama = Join-Path $env:LOCALAPPDATA 'Programs\ollama\ollama.exe'
$node   = Join-Path $env:LOCALAPPDATA 'Programs\nodejs-portable\node-v24.20.0-win-x64\node.exe'

Log '================================================================'
Log 'overnight chain start'
Log ("root {0}" -f $root)

# ---------------------------------------------------------------- 1. model

$has14 = $false
$deadline = (Get-Date).AddMinutes($WaitModelMin)
Log ("step 1: waiting for {0} (up to {1} min)" -f $Model14, $WaitModelMin)
while ((Get-Date) -lt $deadline) {
  try {
    $tags = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10
    if (@($tags.models | Where-Object { $_.name -eq $Model14 }).Count -gt 0) { $has14 = $true; break }
  } catch { }
  Start-Sleep -Seconds 30
}
if ($has14) { Log ("step 1: {0} available" -f $Model14) }
else { Log ("step 1: {0} not available, comparison runs 7B only" -f $Model14) }

# ---------------------------------------------------------------- 2. briefing models

$models = @('qwen2.5:7b-instruct-q4_K_M')
if ($has14) { $models += $Model14 }

Log ("step 2: briefing comparison, models {0}, repeats {1}" -f ($models -join ' + '), $Repeats)
try {
  & (Join-Path $PSScriptRoot 'Compare-BriefingModels.ps1') `
      -Models $models -Repeats $Repeats `
      -Times 0,105,120,150,195,210,255,300,330,345,375,390 `
      -OutJson (Join-Path $root 'eval\results\briefing-model-comparison.json') 2>&1 |
    ForEach-Object { Log ("  {0}" -f $_) }
  Log 'step 2: done'
} catch {
  Log ("step 2 FAILED: {0}" -f $_.Exception.Message)
}

# ---------------------------------------------------------------- 3. adversary seeds

if (Test-Path $node) {
  $seedList = @()
  for ($i = 0; $i -lt $Seeds; $i++) { $seedList += (20260906 + $i) }
  $seedArg = $seedList -join ','
  Log ("step 3: adversary sweep, {0} seeds" -f $Seeds)
  try {
    Push-Location (Join-Path $root 'ui')
    & $node 'tools/redteam-compare.mjs' `
        '--seeds' $seedArg `
        '--out' (Join-Path $root 'analysis\redteam\comparison-wide.json') 2>&1 |
      ForEach-Object { Log ("  {0}" -f $_) }
    Pop-Location
    Log 'step 3: done'
  } catch {
    Log ("step 3 FAILED: {0}" -f $_.Exception.Message)
    try { Pop-Location } catch { }
  }
} else {
  Log 'step 3: node not found, skipped'
}

# ---------------------------------------------------------------- 4. summary

Log 'step 4: summary'
$summaryPath = Join-Path $root 'analysis\overnight-summary.json'
$summary = [ordered]@{
  finished     = (Get-Date).ToString('o')
  model_14b    = $has14
  models_run   = $models
  repeats      = $Repeats
  seeds        = $Seeds
  outputs      = @(
    'eval/results/briefing-model-comparison.json',
    'analysis/redteam/comparison-wide.json'
  )
  note = 'Unattended run. Results are measurements, not conclusions; read the logs before quoting a number.'
}
[IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
Log ("wrote {0}" -f $summaryPath)
Log 'overnight chain end'
Log '================================================================'
