# Settle the timezone question before any E1-b label is generated.
#
# ASCII ONLY IN THIS FILE.
#
# WHY THIS RUNS FIRST
#
# The ground truth gives wall-clock times ("09/23/19 11:23:29") with no timezone.
# eCAR timestamps carry one ("2019-09-23T15:36:00.084-04:00"). If those two are
# not the same clock, every (host, window) label in E1-b is shifted by hours and
# the experiment measures nothing - it would still produce PR-AUC numbers, which
# is what makes it dangerous. A silent four-hour offset does not throw.
#
# So: the first ground truth entry names a file.
#
#   09/23/19 11:23:29  "Manually accessed console on Sysclient0201 and navigated
#                       to news.com:8000 to download runme.bat"
#
# Find "runme.bat" in SysClient0201's eCAR and read its timestamp. Whatever
# offset comes back is the offset, measured rather than assumed.
#
# Usage:
#   .\scripts\Test-OptcTimeAlign.ps1
#   .\scripts\Test-OptcTimeAlign.ps1 -Needle "runme.bat" -Host "SysClient0201"

param(
  [string]$Bundle = 'F:\mc-cycop-data\raw\optc\ecar\evaluation\23Sep19-red\AIA-201-225\AIA-201-225.ecar-last.json.gz',
  [string]$Needle = 'runme.bat',
  [string]$HostName = 'SysClient0201',
  [int]   $MaxHits = 12
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Bundle)) { throw "bundle not found: $Bundle" }

Write-Output ''
Write-Output 'OpTC time alignment check'
Write-Output ('-' * 70)
Write-Output ("  bundle : {0}" -f (Split-Path $Bundle -Leaf))
Write-Output ("  needle : {0}   host filter: {1}" -f $Needle, $HostName)
Write-Output ''

$fs = [IO.File]::OpenRead($Bundle)
$gz = New-Object IO.Compression.GzipStream($fs, [IO.Compression.CompressionMode]::Decompress)
$sr = New-Object IO.StreamReader($gz, [Text.Encoding]::ASCII, $false, 1048576)

$hits = New-Object System.Collections.ArrayList
$lines = 0
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($null -ne ($line = $sr.ReadLine())) {
  $lines++
  if ($line.IndexOf($Needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
  if ($HostName -and $line.IndexOf($HostName, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
  [void]$hits.Add($line)
  if ($hits.Count -ge $MaxHits) { break }
}
$sr.Close()
$sw.Stop()

Write-Output ("  scanned {0:N0} lines in {1:N0} s" -f $lines, $sw.Elapsed.TotalSeconds)
Write-Output ("  hits    {0}" -f $hits.Count)
Write-Output ''

if ($hits.Count -eq 0) {
  Write-Output '  NO HITS. The needle may be spelled differently in telemetry, or the'
  Write-Output '  action left no file-named record. Try another needle before assuming'
  Write-Output '  anything about the clock.'
  Write-Output ''
  exit 1
}

foreach ($h in $hits) {
  $o = $h | ConvertFrom-Json
  $ts = [string]$o.timestamp
  $act = [string]$o.action
  $obj = [string]$o.object
  $path = ''
  foreach ($n in @('file_path', 'image_path', 'command_line')) {
    if ($o.properties -and $o.properties.$n) { $path = [string]$o.properties.$n; break }
  }
  Write-Output ("  {0}  {1,-8} {2,-8} {3}" -f $ts, $act, $obj, $path)
}

Write-Output ''
$first = ($hits[0] | ConvertFrom-Json).timestamp
$dto = [datetimeoffset]::Parse($first)
Write-Output ("  earliest hit    : {0}" -f $dto.ToString('yyyy-MM-dd HH:mm:ss zzz'))
Write-Output ("  as UTC          : {0}" -f $dto.UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss'))
Write-Output ''
Write-Output '  ground truth says 09/23/19 11:23:29 for this action.'
Write-Output ('  local-clock difference: {0:N1} minutes' -f `
              ($dto.DateTime - [datetime]::ParseExact('2019-09-23 11:23:29', 'yyyy-MM-dd HH:mm:ss', $null)).TotalMinutes)
Write-Output ''
Write-Output '  If that difference is small, ground truth times are the eCAR LOCAL clock'
Write-Output '  (-04:00) and window labels use the local wall clock. If it is about 240'
Write-Output '  minutes, ground truth is UTC and every label must be shifted.'
Write-Output ''
