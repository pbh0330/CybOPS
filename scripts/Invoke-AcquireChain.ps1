# Invoke-AcquireChain.ps1
# Unattended acquisition chain: wait for LANL auth.txt.gz -> file it -> verify
# integrity -> then resume the AIT-LDS downloads.
#
# Runs for hours. Launch it detached so it outlives the shell that started it:
#   Start-Process powershell -WindowStyle Hidden -ArgumentList @(
#     '-NoProfile','-ExecutionPolicy','Bypass','-File',
#     'F:\F\other_class\CybOPS\scripts\Invoke-AcquireChain.ps1')
#
# Watch it with:
#   Get-Content F:\mc-cycop-data\raw\lanl-cyber1\_chain.log -Wait -Tail 30
# Stop it with:
#   Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
#     Where-Object { $_.CommandLine -like '*Invoke-AcquireChain*' } |
#     ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
#
# Why AIT waits for LANL: the line runs at roughly 0.4-0.6 MB/s total. Two
# transfers do not go faster, they split the same pipe, and a stalled LANL
# retry needs the bandwidth free. AIT is the lower-priority dataset.
#
# ASCII only: Windows PowerShell 5.1 misreads BOM-less UTF-8 script files.

[CmdletBinding()]
param(
    [string] $Repo = 'F:\F\other_class\CybOPS',
    [string] $LanlDir = 'F:\mc-cycop-data\raw\lanl-cyber1',
    [string] $DownloadDir = 'C:\Users\qwert\Downloads',
    [string] $AuthName = 'auth.txt.gz',
    [long]   $AuthExpectedBytes = 7626505158,

    # Signed URL expiry. After this, Chrome cannot resume either.
    [long]   $DeadlineUnix = 1788636506,

    [int]    $IntervalSeconds = 60,

    # Consecutive zero-growth polls before giving up on Chrome.
    [int]    $StallPolls = 15,

    # After auth fails, how long to wait for a retry before starting AIT anyway.
    [int]    $GraceMinutes = 45
)

$ErrorActionPreference = 'Continue'
$log = Join-Path $LanlDir '_chain.log'

function Log($m) {
    $line = "{0}  {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $m
    Add-Content -Path $log -Value $line -Encoding utf8
}

# Get-ChildItem reads cached directory entries. While Chrome holds a write
# handle open, that cached size lags the real one by minutes - observed
# reporting 914 MB for a file that was actually at 1,049 MB. Polling it would
# make a healthy download look stalled. Open the file instead (sharing
# ReadWrite so Chrome keeps writing) and ask the file system directly.
function Get-LiveLength([string] $p) {
    try {
        $fs = [System.IO.File]::Open($p, [System.IO.FileMode]::Open,
                                         [System.IO.FileAccess]::Read,
                                         [System.IO.FileShare]::ReadWrite)
        $len = $fs.Length
        $fs.Close()
        return $len
    } catch {
        try { return (Get-Item -LiteralPath $p -Force).Length } catch { return -1 }
    }
}

# 0 means "no known deadline" - use it when Chrome holds a URL we were not given.
$deadline = $null
if ($DeadlineUnix -gt 0) {
    $deadline = [DateTimeOffset]::FromUnixTimeSeconds($DeadlineUnix).ToLocalTime().DateTime
}

Log '=========================================================='
Log '=== acquire chain start ==='
Log ("  step 1: wait for {0} ({1:N2} GB)" -f $AuthName, ($AuthExpectedBytes/1GB))
if ($deadline) { Log ("  url deadline {0}" -f $deadline.ToString('MM-dd HH:mm:ss')) }
else           { Log '  url deadline unknown (Chrome holds the link)' }
Log '  step 2: file + verify   step 3: resume AIT'

$final = Join-Path $DownloadDir $AuthName
$dest  = Join-Path $LanlDir $AuthName

# ---------------------------------------------------------------- step 1
# Chrome writes to "<something>.crdownload" and renames on completion, so we
# track whichever partial is growing rather than a fixed name.

$peak = 0
$last = -1
$lastTime = Get-Date
$stall = 0
$authOk = $false
$tracked = $null

