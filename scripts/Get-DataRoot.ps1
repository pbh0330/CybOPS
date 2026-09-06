# Get-DataRoot.ps1
# Resolve where a dataset should be written: F: first, C: as overflow.
#
# Policy (set by the project owner, 2026-09-06):
#   - F: is the primary data volume. Always prefer it.
#   - Fall back to C: only when F: cannot hold the dataset while keeping a
#     reserve free. A volume that fills completely takes Windows down with it,
#     so the reserve is not optional.
#   - Never split a single dataset across volumes. Datasets are the unit of
#     placement, because manifests and purge steps operate per dataset
#     (docs/05-data-lifecycle.md).
#
# Returns the chosen root path on success, or throws when neither volume can
# hold the dataset - the caller must not silently start a download that will
# run out of space three days in.
#
# ASCII only: Windows PowerShell 5.1 misreads BOM-less UTF-8 script files.
#
# Usage:
#   $root = .\scripts\Get-DataRoot.ps1 -Dataset optc -NeedGB 60
#   .\scripts\Get-DataRoot.ps1 -Report

[CmdletBinding()]
param(
    # Dataset folder name, e.g. 'ait-lds-v2', 'optc', 'lanl-cyber1'.
    [string] $Dataset = '',

    # Estimated size of the dataset in GB.
    [double] $NeedGB = 0,

    # Print a capacity report instead of resolving a path.
    [switch] $Report,

    # Keep this much free on whichever volume is chosen.
    [double] $ReserveGB = 50,

    [string[]] $Roots = @('F:\mc-cycop-data\raw', 'C:\mc-cycop-data\raw')
)

function Get-FreeGB([string] $path) {
    $drive = (Split-Path -Qualifier $path)
    $d = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $drive + "'")
    if ($null -eq $d) { return -1 }
    return [math]::Round($d.FreeSpace / 1GB, 1)
}

function Get-UsedGB([string] $root) {
    if (-not (Test-Path -LiteralPath $root)) { return 0 }
    $s = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
         Measure-Object -Sum Length
    return [math]::Round($s.Sum / 1GB, 2)
}

function Test-HasFiles([string] $root) {
    if (-not (Test-Path -LiteralPath $root)) { return $false }
    $f = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
         Select-Object -First 1
    return ($null -ne $f)
}

if ($Report) {
    Write-Host ''
    Write-Host '=== data volume capacity ==='
    Write-Host '  priority  root                        free GB   used by us'
    $i = 0
    foreach ($r in $Roots) {
        $i++
        Write-Host ('  {0,-9} {1,-27} {2,8:N1} {3,12:N2}' -f $i, $r, (Get-FreeGB $r), (Get-UsedGB $r))
    }
    Write-Host ''
    Write-Host ('  reserve kept free: {0:N0} GB' -f $ReserveGB)
    Write-Host ''
    Write-Host '  planned:'
    Write-Host '    AIT-LDS v2.0 remaining   ~128 GB'
    Write-Host '    OpTC minimal set          ~TBD (docs/09-optc-acquisition.md)'
    exit 0
}

if ($Dataset -eq '') { throw 'Specify -Dataset, or use -Report.' }

# An existing copy wins over the policy: never strand half a dataset by moving
# the target after a partial download. Test for any file rather than a size,
# because a download that is only a few MB in still has to continue where it
# started - and rounded GB reads as 0.00 for anything under ~5 MB.
foreach ($r in $Roots) {
    $p = Join-Path $r $Dataset
    if (Test-HasFiles $p) {
        Write-Verbose ("existing data at {0} ({1:N2} GB) - staying there" -f $p, (Get-UsedGB $p))
        return $p
    }
}

foreach ($r in $Roots) {
    $free = Get-FreeGB $r
    if ($free -lt 0) { continue }
    if (($free - $NeedGB) -ge $ReserveGB) {
        $p = Join-Path $r $Dataset
        if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
        return $p
    }
    Write-Verbose ("{0}: {1:N1} GB free, need {2:N1} + {3:N1} reserve - skipping" -f $r, $free, $NeedGB, $ReserveGB)
}

throw ("No volume can hold '{0}' ({1:N1} GB) with a {2:N1} GB reserve. Free space or purge first (docs/05-data-lifecycle.md)." -f $Dataset, $NeedGB, $ReserveGB)
