# Test-GzipIntegrity.ps1
# Verify a downloaded .gz is complete, not merely the right size.
#
# Why: Chrome once resumed a LANL download incorrectly and the partial file
# SHRANK from 1,370 MB to 551 MB. File size alone proves nothing.
#
# How: GzipStream validates CRC32 and ISIZE when it reaches end of stream, so a
# truncated or corrupted member throws. We also surface the last decoded line;
# for LANL cyber1 the final timestamp must reach 5011199 (58 days of capture).
#
# ASCII-only source on purpose. Windows PowerShell 5.1 reads a BOM-less UTF-8
# script as ANSI, which silently mangles non-ASCII literals (see docs/07).
#
# Usage:
#   .\scripts\Test-GzipIntegrity.ps1 -Path F:\mc-cycop-data\raw\lanl-cyber1\auth.txt.gz
#   .\scripts\Test-GzipIntegrity.ps1 -Path F:\mc-cycop-data\raw\lanl-cyber1 -NoHash

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    # Skip SHA256. Hashing re-reads the whole file; skip it for a quick check.
    [switch] $NoHash,

    # LANL cyber1 capture ends at this second. 0 disables the check.
    [long] $ExpectedLastTimestamp = 5011199,

    # Skip files a previous run already passed. Acquisition is incremental: the
    # OpTC tree grows by a handful of files a day, and re-decompressing 180 GB
    # to check 28 new ones costs hours for nothing. Point this at the log of an
    # earlier run and only the files it does not name are read.
    #
    # Matching is on the FULL PATH the earlier run logged. It used to match on
    # file name, and that was wrong: AIA-301-325.ecar-last.json.gz exists under
    # four day-folders and ecar-bro ships 80 files called ecarbro.json.gz, so a
    # name match marked unread files as verified. A skip that is wrong is worse
    # than no skip at all, because the manifest then claims an integrity check
    # that never happened.
    [string] $SkipLog = ''
)

function Test-OneFile {
    param([string] $File)

    $item = Get-Item -LiteralPath $File
    Write-Host ''
    # The full path, not the name. Names repeat across the tree
    # (AIA-301-325.ecar-last.json.gz exists under four day-folders, and
    # ecar-bro ships 80 files called ecarbro.json.gz), so a log keyed by name
    # cannot say which file was read. -SkipLog depends on this being exact.
    Write-Host ('=== ' + $item.FullName + ' ===')
    Write-Host ('  compressed   : {0:N0} B ({1:N2} GB)' -f $item.Length, ($item.Length / 1GB))

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $fs = [System.IO.File]::OpenRead($File)
    $gz = New-Object System.IO.Compression.GzipStream($fs, [System.IO.Compression.CompressionMode]::Decompress)

    $buf = New-Object byte[] (4MB)
    $tailSize = 4096
    $tail = New-Object byte[] $tailSize
    $total = [long]0
    $ok = $true
    $err = ''

    try {
        while (($n = $gz.Read($buf, 0, $buf.Length)) -gt 0) {
            $total += $n
            if ($n -ge $tailSize) {
                [Array]::Copy($buf, $n - $tailSize, $tail, 0, $tailSize)
            } else {
                [Array]::Copy($tail, $n, $tail, 0, $tailSize - $n)
                [Array]::Copy($buf, 0, $tail, $tailSize - $n, $n)
            }
        }
    } catch {
        $ok = $false
        $err = $_.Exception.Message
    } finally {
        $gz.Close()
        $fs.Close()
    }
    $sw.Stop()

    if ($ok) {
        Write-Host '  gzip         : OK (CRC32 + ISIZE verified)' -ForegroundColor Green
    } else {
        Write-Host ('  gzip         : FAILED - ' + $err) -ForegroundColor Red
    }
    Write-Host ('  uncompressed : {0:N0} B ({1:N2} GB)' -f $total, ($total / 1GB))
    Write-Host ('  elapsed      : {0:N1} s' -f $sw.Elapsed.TotalSeconds)

    $lastLine = $null
    if ($total -gt 0) {
        $txt = [System.Text.Encoding]::ASCII.GetString($tail)
        $ls = @($txt -split "`n" | Where-Object { $_.Trim() -ne '' })
        if ($ls.Count -gt 0) {
            $lastLine = $ls[-1].Trim()
            Write-Host ('  last record  : ' + $lastLine)
        }
    }

    # LANL cyber1 files are all "<seconds>,..." records.
    #
    # redteam.txt.gz is the exception: red team activity ends on day 30 of the
    # 58-day capture, so its last timestamp is 2557047 by design, not truncation.
    # Only the continuous telemetry files run to the end.
    $expected = $ExpectedLastTimestamp
    if ($item.Name -eq 'redteam.txt.gz') { $expected = 2557047 }

    $tsOk = $null
    if ($expected -gt 0 -and $lastLine -match '^(\d+),') {
        $ts = [long]$matches[1]
        $tsOk = ($ts -eq $expected)
        if ($tsOk) {
            Write-Host ('  last t       : {0} - matches expected end' -f $ts) -ForegroundColor Green
        } else {
            Write-Host ('  last t       : {0} - expected {1}, file may be short' -f $ts, $expected) -ForegroundColor Yellow
        }
    }

    $sha = $null
    if (-not $NoHash) {
        $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash
        Write-Host ('  sha256       : ' + $sha)
    }

    [PSCustomObject]@{
        File             = $item.Name
        CompressedBytes  = $item.Length
        UncompressedBytes = $total
        GzipOk           = $ok
        Error            = $err
        LastRecord       = $lastLine
        LastTimestampOk  = $tsOk
        Sha256           = $sha
    }
}