while ($true) {

    if (Test-Path -LiteralPath $dest) {
        $sz = Get-LiveLength $dest
        if ($sz -ge $AuthExpectedBytes) {
            Log ("  already in place: {0:N0} B" -f $sz)
            $authOk = $true
            break
        }
    }

    # Chrome renames "<something>.crdownload" to the name it chose when the
    # download started. That is normally auth.txt.gz, but a pre-existing file
    # of that name would have made it "auth (1).txt.gz". Accept either, and
    # prefer an exact size match over the name.
    $done = $null
    if (Test-Path -LiteralPath $final) {
        $done = $final
    } else {
        $cand = @(Get-ChildItem -LiteralPath $DownloadDir -Filter 'auth*.txt.gz' -File -Force -ErrorAction SilentlyContinue |
                  ForEach-Object { [PSCustomObject]@{ Path = $_.FullName; Size = (Get-LiveLength $_.FullName) } } |
                  Sort-Object @{ e = { [math]::Abs($_.Size - $AuthExpectedBytes) } })
        if ($cand.Count -gt 0) {
            $done = $cand[0].Path
            Log ("  found finished file under a different name: {0}" -f (Split-Path $done -Leaf))
        }
    }

    if ($done) {
        $sz = Get-LiveLength $done
        Log ("  DOWNLOAD FINISHED in Downloads: {0:N0} B" -f $sz)
        if ($sz -ne $AuthExpectedBytes) {
            Log ("  *** SIZE MISMATCH: expected {0:N0} B ***" -f $AuthExpectedBytes)
        }
        try {
            Move-Item -LiteralPath $done -Destination $dest -Force
            Log ("  moved -> {0}" -f $dest)
            $authOk = $true
        } catch {
            Log ('  move failed: ' + $_.Exception.Message)
        }
        break
    }

    # Names only from the directory listing; sizes always re-read live.
    $parts = @(Get-ChildItem -LiteralPath $DownloadDir -Filter *.crdownload -Force -ErrorAction SilentlyContinue |
               ForEach-Object { [PSCustomObject]@{ Path = $_.FullName; Size = (Get-LiveLength $_.FullName) } } |
               Sort-Object Size -Descending)
    if ($parts.Count -eq 0) {
        Log '  no .crdownload and no finished file - Chrome download is gone. Stopping.'
        break
    }

    # Pin the file we picked first. Downloads unrelated to auth.txt.gz can sit
    # in the same folder, and on 2026-09-06 the auth partial collapsed from
    # 7.62 GB and the watcher silently began tracking an abandoned 11 MB file
    # instead - reporting "0.2%" for a download that no longer existed.
    if ($tracked) {
        $hit = @($parts | Where-Object { $_.Path -eq $tracked })
        if ($hit.Count -eq 0) {
            Log ("  tracked partial vanished: {0}" -f (Split-Path $tracked -Leaf))
            Log '  (it either completed under another name, or Chrome discarded it)'
            $tracked = $null
            continue    # re-check for a finished file at the top of the loop
        }
        $p = $hit[0]
    } else {
        $p = $parts[0]
        $tracked = $p.Path
        Log ("  tracking {0} ({1:N0} MB)" -f (Split-Path $tracked -Leaf), ($p.Size/1MB))
    }

    $now = Get-Date
    $size = $p.Size
    if ($size -lt 0) { Log '  could not stat the partial file, retrying'; Start-Sleep -Seconds $IntervalSeconds; continue }

    # A large drop means Chrome restarted the transfer rather than resuming.
    # Say so immediately instead of spending 15 polls looking "stalled".
    if ($peak -gt 0 -and $size -lt ($peak * 0.5)) {
        Log ("  *** RESTARTED FROM SCRATCH: {0:N0} MB, was {1:N0} MB ({2:N2}% of target) ***" -f `
             ($size/1MB), ($peak/1MB), ($peak/$AuthExpectedBytes*100))
        Log '  Chrome does not resume this download reliably. Prefer scripts\fetch-lanl.ps1.'
        $peak = $size
        $last = -1
    }

    $secs = [math]::Max(1, ($now - $lastTime).TotalSeconds)

    if ($last -ge 0) {
        $gain = $size - $last
        if ($size -lt $peak) {
            Log ("  *** SHRANK {0:N0} -> {1:N0} B (peak {2:N0}) ***" -f $last, $size, $peak)
        }
        $rate = $gain / $secs
        $eta = 'n/a'
        if ($rate -gt 0) {
            $eta = ((Get-Date).AddSeconds(($AuthExpectedBytes - $size) / $rate)).ToString('MM-dd HH:mm')
        }
        Log ("  {0:N0} MB ({1:N1}%)  {2:N2} MB/s  eta {3}" -f `
             ($size/1MB), ($size/$AuthExpectedBytes*100), ($rate/1MB), $eta)

        if ($gain -le 0) {
            $stall++
            if ($stall -ge $StallPolls) {
                Log ("  *** STALLED: {0} polls with no growth at {1:N0} MB ***" -f $stall, ($size/1MB))
                Log '  To take over: cancel the Chrome download, then run'
                Log '    .\scripts\fetch-lanl.ps1 -Name auth.txt.gz -Url "<fresh data-fence url>"'
                break
            }
        } else {
            $stall = 0
        }
    }

    if ($size -gt $peak) { $peak = $size }
    $last = $size
    $lastTime = $now

    if ($deadline -and (Get-Date) -gt $deadline) {
        Log '  *** URL DEADLINE PASSED - request a fresh link from csr.lanl.gov ***'
        break
    }

    Start-Sleep -Seconds $IntervalSeconds
}

