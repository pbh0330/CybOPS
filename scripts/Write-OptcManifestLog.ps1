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

# check (docs/09, last section), and their SHA256 is the hash of the garbage.

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

  # "all gzip members decompressed" was written whenever bad was 0, regardless of
  # how many files the log actually covered. With 988 acquired and 954 checked it
  # said all, and the 34 unchecked ones were the newest arrivals - exactly the
  # ones most likely to be a half-written file or a Drive error page. A count of
  # what was verified is only meaningful next to the count of what exists.
  $unverified = $rows.Count - ($ok + $empty)
  if ($unverified -lt 0) { $unverified = 0 }
  $integrity.files_unverified = $unverified
  if ($bad -gt 0) {
    $integrity.note = 'FAILURES PRESENT - see log'
  } elseif ($unverified -gt 0) {
    $integrity.note = ('{0} of {1} files verified; {2} acquired since the last integrity run and NOT yet checked. Re-run Test-GzipIntegrity.ps1 before treating this manifest as verified.' -f ($ok + $empty), $rows.Count, $unverified)
  } elseif ($ok -gt 0) {
    $integrity.note = 'all gzip members decompressed'
  } else {
    $integrity.note = 'see log'
  }

  Write-Output ("  gzip verified          {0,6} ok, {1} bad, {2} empty, {3} unverified" -f $ok, $bad, $empty, $unverified)

} else {

  Write-Output "  gzip verified            (not run - $GzipLog missing)"

}

$man = Get-Content $Manifest -Raw -Encoding utf8 | ConvertFrom-Json
if ($null -eq $man -or $null -eq $man.planned_files) {
  throw 'manifest has no planned_files; nothing can be reconciled against it'
}

