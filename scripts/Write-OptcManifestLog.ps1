# Move the acquisition record into the manifest.
#
# ASCII only in this file.
#
# WHY THIS EXISTS
#
# CLAUDE.md: "write MANIFEST.json the moment you acquire (URL, part specifier,
# hash, licence, redistributable)". The point is stated there too: the raw
# dataset is a temporary resource, and the manifest is what survives deleting
# it. A manifest with an empty acquisition_log is a re-acquisition instruction
# that cannot verify what it re-acquires.
#
# fetch-optc.ps1 already writes one JSON line per file to <dest>/_acquired.jsonl
# with the Drive id, byte count and SHA256. This copies that into the manifest
# and reconciles it against what is actually on disk, so the two cannot drift
# apart silently.
#
# It also records what integrity checking was done, because "the bytes arrived"
# and "the gzip member decompresses" are different claims and only the second
# one is worth anything.
#
# Usage:
#   .\scripts\Write-OptcManifestLog.ps1
#   .\scripts\Write-OptcManifestLog.ps1 -Check      # report only, exit 1 if stale
#
# Exit 0 = manifest agrees with disk, 1 = it does not.

param(
  [string]$Manifest = "$PSScriptRoot\..\configs\manifests\optc.json",
  [string]$Root     = 'F:\mc-cycop-data\raw\optc',
  [string]$GzipLog  = '',
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Manifest)) { throw "manifest not found: $Manifest" }
if (-not (Test-Path $Root))     { throw "data root not found: $Root" }

$acqPath = Join-Path $Root '_acquired.jsonl'
if (-not (Test-Path $acqPath)) { throw "no _acquired.jsonl under $Root - nothing was acquired by fetch-optc.ps1" }
if (-not $GzipLog) { $GzipLog = Join-Path $Root '_gzipcheck.log' }

# ---------------------------------------------------------------- read

$raw = New-Object System.Collections.ArrayList
foreach ($line in [IO.File]::ReadLines((Resolve-Path $acqPath))) {
  if (-not $line.Trim()) { continue }
  [void]$raw.Add(($line | ConvertFrom-Json))
}

# _acquired.jsonl is append-only, so a re-fetch of a file leaves both records.
# Six files in the 2026-09-06 run were HTML error pages that passed the size
# check (docs/09 "취득 결과"), and their SHA256 is the hash of the garbage.
# Keep the newest record per rel_path: the repaired one wins, and the manifest
# never carries a hash of something that is no longer on disk.
$byPath = [ordered]@{}
foreach ($r in ($raw | Sort-Object { [string]$_.acquired_at })) {
  $byPath[[string]$r.rel_path] = $r
}
$rows = @($byPath.Values)
$dupes = $raw.Count - $rows.Count

Write-Output ''
Write-Output "optc manifest log   root=$Root"
Write-Output ('-' * 74)
Write-Output ("  _acquired.jsonl        {0,6} line(s)" -f $raw.Count)
Write-Output ("  distinct rel_path      {0,6}   (superseded by re-fetch: {1})" -f $rows.Count, $dupes)

# ---------------------------------------------------------------- reconcile
#
# Trusting the log alone would let a file that was deleted after download stay
# in the manifest as if it were present. Compare against the filesystem.

