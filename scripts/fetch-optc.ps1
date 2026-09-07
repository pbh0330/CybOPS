# fetch-optc.ps1
# DARPA OpTC minimal acquisition set: 30 red-team hosts x 3 days.
#
# The plan lives in configs\manifests\optc.json. This script only executes it,
# so changing what gets downloaded means editing that JSON, not this file
# (CLAUDE.md encoding rule 3: human-readable strings belong in JSON data).
#
# Usage:
#   .\scripts\fetch-optc.ps1 -List                  # print the plan, download nothing
#   .\scripts\fetch-optc.ps1 -Phase 1               # fetch phase 1 only
#   .\scripts\fetch-optc.ps1 -Phase 1,2 -Confirm    # fetch phases 1 and 2
#
# Nothing is downloaded without -Confirm. -List and a bare run both stop at the
# plan summary. A phase is tens to a hundred GB at 0.6-1.0 MB/s; starting one by
# accident costs days.
#
# Safe to re-run. A file whose length already equals the planned byte count is
# skipped; a partial file resumes from its offset with curl -C -.
#
# Google Drive notes:
#   - Public files are fetched from
#       https://drive.usercontent.google.com/download?id=<id>&export=download&confirm=t
#     which answers 206 Partial Content to a Range request, so curl -C - resumes.
#     No cookie, no uuid and no gdown are needed for this path; gdown is kept
#     installed only as a fallback if Google changes the endpoint.
#   - Drive throttles aggressively. One connection at a time, as with Zenodo
#     and LANL (docs/05-data-lifecycle.md, ACQUIRE lessons).
#
# Rules carried over from fetch-lanl.ps1 / fetch-ait.ps1:
#   1) One connection at a time.
#   2) Never curl --retry: it truncated the -o target to 0 bytes and cost 120 MB
#      of a 6.6 GB file. Retry from the outer loop with -C - instead.
#   3) If a file shrinks between attempts, stop and log it. Do not restart
#      silently - that is how days get lost.
#   4) One process per file. Do not run two copies of this script at once.
#
# ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI and
# silently mangles non-ASCII literals. It once dropped an array element that
# way. Do not add non-ASCII characters here, not even in comments.