if (-not (Test-Path -LiteralPath $Path)) {
    throw ('Not found: ' + $Path)
}

# -Recurse matters. This was written against LANL cyber1, which is a flat
# directory of eight files, so the omission was invisible. OpTC is a tree
# (ecar/<day>/<host>/*.gz, 900 files deep in subdirectories) and the check
# reported "No .gz files under: <path>" while sitting on 41 GB of them. The
# error message already said "under", which is what the code should have done.
$targets = @()
if ((Get-Item -LiteralPath $Path).PSIsContainer) {
    $targets = @(Get-ChildItem -LiteralPath $Path -Filter *.gz -File -Recurse | Sort-Object Length)
} else {
    $targets = @(Get-Item -LiteralPath $Path)
}

if ($SkipLog) {
    if (-not (Test-Path -LiteralPath $SkipLog)) { throw ('SkipLog not found: ' + $SkipLog) }
    $seen = @{}
    foreach ($line in [IO.File]::ReadLines((Resolve-Path $SkipLog))) {
        if ($line -match '^===\s+(.+\.gz)\s+===$') { $seen[$Matches[1].Trim()] = $true }
    }
    $before = $targets.Count
    $targets = @($targets | Where-Object { -not $seen.ContainsKey($_.FullName) })
    if ($targets.Count -eq $before -and $seen.Count -gt 0) {
        # Every target survived the filter. Either none were checked before, or
        # the log predates full-path headers and matches nothing. Say so, because
        # silently re-reading 180 GB looks like the tool is stuck.
        Write-Output 'skip log matched nothing (a log written before full-path headers will not match; everything is re-checked)'
    }
    Write-Output ("skip log: {0} file(s) already verified, {1} of {2} left to check" -f `
        $seen.Count, $targets.Count, $before)
    if ($targets.Count -eq 0) {
        Write-Output 'nothing new to verify.'
        exit 0
    }
}

if ($targets.Count -eq 0) {
    throw ('No .gz files under: ' + $Path)
}

$results = foreach ($t in $targets) { Test-OneFile -File $t.FullName }

Write-Host ''
Write-Host '=== summary ==='
$results | Format-Table File, GzipOk, LastTimestampOk, CompressedBytes, UncompressedBytes -AutoSize

$bad = @($results | Where-Object { -not $_.GzipOk })
if ($bad.Count -gt 0) {
    Write-Host ('FAILED: ' + $bad.Count + ' file(s) are incomplete or corrupt. Re-download them.') -ForegroundColor Red
    exit 1
}
Write-Host 'All files passed gzip integrity check.' -ForegroundColor Green
exit 0
