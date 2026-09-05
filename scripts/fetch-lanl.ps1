# LANL cyber1 acquisition via a signed data-fence URL.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-lanl.ps1 `
#       -Name auth.txt.gz -Url "https://csr.lanl.gov/data-fence/<token>/cyber1/auth.txt.gz"
#
# Safe to re-run. A complete file is skipped; a partial file resumes from its
# current byte offset via curl -C -.
#
# IMPORTANT - the URL expires. csr.lanl.gov hands out data-fence links whose
# first path segment is a Unix expiry timestamp. Check remaining time with:
#   [DateTimeOffset]::FromUnixTimeSeconds(<that number>).ToLocalTime()
# When it expires, request a fresh link from https://csr.lanl.gov/data/cyber1/
# and re-run this script; the partial file on disk is reused.
#
# ASCII only: Windows PowerShell 5.1 misreads UTF-8 script files without BOM,
# which silently dropped an array element on an earlier run. Do not add
# non-ASCII characters to this file, not even in comments.
#
# Rules carried over from fetch-ait.ps1 (see docs/05-data-lifecycle.md):
#  1) One connection at a time.
#  2) No curl --retry: it truncated the -o target to 0 bytes. Retry from the
#     outer loop with -C - instead.
#  3) If the file shrinks, stop and log it. Chrome once shrank a partial
#     download of this very file from 1,370 MB to 551 MB.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [Parameter(Mandatory = $true)]
    [string] $Url,

    [string] $Dest = 'F:\mc-cycop-data\raw\lanl-cyber1',

    # Abort after this many consecutive attempts that gain zero bytes.
    [int] $MaxStall = 12
)

$ErrorActionPreference = 'Continue'
$log = Join-Path $Dest '_acquire.log'

function Log($m) {
    $line = "{0}  {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $m
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Force -Path $Dest | Out-Null }

# Report token expiry up front so a stalled run has an obvious explanation.
if ($Url -match '/data-fence/(\d{9,11})/') {
    $exp = [DateTimeOffset]::FromUnixTimeSeconds([long]$matches[1]).ToLocalTime()
    $left = $exp - (Get-Date)
    Log ("=== fetch $Name ===")
    Log ("  token expires {0} ({1:N1} h left)" -f $exp.ToString('MM-dd HH:mm:ss'), $left.TotalHours)
    if ($left.TotalMinutes -lt 1) {
        Log '  TOKEN ALREADY EXPIRED - request a fresh link before running'
        exit 1
    }
} else {
    Log ("=== fetch $Name (no data-fence token found in URL) ===")
}

$out = Join-Path $Dest $Name

# One HEAD, immediately before downloading.
$expected = 0
try {
    $h = Invoke-WebRequest -Uri $Url -Method Head -MaximumRedirection 5 -UseBasicParsing -ErrorAction Stop
    $expected = [int64]$h.Headers['Content-Length']
} catch {
    Log ('  HEAD failed: ' + $_.Exception.Message)
}
if ($expected -le 0) {
    Log '  size unknown - will download until the server closes the stream'
}

$cur = 0
if (Test-Path $out) { $cur = (Get-Item $out).Length }
if ($expected -gt 0 -and $cur -ge $expected) {
    Log ("SKIP $Name already complete, {0:N2} GB" -f ($cur/1GB))
    exit 0
}

Log ("START $Name  target {0:N2} GB, have {1:N2} GB" -f ($expected/1GB), ($cur/1GB))

$stall = 0
$attempt = 0
while ($true) {
    $attempt++
    $before = 0
    if (Test-Path $out) { $before = (Get-Item $out).Length }
    if ($expected -gt 0 -and $before -ge $expected) { break }

    $t0 = Get-Date
    # --speed-limit/--speed-time: drop the connection if it falls under 8 KB/s
    # for 90 s, so a dead socket is retried instead of hanging forever.
    & curl.exe -sS -L -C - --connect-timeout 30 --speed-limit 8192 --speed-time 90 -o $out $Url 2>$null
    $secs = [math]::Max(1, ((Get-Date) - $t0).TotalSeconds)

    $after = 0
    if (Test-Path $out) { $after = (Get-Item $out).Length }

    if ($after -lt $before) {
        Log ("  TRUNCATION DETECTED {0} -> {1}, aborting" -f $before, $after)
        break
    }

    $gain = $after - $before
    Log ("  #{0} +{1:N1} MB at {2:N2} MB/s, total {3:N2}/{4:N2} GB" -f `
         $attempt, ($gain/1MB), ($gain/1MB/$secs), ($after/1GB), ($expected/1GB))

    if ($expected -gt 0 -and $after -ge $expected) { break }
    if ($expected -le 0 -and $gain -eq 0) { break }

    if ($gain -le 0) {
        $stall++
        if ($stall -ge $MaxStall) { Log "  giving up: $MaxStall consecutive attempts with no progress"; break }
        Start-Sleep -Seconds ([math]::Min(120, 15 * $stall))
    } else {
        $stall = 0
        Start-Sleep -Seconds 5
    }
}

$final = 0
if (Test-Path $out) { $final = (Get-Item $out).Length }

if ($expected -gt 0 -and $final -ge $expected) {
    Log ("DONE  $Name  {0:N2} GB" -f ($final/1GB))
    try {
        $sha = (Get-FileHash -Path $out -Algorithm SHA256).Hash
        Log "  sha256 $Name $sha"
    } catch { Log "  sha256 failed for $Name" }
    Log '  next: .\scripts\Test-GzipIntegrity.ps1 -Path "' + $out + '"'
    exit 0
} else {
    Log ("FAIL  $Name  {0:N2}/{1:N2} GB - re-run to resume" -f ($final/1GB), ($expected/1GB))
    exit 1
}
