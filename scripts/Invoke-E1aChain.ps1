# Unattended E1-a chain: wait for the dense extraction, then evaluate everything.
#
# ASCII ONLY IN THIS FILE.
#
# WHY A CHAIN AND NOT FOUR COMMANDS
#
# The 1-in-100 extraction takes a couple of hours and the evaluations that
# depend on it take longer. Nobody is going to sit and watch for the first one
# to end so they can start the second, and if the machine is left running
# overnight the alternative is that it idles after step one.
#
# Every step writes its own log and its own JSON. A step that fails does not
# stop the ones that do not depend on it - a chain that aborts at 02:00 and
# leaves nothing is worse than one that finishes three of four.
#
# WHAT IT DOES NOT DO
#
# It does not pick anything by looking at a test score. Every evaluation runs
# the same protocol: hyperparameters selected by forward-chaining validation
# inside the training days, test scored once. The chain runs more
# configurations than a person would by hand; it does not run a different
# experiment.
#
# Usage:
#   .\scripts\Invoke-E1aChain.ps1
#   .\scripts\Invoke-E1aChain.ps1 -WaitMinutes 0    (do not wait, run what exists)

param(
  [string]$Python      = 'C:\Users\qwert\AppData\Local\Programs\Python\Python312\python.exe',
  [int]   $WaitMinutes = 240,
  [string]$Splits      = '8,10,12,15'
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root   = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $root 'analysis\lanl'
$chain  = Join-Path $logDir '_e1a-chain.log'

function Say($msg) {
  $line = ('{0}  {1}' -f (Get-Date -Format 'MM-dd HH:mm:ss'), $msg)
  Write-Output $line
  Add-Content -LiteralPath $chain -Value $line -Encoding utf8
}

Say '=== E1-a chain start ==='
$env:PYTHONUNBUFFERED = '1'

# ---------------------------------------------------------------- 1. wait
#
# The extractor writes its summary JSON only on success, so that file - not the
# CSV, which exists from the first flush - is what "finished" means.

$denseCsv  = Join-Path $logDir 'auth-features2-n100.csv'
$denseDone = Join-Path $logDir 'auth-features2-n100.summary.json'

if ($WaitMinutes -gt 0) {
  $deadline = (Get-Date).AddMinutes($WaitMinutes)
  Say ("waiting for dense extraction (up to {0} min)" -f $WaitMinutes)
  while (-not (Test-Path $denseDone)) {
    if ((Get-Date) -gt $deadline) { Say 'WAIT TIMEOUT - continuing without the dense set'; break }
    $running = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
                 Where-Object { $_.CommandLine -like '*n100*' -and $_.CommandLine -notlike '*Win32_Proc*' })
    if ($running.Count -eq 0 -and -not (Test-Path $denseDone)) {
      Say 'dense extraction is not running and produced no summary - it died. continuing without it.'
      break
    }
    $mb = 0
    if (Test-Path $denseCsv) { $mb = (Get-Item $denseCsv).Length / 1MB }
    Say ('  still extracting, csv {0:N0} MB' -f $mb)
    Start-Sleep -Seconds 300
  }
  if (Test-Path $denseDone) { Say 'dense extraction finished' }
}

# ---------------------------------------------------------------- 2. runs
#
# Ordered cheapest first, so a night that gets cut short still leaves the
# comparable pair (pass1 vs pass2 at 1-in-500) on disk.

$runs = @(
  @{ tag = 'pass1-tuned'; csv = 'auth-features.csv';            note = 'raw counts, full search' },
  @{ tag = 'pass2-tuned'; csv = 'auth-features2.csv';           note = 'self-normalised, full search' },
  @{ tag = 'dense-tuned'; csv = 'auth-features2-n100.csv';      note = 'self-normalised at 1-in-100, full search + host-hour view' }
)

foreach ($r in $runs) {
  $csv = Join-Path $logDir $r.csv
  if (-not (Test-Path $csv)) { Say ("SKIP {0}: {1} not present" -f $r.tag, $r.csv); continue }
  $log = Join-Path $logDir ('_e1a-{0}.log' -f $r.tag)
  Say ("run {0}  ({1})" -f $r.tag, $r.note)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & $Python (Join-Path $root 'scripts\run_e1a.py') --features $csv --tag $r.tag --splits $Splits *> $log
  $sw.Stop()
  $code = $LASTEXITCODE
  if ($code -eq 0) { Say ("  done in {0:N0} s -> eval\results\e1a-detection-{1}.json" -f $sw.Elapsed.TotalSeconds, $r.tag) }
  else             { Say ("  FAILED exit {0} after {1:N0} s - see {2}" -f $code, $sw.Elapsed.TotalSeconds, $log) }
}

# ---------------------------------------------------------------- 3. summary
#
# One table across every result that exists, so the morning starts with the
# comparison rather than with six JSON files.

$summarise = Join-Path $root 'scripts\summarise_e1a.py'
if (Test-Path $summarise) {
  Say 'building comparison table'
  & $Python $summarise *> (Join-Path $logDir '_e1a-summary.log')
  Say ('  -> ' + (Join-Path $logDir '_e1a-summary.log'))
}

Say '=== E1-a chain end ==='
Write-Output ''
Write-Output ('chain log: ' + $chain)
Write-Output ''
