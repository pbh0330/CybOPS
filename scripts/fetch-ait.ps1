# AIT-LDS v2.0 sequential acquisition.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-ait.ps1
#
# Safe to re-run at any time. Completed files are skipped, partial files resume
# from their current byte offset via curl -C -.
#
# ASCII only: Windows PowerShell 5.1 misreads UTF-8 script files without BOM,
# which silently dropped an array element on an earlier run. Do not add
# non-ASCII characters to this file, not even in comments.
#
# Rules learned the hard way (see docs/05-data-lifecycle.md):
#  1) One connection at a time. Zenodo rate-limits guests (HTTP 429).
#  2) No curl --retry: it truncated the -o target to 0 bytes.
#     Retry from the outer loop with -C - instead.
#  3) One HEAD per file, immediately before downloading it.
#  4) If the file shrinks, stop and log it.

$ErrorActionPreference = 'Continue'

$dest = 'F:\mc-cycop-data\raw\ait-lds-v2'
$log  = Join-Path $dest '_acquire.log'

# smallest first, so the pipeline-development file lands early
$files = @(
  'russellmitchell.zip',
  'santos.zip',
  'fox.zip',
  'harrison.zip',
  'wardbeck.zip',
  'shaw.zip',
  'wheeler.zip',
  'wilson.zip'
)

function Log($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $m
  Add-Content -Path $log -Value $line -Encoding utf8
}

if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
Log "=== sequential acquire start, file count = $($files.Count) ==="
foreach ($f in $files) { Log "  queued: $f" }

function Get-Expected($url) {
  for ($i=1; $i -le 6; $i++) {
    try {
      $h = Invoke-WebRequest -Uri $url -Method Head -MaximumRedirection 5 -UseBasicParsing -ErrorAction Stop
      return [int64]$h.Headers['Content-Length']
    } catch {
      $wait = 30 * $i
      Log "  HEAD attempt $i failed, waiting $wait s"
      Start-Sleep -Seconds $wait
    }
  }
  return 0
}

foreach ($name in $files) {
  $url = "https://zenodo.org/records/5789064/files/$name" + "?download=1"
  $out = Join-Path $dest $name

  $expected = Get-Expected $url
  if ($expected -le 0) { Log "SKIP $name (size unknown)"; continue }

  $cur = 0
  if (Test-Path $out) { $cur = (Get-Item $out).Length }
  if ($cur -ge $expected) {
    Log ("SKIP $name already complete, {0} GB" -f [math]::Round($cur/1GB,2))
    continue
  }

  Log ("START $name  target {0} GB, have {1} GB" -f [math]::Round($expected/1GB,2), [math]::Round($cur/1GB,2))

  $stall = 0
  $attempt = 0
  while ($true) {
    $attempt++
    $before = 0
    if (Test-Path $out) { $before = (Get-Item $out).Length }
    if ($before -ge $expected) { break }

    $t0 = Get-Date
    & curl.exe -sS -L -C - --connect-timeout 30 --speed-limit 8192 --speed-time 90 -o $out $url 2>$null
    $secs = [math]::Max(1, ((Get-Date) - $t0).TotalSeconds)

    $after = 0
    if (Test-Path $out) { $after = (Get-Item $out).Length }

    if ($after -lt $before) {
      Log ("  TRUNCATION DETECTED {0} -> {1}, aborting this file" -f $before, $after)
      break
    }

    $gain = $after - $before
    Log ("  #{0} +{1} MB at {2} MB/s, total {3}/{4} GB" -f $attempt,
         [math]::Round($gain/1MB,1),
         [math]::Round($gain/1MB/$secs,2),
         [math]::Round($after/1GB,2),
         [math]::Round($expected/1GB,2))

    if ($after -ge $expected) { break }

    if ($gain -le 0) {
      $stall++
      if ($stall -ge 12) { Log "  giving up: 12 consecutive attempts with no progress"; break }
      Start-Sleep -Seconds ([math]::Min(120, 15 * $stall))
    } else {
      $stall = 0
      Start-Sleep -Seconds 5
    }
  }

  $final = 0
  if (Test-Path $out) { $final = (Get-Item $out).Length }
  if ($final -ge $expected) {
    Log ("DONE  $name  {0} GB" -f [math]::Round($final/1GB,2))
    try {
      $h = (Get-FileHash -Path $out -Algorithm SHA256).Hash
      Log "  sha256 $name $h"
    } catch { Log "  sha256 failed for $name" }
  } else {
    Log ("FAIL  $name  {0}/{1} GB" -f [math]::Round($final/1GB,2), [math]::Round($expected/1GB,2))
  }

  Start-Sleep -Seconds 10
}

Log "=== sequential acquire end ==="
foreach ($f in $files) {
  $p = Join-Path $dest $f
  if (Test-Path $p) { Log ("final {0}  {1} GB" -f $f, [math]::Round((Get-Item $p).Length/1GB,2)) }
  else { Log ("MISSING {0}" -f $f) }
}