[CmdletBinding()]
param(
    # Phase ids from the manifest's planned_files[].phase. Empty means all.
    [int[]] $Phase = @(),

    # Print the plan and exit. Implied when -Confirm is absent.
    [switch] $List,

    # Actually download. Without this the script stops after the summary.
    [switch] $Confirm,

    [string] $Manifest = '',

    # Abort a file after this many consecutive attempts that gain zero bytes.
    [int] $MaxStall = 10,

    # Re-fetch only these rel_paths (repeatable). Used to repair specific files
    # without walking the whole plan again.
    [string[]] $Only = @(),

    # Keep this much free on the chosen volume (docs/05-data-lifecycle.md).
    [double] $ReserveGB = 50
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir

if ($Manifest -eq '') {
    $Manifest = Join-Path $repoRoot 'configs\manifests\optc.json'
}
if (-not (Test-Path -LiteralPath $Manifest)) {
    throw ("Manifest not found: " + $Manifest)
}

# -Encoding utf8 on purpose: the manifest carries non-ASCII notes and this is
# the only safe way to read them under PowerShell 5.1.
$plan = Get-Content -LiteralPath $Manifest -Raw -Encoding utf8 | ConvertFrom-Json

$files = @($plan.planned_files)
if ($files.Count -eq 0) { throw 'Manifest has no planned_files.' }
if ($Phase.Count -gt 0) {
    $files = @($files | Where-Object { $Phase -contains [int]$_.phase })
}
if ($files.Count -eq 0) { throw ('No planned files for phase(s): ' + ($Phase -join ',')) }
if ($Only.Count -gt 0) {
    # rel_path is written with forward slashes in the manifest; accept either.
    $want = @($Only | ForEach-Object { ($_ -replace '\\', '/') })
    $files = @($files | Where-Object { $want -contains ($_.rel_path -replace '\\', '/') })
    if ($files.Count -eq 0) { throw ('None of -Only matched a planned rel_path: ' + ($Only -join ', ')) }
}

# Log the file count immediately. An encoding accident that swallows a list
# element shows up here and nowhere else (docs/05-data-lifecycle.md).
$totalBytes = 0
foreach ($f in $files) { $totalBytes += [int64]$f.bytes }
$needGB = [math]::Ceiling($totalBytes / 1GB)

Write-Host ''
Write-Host '=== OpTC acquisition plan ==='
Write-Host ('  manifest    : ' + $Manifest)
Write-Host ('  phases      : ' + $(if ($Phase.Count -gt 0) { $Phase -join ',' } else { 'all' }))
Write-Host ('  file count  : {0}' -f $files.Count)
Write-Host ('  total size  : {0:N2} GB' -f ($totalBytes / 1GB))

$byPhase = $files | Group-Object -Property phase | Sort-Object { [int]$_.Name }
Write-Host ''
Write-Host '  phase  files       GB  subset'
foreach ($g in $byPhase) {
    $gb = 0
    foreach ($f in $g.Group) { $gb += [int64]$f.bytes }
    $label = ($g.Group | Select-Object -First 1).phase_label
    Write-Host ('  {0,5}  {1,5}  {2,7:N2}  {3}' -f $g.Name, $g.Count, ($gb / 1GB), $label)
}

# Resolve the destination volume before anything is written. Get-DataRoot
# throws when no volume can hold the set with the reserve intact - better to
# fail here than three days into a download.
$getRoot = Join-Path $scriptDir 'Get-DataRoot.ps1'
$dest = & $getRoot -Dataset 'optc' -NeedGB $needGB -ReserveGB $ReserveGB
Write-Host ''
Write-Host ('  destination : ' + $dest)

# Report what is already on disk so a re-run states its true remaining cost.
$haveBytes = 0
$doneCount = 0
foreach ($f in $files) {
    $target = Join-Path $dest ($f.rel_path -replace '/', '\')
    if (Test-Path -LiteralPath $target) {
        $len = (Get-Item -LiteralPath $target).Length
        $haveBytes += $len
        if ($len -ge [int64]$f.bytes) { $doneCount++ }
    }
}
$remain = $totalBytes - $haveBytes
Write-Host ('  on disk     : {0:N2} GB, {1} of {2} files complete' -f ($haveBytes / 1GB), $doneCount, $files.Count)
Write-Host ('  remaining   : {0:N2} GB  (about {1:N1} h at 1.0 MB/s, {2:N1} h at 0.6 MB/s)' -f `
            ($remain / 1GB), ($remain / 1MB / 3600), ($remain / 1MB / 0.6 / 3600))
Write-Host ''

if ($List -or (-not $Confirm)) {
    Write-Host '  Nothing downloaded. Re-run with -Confirm to start.'
    Write-Host ''
    exit 0
}

$logPath = Join-Path $dest '_acquire.log'
function Write-Log([string] $msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

# Sidecar record of what actually landed. The manifest's acquisition_log is
# filled from this once a phase completes, so hashes survive a PURGE.
$hashPath = Join-Path $dest '_acquired.jsonl'

Write-Log ('=== fetch-optc start: {0} files, {1:N2} GB, phases {2} ===' -f `
           $files.Count, ($totalBytes / 1GB), $(if ($Phase.Count -gt 0) { $Phase -join ',' } else { 'all' }))

$idx = 0
$failed = 0
foreach ($f in $files) {
    $idx++
    $target = Join-Path $dest ($f.rel_path -replace '/', '\')
    $dir = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    $want = [int64]$f.bytes
    $have = 0
    if (Test-Path -LiteralPath $target) { $have = (Get-Item -LiteralPath $target).Length }

    if ($have -eq $want -and $want -gt 0) {
        Write-Log ('SKIP  [{0}/{1}] {2} already complete, {3:N2} GB' -f $idx, $files.Count, $f.rel_path, ($have / 1GB))
        continue
    }
    if ($want -gt 0 -and $have -gt $want) {
        Write-Log ('BAD   [{0}/{1}] {2} is larger than planned ({3} > {4}) - delete it and re-run' -f `
                   $idx, $files.Count, $f.rel_path, $have, $want)
        $failed++
        continue
    }

    $url = 'https://drive.usercontent.google.com/download?id=' + $f.drive_id + '&export=download&confirm=t'
    Write-Log ('START [{0}/{1}] {2}  target {3:N2} GB, have {4:N2} GB' -f `
               $idx, $files.Count, $f.rel_path, ($want / 1GB), ($have / 1GB))

    $stall = 0
    $attempt = 0
    while ($true) {
        $attempt++
        $before = 0
        if (Test-Path -LiteralPath $target) { $before = (Get-Item -LiteralPath $target).Length }
        if ($want -gt 0 -and $before -ge $want) { break }

        $t0 = Get-Date
        # --speed-limit/--speed-time drop a socket that falls under 8 KB/s for
        # 90 s, so a dead connection is retried instead of hanging all night.
        # No --retry here on purpose (rule 2 above).
        #
        # --fail is not optional. Without it curl writes the server's ERROR
        # BODY into -o, and Drive answers a transient overload with a ~1.6 KB
        # HTML page. The next attempt then resumes with `Range: bytes=1600-`,
        # Drive serves the real file from that offset, and the finished file is
        # [503 HTML][real gzip from 1600] whose length is EXACTLY the expected
        # byte count. The size check passes, the log says DONE, and six files
        # in the 2026-09-06 run were HTML-headed garbage that nothing noticed
        # until Test-GzipIntegrity read their magic number.
        & curl.exe -sS -f -L -C - --connect-timeout 30 --speed-limit 8192 --speed-time 90 -o $target $url 2>$null
        $secs = [math]::Max(1, ((Get-Date) - $t0).TotalSeconds)

        $after = 0
        if (Test-Path -LiteralPath $target) { $after = (Get-Item -LiteralPath $target).Length }

        if ($after -lt $before) {
            Write-Log ('  TRUNCATION DETECTED {0} -> {1}, aborting this file' -f $before, $after)
            break
        }

        $gain = $after - $before
        Write-Log ('  #{0} +{1:N1} MB at {2:N2} MB/s, total {3:N2}/{4:N2} GB' -f `
                   $attempt, ($gain / 1MB), ($gain / 1MB / $secs), ($after / 1GB), ($want / 1GB))

        if ($want -gt 0 -and $after -ge $want) { break }
        if ($want -le 0 -and $gain -eq 0) { break }

        if ($gain -le 0) {
            $stall++
            if ($stall -ge $MaxStall) {
                Write-Log ('  giving up on this file: {0} consecutive attempts with no progress' -f $MaxStall)
                break
            }
            # Back off. A Drive quota block clears on its own; hammering it does not help.
            Start-Sleep -Seconds ([math]::Min(180, 15 * $stall))
        } else {
            $stall = 0
            Start-Sleep -Seconds 3
        }
    }

    $final = 0
    if (Test-Path -LiteralPath $target) { $final = (Get-Item -LiteralPath $target).Length }

    # Size is not identity. A file can be exactly the right length and still be
    # the wrong bytes - see the --fail comment above. Two bytes of magic number
    # settle it, and reading two bytes costs nothing next to a 2 GB download.
    $magicOk = $true
    $magicWhy = ''
    if ($final -gt 0 -and $target -match '\.gz$') {
        try {
            $mfs = [IO.File]::OpenRead($target)
            $mb = New-Object byte[] 2
            $mn = $mfs.Read($mb, 0, 2)
            $mfs.Close()
            if ($mn -lt 2 -or $mb[0] -ne 0x1F -or $mb[1] -ne 0x8B) {
                $magicOk = $false
                $magicWhy = ('not gzip: first bytes {0:X2} {1:X2}' -f $mb[0], $mb[1])
            }
        } catch {
            $magicOk = $false
            $magicWhy = 'could not read header'
        }
    }

    if ($want -gt 0 -and $final -eq $want -and -not $magicOk) {
        # Right length, wrong content. Resuming onto this would keep the bad
        # prefix forever, so the partial file goes.
        Write-Log ('BAD   [{0}/{1}] {2}  {3} - deleting, re-run to fetch clean' -f `
                   $idx, $files.Count, $f.rel_path, $magicWhy)
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        $failed++
    }
    elseif ($want -gt 0 -and $final -eq $want) {
        Write-Log ('DONE  [{0}/{1}] {2}  {3:N2} GB' -f $idx, $files.Count, $f.rel_path, ($final / 1GB))
        $sha = ''
        try {
            $sha = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
            Write-Log ('  sha256 ' + $sha)
        } catch {
            Write-Log '  sha256 failed'
        }
        $rec = [ordered]@{
            rel_path    = $f.rel_path
            drive_id    = $f.drive_id
            bytes       = $final
            sha256      = $sha
            phase       = $f.phase
            acquired_at = (Get-Date).ToString('s')
        }
        Add-Content -LiteralPath $hashPath -Value ($rec | ConvertTo-Json -Compress) -Encoding utf8
    } else {
        Write-Log ('FAIL  [{0}/{1}] {2}  {3:N2}/{4:N2} GB - re-run to resume' -f `
                   $idx, $files.Count, $f.rel_path, ($final / 1GB), ($want / 1GB))
        $failed++
    }
}

Write-Log ('=== fetch-optc end: {0} file(s) incomplete ===' -f $failed)
Write-Host ''
Write-Host '  Next:'
Write-Host ('    .\scripts\Test-GzipIntegrity.ps1 -Path "' + $dest + '" -ExpectedLastTimestamp 0')
Write-Host ('    then copy ' + $hashPath + ' into configs\manifests\optc.json acquisition_log')
Write-Host ''

if ($failed -gt 0) { exit 1 }
exit 0