$onDisk = @{}
foreach ($f in (Get-ChildItem -LiteralPath $Root -File -Recurse)) {
  $rel = $f.FullName.Substring((Resolve-Path $Root).Path.Length).TrimStart('\', '/') -replace '\\', '/'
  $onDisk[$rel] = $f.Length
}

$missing = New-Object System.Collections.ArrayList
$sizeMismatch = New-Object System.Collections.ArrayList
$bytes = [long]0
foreach ($r in $rows) {
  $rel = [string]$r.rel_path
  if (-not $onDisk.ContainsKey($rel)) { [void]$missing.Add($rel); continue }
  $bytes += [long]$r.bytes
  if ([long]$onDisk[$rel] -ne [long]$r.bytes) {
    [void]$sizeMismatch.Add(("{0}: log {1:N0} B, disk {2:N0} B" -f $rel, $r.bytes, $onDisk[$rel]))
  }
}

Write-Output ("  present on disk        {0,6}" -f ($rows.Count - $missing.Count))
Write-Output ("  missing from disk      {0,6}" -f $missing.Count)
Write-Output ("  size mismatch          {0,6}" -f $sizeMismatch.Count)
Write-Output ("  bytes accounted for    {0,6:N2} GB" -f ($bytes / 1GB))

foreach ($m in ($missing | Select-Object -First 5))      { Write-Output "    MISSING  $m" }
foreach ($m in ($sizeMismatch | Select-Object -First 5)) { Write-Output "    SIZE     $m" }

$noHash = @($rows | Where-Object { -not $_.sha256 })
Write-Output ("  records without sha256 {0,6}" -f $noHash.Count)

# ---------------------------------------------------------------- integrity
#
# Read the gzip check result rather than restating it. A manifest that claims
# verification nobody ran is worse than one that claims nothing.

$integrity = [ordered]@{
  method   = 'scripts/Test-GzipIntegrity.ps1 (full decompression, CRC32 + ISIZE)'
  log      = $GzipLog
  ran      = $false
  files_ok = 0
  files_bad = 0
  note     = 'not run'
}
if (Test-Path $GzipLog) {
  $txt = Get-Content $GzipLog -Raw
  $ok  = ([regex]::Matches($txt, 'gzip\s+:\s*OK')).Count
  $bad = ([regex]::Matches($txt, 'gzip\s+:\s*(FAIL|CORRUPT|ERROR)')).Count
  # A valid gzip member can hold nothing. Several ecar-bro host/hour files are
  # 33 bytes and decompress to zero, which is a correct download of an empty
  # capture window - but it is not data, and the file count would say it was.
  $empty = ([regex]::Matches($txt, 'uncompressed\s+:\s*0 B')).Count
  $integrity.ran = $true
  $integrity.files_ok = $ok
  $integrity.files_bad = $bad
  $integrity.files_empty = $empty
  $integrity.empty_note = 'valid gzip members that decompress to zero bytes (empty capture windows), counted so the file count is not mistaken for a data count'
  $integrity.note = if ($bad -eq 0 -and $ok -gt 0) { 'all gzip members decompressed' } else { 'see log' }
  Write-Output ("  gzip verified          {0,6} ok, {1} bad, {2} empty" -f $ok, $bad, $empty)
} else {
  Write-Output "  gzip verified            (not run - $GzipLog missing)"
}

$stale = ($missing.Count -gt 0) -or ($sizeMismatch.Count -gt 0)

if ($Check) {
  Write-Output ''
  $man = Get-Content $Manifest -Raw -Encoding utf8 | ConvertFrom-Json
  $logged = @($man.acquisition_log).Count
  Write-Output ("  manifest acquisition_log {0,4} record(s)" -f $logged)
  if ($logged -ne $rows.Count) {
    Write-Output ''
    Write-Output ("RESULT: FAIL   manifest has {0}, disk log has {1}" -f $logged, $rows.Count)
    exit 1
  }
  if ($stale) { Write-Output ''; Write-Output 'RESULT: FAIL   disk and log disagree'; exit 1 }
  Write-Output ''
  Write-Output 'RESULT: PASS'
  exit 0
}

if ($stale) {
  Write-Output ''
  Write-Output 'refusing to write: disk and log disagree. Fix that first.'
  exit 1
}

# ---------------------------------------------------------------- write

$man = Get-Content $Manifest -Raw -Encoding utf8 | ConvertFrom-Json

$log = @($rows | ForEach-Object {
  [ordered]@{
    rel_path    = $_.rel_path
    drive_id    = $_.drive_id
    bytes       = $_.bytes
    sha256      = $_.sha256
    phase       = $_.phase
    acquired_at = $_.acquired_at
  }
})

$man | Add-Member -NotePropertyName acquisition_log -NotePropertyValue $log -Force
$man | Add-Member -NotePropertyName status -NotePropertyValue 'acquired (phases 1,2,6)' -Force
$man | Add-Member -NotePropertyName acquired_summary -NotePropertyValue ([ordered]@{
  files          = $rows.Count
  bytes          = $bytes
  gb             = [math]::Round($bytes / 1GB, 2)
  phases         = @($rows | ForEach-Object { $_.phase } | Sort-Object -Unique)
  first_acquired = ($rows | Sort-Object acquired_at | Select-Object -First 1).acquired_at
  last_acquired  = ($rows | Sort-Object acquired_at | Select-Object -Last 1).acquired_at
  integrity      = $integrity
  reconciled_at  = (Get-Date).ToString('o')
  reconciled_by  = 'scripts/Write-OptcManifestLog.ps1'
}) -Force

$json = $man | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText((Resolve-Path $Manifest), $json, (New-Object Text.UTF8Encoding($false)))

Write-Output ''
Write-Output ("written: {0}" -f $Manifest)
Write-Output ("  acquisition_log {0} record(s), {1:N2} GB" -f $log.Count, ($bytes / 1GB))
Write-Output ''
exit 0
