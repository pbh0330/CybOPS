# Re-run the OpTC fetch on a timer so that each quota release gets used.
#
# ASCII only in this file (CLAUDE.md encoding rule 1).
#
# WHY A TIMER AND NOT A LONGER RETRY LOOP
#
# Google Drive refuses a file whose per-file download quota is exhausted, and
# it refuses it for hours. fetch-optc.ps1 now recognises that refusal in two
# seconds instead of twelve minutes, so a full pass over the 100 file list
# takes minutes and comes back with whatever was not blocked. Retrying harder
# inside that pass would achieve nothing: the block is on the far side and it
# lifts on its own schedule.
#
# So the useful thing is to come back later, repeatedly, unattended. Each pass
# is a resume: files already complete are skipped by size, partial files
# continue with curl -C -, and blocked files are logged and left for the next
# pass.
#
# THIS ONLY DOWNLOADS. It never deletes anything. ADR-0010 and CLAUDE.md put
# dataset deletion behind a VERIFY gate and a human, and forbid a cron that
# tidies up on its own; nothing here touches that path.
#
# Usage:
#   .\scripts\Resume-OptcFetch.ps1                       # 6 passes, 90 min apart
#   .\scripts\Resume-OptcFetch.ps1 -Passes 12 -Minutes 45
#
# Run it in the background and read F:\mc-cycop-data\raw\optc\_acquire.log.

param(
  [int]$Passes  = 6,
  [int]$Minutes = 90,
  [int[]]$Phase = @(3, 4, 5),
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root = Split-Path $PSScriptRoot -Parent
if (-not $LogPath) { $LogPath = Join-Path $root 'analysis\logs\optc-resume.log' }
$dir = Split-Path $LogPath -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

function Write-Line([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date).ToString('MM-dd HH:mm:ss'), $msg
  Write-Output $line
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-RawBytes {
  $p = 'F:\mc-cycop-data\raw\optc'
  if (-not (Test-Path $p)) { return 0 }
  $m = Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum
  return [double]$m.Sum
}

Write-Line ("=== resume loop start: {0} passes, {1} min apart, phases {2} ===" -f $Passes, $Minutes, ($Phase -join ','))

for ($i = 1; $i -le $Passes; $i++) {

  # A reader can break the writer. On 2026-09-09 pass 2 died instantly with
  # "the file is in use by another process": a tail -f on _acquire.log, armed
  # to watch for completed downloads, held a handle that fetch-optc.ps1 could
  # not append through. Watching a log is not a read-only act on Windows.
  # Read the log with Get-Content after the fact, not with a live tail.

  # Do not start a second fetch on top of a running one. Two curls resuming the
  # same file with -C - would interleave writes into one -o target, and the
  # result would be the right length and the wrong bytes - the exact failure
  # the gzip magic check exists to catch, arrived at by a different road.
  $busy = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like '*fetch-optc*' })
  if ($busy.Count -gt 0) {
    Write-Line ("pass {0}/{1}: a fetch is already running (pid {2}), skipping this slot" -f $i, $Passes, ($busy[0].ProcessId))
  } else {
    $before = Get-RawBytes
    Write-Line ("pass {0}/{1}: starting, have {2:N1} GB" -f $i, $Passes, ($before / 1GB))
    try {
      # -SmallestFirst: a pass does not get a fraction of the bytes, it gets
      # whichever FILES are not quota-blocked right now. Taking the small ones
      # first finishes more of them per window, and a host range is only usable
      # when its file is complete.
      & (Join-Path $PSScriptRoot 'fetch-optc.ps1') -Phase $Phase -SmallestFirst -Confirm *>&1 | Out-Null
    } catch {
      Write-Line ("pass {0}/{1}: fetch threw: {2}" -f $i, $Passes, $_.Exception.Message)
    }
    $after = Get-RawBytes
    Write-Line ("pass {0}/{1}: done, {2:N1} GB -> {3:N1} GB (+{4:N2} GB)" -f `
      $i, $Passes, ($before / 1GB), ($after / 1GB), (($after - $before) / 1GB))
  }

  if ($i -lt $Passes) {
    Write-Line ("sleeping {0} min" -f $Minutes)
    Start-Sleep -Seconds ($Minutes * 60)
  }
}

Write-Line ("=== resume loop end, {0:N1} GB on disk ===" -f ((Get-RawBytes) / 1GB))