# The other direction. It runs here for two reasons: $man has to be loaded
# (the first version sat 170 lines above the assignment, so $man.planned_files
# was $null and the loop ran zero times without a word), and -Check has to see
# the same $rows the write path will use, or the two disagree by exactly the
# number of adopted files and the gate fails on a manifest that is correct.
#
# Originally noted as: runs AFTER the manifest is loaded. The
# first version of this sat next to the size-mismatch report, 170 lines above
# the line that assigns $man, so $man.planned_files was $null and the loop ran
# zero times without a word. It reported nothing and adopted nothing, which
# reads exactly like "there were no orphans".
#
# A file can sit on disk at exactly its planned size with
# no line in _acquired.jsonl: fetch-optc writes that line when it finishes a
# download, so a file completed by a pass that was killed, or one already
# present when a pass started, never gets recorded.
#
# It happened to ecar/evaluation/25Sept/AIA-501-525/...T15-04-02.073.json.gz.
# The file is whole and gzip-verified, but the manifest did not know it existed,
# which is the one thing the manifest is for: after the raw data is deleted
# (ADR-0010) an unrecorded file cannot be re-fetched or checked against.
#
# So adopt them. The Drive id and planned byte count come from planned_files,
# the hash is computed here, and the record says plainly where it came from.
$orphans = New-Object System.Collections.ArrayList
foreach ($pf in $man.planned_files) {
  $rel = [string]$pf.rel_path
  if ($byPath.Contains($rel)) { continue }
  if (-not $onDisk.ContainsKey($rel)) { continue }
  if ($onDisk[$rel] -ne [long]$pf.bytes) { continue }   # partial: leave it to fetch
  [void]$orphans.Add($pf)
}
if ($orphans.Count -gt 0) {
  Write-Output ("  on disk, not in log    {0,6}   (recording from disk: hashing {1})" -f `
    $orphans.Count, $orphans.Count)
  foreach ($pf in $orphans) {
    $full = Join-Path $Root ([string]$pf.rel_path).Replace('/', '\')
    $sha = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    $rec = [pscustomobject]@{
      rel_path    = [string]$pf.rel_path
      drive_id    = $pf.drive_id
      bytes       = [long]$pf.bytes
      sha256      = $sha
      phase       = $pf.phase
      acquired_at = (Get-Item -LiteralPath $full).LastWriteTime.ToString('s')
      adopted     = 'no line in _acquired.jsonl; recorded from disk by Write-OptcManifestLog.ps1'
    }
    $byPath[[string]$pf.rel_path] = $rec
    if ($Check) {
      Write-Output ("    WOULD RECORD  {0}" -f $pf.rel_path)
    } else {
      Write-Output ("    ADOPTED  {0}" -f $pf.rel_path)
    }
  }
  $rows = @($byPath.Values)
}

$stale = ($missing.Count -gt 0) -or ($sizeMismatch.Count -gt 0)

if ($Check) {

  Write-Output ''


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





$log = @($rows | ForEach-Object {

  $rec = [ordered]@{

    rel_path    = $_.rel_path

    drive_id    = $_.drive_id

    bytes       = $_.bytes

    sha256      = $_.sha256

    phase       = $_.phase

    acquired_at = $_.acquired_at

    # A record recovered from disk is a weaker claim than one fetch-optc wrote
    # at download time: acquired_at is a file timestamp, not the moment the
    # bytes arrived. Carry that through instead of losing it here, which is
    # exactly where it was being dropped.

  }

  if ($_.PSObject.Properties['adopted']) { $rec.adopted = $_.adopted }

  $rec

})

$man | Add-Member -NotePropertyName acquisition_log -NotePropertyValue $log -Force

# The status used to be the literal string 'acquired (phases 1,2,6)', written
# once by hand on 2026-09-07. Phases 3, 4 and 5 have been arriving ever since
# and it still said 1,2,6 - and the per-phase status fields still said
# 'planned' for phases that had finished days earlier. A manifest is the thing
# that outlives the raw data (ADR-0010); a hand-written status inside it decays
# the moment anything moves. Derive both from the log instead.
$plannedByPhase  = @{}
$plannedGbByPhase = @{}
foreach ($f in $man.planned_files) {
  $ph = [string]$f.phase
  if (-not $plannedByPhase.ContainsKey($ph)) { $plannedByPhase[$ph] = 0; $plannedGbByPhase[$ph] = [double]0 }
  $plannedByPhase[$ph]++
  if ($f.PSObject.Properties['bytes']) { $plannedGbByPhase[$ph] += [double]$f.bytes }
}
$gotByPhase   = @{}
$gotGbByPhase = @{}
foreach ($r in $rows) {
  $ph = [string]$r.phase
  if (-not $gotByPhase.ContainsKey($ph)) { $gotByPhase[$ph] = 0; $gotGbByPhase[$ph] = [double]0 }
  $gotByPhase[$ph]++
  $gotGbByPhase[$ph] += [double]$r.bytes
}

$done = New-Object System.Collections.ArrayList
$part = New-Object System.Collections.ArrayList
foreach ($ph in ($plannedByPhase.Keys | Sort-Object { [int]$_ })) {
  $want = $plannedByPhase[$ph]
  $have = 0
  if ($gotByPhase.ContainsKey($ph)) { $have = $gotByPhase[$ph] }
  $wantGb = [math]::Round($plannedGbByPhase[$ph] / 1GB, 1)
  $haveGb = 0.0
  if ($gotGbByPhase.ContainsKey($ph)) { $haveGb = [math]::Round($gotGbByPhase[$ph] / 1GB, 1) }

  if ($have -ge $want) {
    $st = 'complete'
    [void]$done.Add($ph)
  } elseif ($have -eq 0) {
    $st = 'not started'
    [void]$part.Add(("{0} 0/{1}" -f $ph, $want))
  } else {
    $st = ('partial {0}/{1} files, {2}/{3} GB' -f $have, $want, $haveGb, $wantGb)
    [void]$part.Add(("{0} {1}/{2}" -f $ph, $have, $want))
  }
  if ($man.phases.PSObject.Properties[$ph]) {
    $man.phases.$ph | Add-Member -NotePropertyName status -NotePropertyValue $st -Force
    $man.phases.$ph | Add-Member -NotePropertyName files_acquired -NotePropertyValue $have -Force
  }
}

if ($part.Count -eq 0) {
  $statusText = ('acquired (all phases: {0})' -f (($done | Sort-Object { [int]$_ }) -join ','))
} else {
  $statusText = ('acquiring - complete: {0}; outstanding: {1}' -f `
    (($done | Sort-Object { [int]$_ }) -join ','), ($part -join ', '))
}
$man | Add-Member -NotePropertyName status -NotePropertyValue $statusText -Force

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