# ---------------------------------------------------------------- step 1b
# Grace window before giving up on auth.
#
# The first version of this script refused to start AIT whenever auth failed,
# reasoning that the line should stay free for an immediate retry. On
# 2026-09-06 auth died at 01:14 and the chain stopped at 01:26 - then nothing
# ran for fourteen hours, because the retry needed a human who was asleep.
# Idle bandwidth is not saved bandwidth. Wait a while for a retry, then put
# the line to work on AIT, which is resumable and can be interrupted freely.
if (-not $authOk) {
    Log ("=== step 1b: auth not acquired. Waiting {0} min for a retry ===" -f $GraceMinutes)
    $graceEnd = (Get-Date).AddMinutes($GraceMinutes)
    while ((Get-Date) -lt $graceEnd) {
        Start-Sleep -Seconds $IntervalSeconds
        if (Test-Path -LiteralPath $dest) {
            if ((Get-LiveLength $dest) -ge $AuthExpectedBytes) { $authOk = $true; break }
        }
        $cand = @(Get-ChildItem -LiteralPath $DownloadDir -Filter 'auth*.txt.gz' -File -Force -ErrorAction SilentlyContinue |
                  Where-Object { (Get-LiveLength $_.FullName) -eq $AuthExpectedBytes })
        if ($cand.Count -gt 0) {
            Move-Item -LiteralPath $cand[0].FullName -Destination $dest -Force
            Log ('  retry finished, moved -> ' + $dest)
            $authOk = $true
            break
        }
        $growing = @(Get-ChildItem -LiteralPath $DownloadDir -Filter *.crdownload -Force -ErrorAction SilentlyContinue |
                     Where-Object { (Get-LiveLength $_.FullName) -gt 100MB })
        if ($growing.Count -gt 0) {
            Log '  a large partial reappeared - a retry is running, extending the wait'
            $graceEnd = (Get-Date).AddMinutes($GraceMinutes)
        }
    }
    if (-not $authOk) {
        Log '  no retry completed. Starting AIT so the line is not idle.'
        Log '  auth.txt.gz still needs a fresh data-fence URL -> scripts\fetch-lanl.ps1'
    }
}

# ---------------------------------------------------------------- step 2
if ($authOk) {
Log '=== step 2: integrity check ==='
$verifier = Join-Path $Repo 'scripts\Test-GzipIntegrity.ps1'
$vlog = Join-Path $LanlDir '_auth-verify.log'
& powershell -NoProfile -ExecutionPolicy Bypass -File $verifier -Path $dest *>&1 |
    Tee-Object -FilePath $vlog | Out-Null
$verifyExit = $LASTEXITCODE

Get-Content $vlog | ForEach-Object { Log ('  ' + $_) }

if ($verifyExit -ne 0) {
    Log '  *** auth.txt.gz FAILED integrity check. It must be re-downloaded. ***'
    Log '  Continuing to AIT anyway - a corrupt file is not a reason to idle the line.'
} else {
    Log '  auth.txt.gz verified. LANL cyber1 is complete (5/5).'

    # Park the abandoned curl fragment; it is no longer a useful seed.
    $frag = Join-Path $LanlDir 'auth.txt.gz.curl-partial'
    if (Test-Path -LiteralPath $frag) {
        Remove-Item -LiteralPath $frag -Force
        Log '  removed auth.txt.gz.curl-partial (no longer needed)'
    }
}
}   # end if ($authOk)

# ---------------------------------------------------------------- step 3
Log '=== step 3: resume AIT-LDS v2.0 ==='
$ait = Join-Path $Repo 'scripts\fetch-ait.ps1'
if (-not (Test-Path $ait)) {
    Log ('  MISSING ' + $ait)
    exit 1
}
Log ('  handing off to ' + $ait)
Log '  progress: F:\mc-cycop-data\raw\ait-lds-v2\_acquire.log'

# 130 GB at ~0.6 MB/s is days of transfer. fetch-ait.ps1 abandons a file after
# 12 consecutive stalled attempts and moves on, which over that span is likely
# to happen at least once. Re-running is cheap and safe: complete files are
# skipped and partial ones resume, so loop until a pass changes nothing.
$aitDir = 'F:\mc-cycop-data\raw\ait-lds-v2'
$aitFiles = @('russellmitchell.zip','santos.zip','fox.zip','harrison.zip',
              'wardbeck.zip','shaw.zip','wheeler.zip','wilson.zip')

function Get-AitTotal {
    $t = [long]0
    foreach ($f in $aitFiles) {
        $p = Join-Path $aitDir $f
        if (Test-Path -LiteralPath $p) { $t += (Get-Item -LiteralPath $p).Length }
    }
    return $t
}

$pass = 0
$maxPasses = 12
while ($pass -lt $maxPasses) {
    $pass++
    $before = Get-AitTotal
    Log ("--- AIT pass {0}/{1}, have {2:N2} GB ---" -f $pass, $maxPasses, ($before/1GB))

    & powershell -NoProfile -ExecutionPolicy Bypass -File $ait
    $code = $LASTEXITCODE

    $after = Get-AitTotal
    $gained = $after - $before
    Log ("--- AIT pass {0} done (exit {1}), +{2:N2} GB, total {3:N2} GB ---" -f `
         $pass, $code, ($gained/1GB), ($after/1GB))

    if ($gained -le 0) {
        Log '  pass gained nothing - stopping. Check _acquire.log for the reason.'
        break
    }
    Start-Sleep -Seconds 120
}

Log ("=== chain end: AIT total {0:N2} GB after {1} pass(es) ===" -f ((Get-AitTotal)/1GB), $pass)
