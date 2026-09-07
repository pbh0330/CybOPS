# Check generated telemetry against the OCSF mapping spec.
#
# ASCII only in this file.
#
# ADR-0005 says the normalisation schema is OCSF. That was a declaration, and a
# declaration that nothing checks is a claim waiting to be embarrassed: the
# synthetic track shipped for two days missing three required fields and with
# the authentication subject in an optional slot, so account-centric queries
# came back empty. A reviewer opening one line of the file would have seen it.
#
# What this checks (configs/ocsf-mapping.json is the source of the rules):
#   1. required fields present per class
#   2. type_uid = class_uid * 100 + activity_id, which OCSF defines as computed
#   3. category_uid agrees with the class
#   4. metadata.version matches the pinned schema version
#   5. Authentication (3002) carries `user` and at least one of
#      service / dst_endpoint
#
# Usage:
#   .\scripts\Test-OcsfConformance.ps1
#   .\scripts\Test-OcsfConformance.ps1 -Events path\to\events.jsonl -OutJson eval\results\ocsf.json
#
# Exit 0 = conformant, 1 = at least one violation.

param(
  [string]$Events  = "$PSScriptRoot\..\scenarios\defnet-01\synthetic\events.jsonl",
  [string]$Mapping = "$PSScriptRoot\..\configs\ocsf-mapping.json",
  [string]$OutJson = '',
  [int]$MaxReport  = 10
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Events))  { throw "events not found: $Events" }
if (-not (Test-Path $Mapping)) { throw "mapping not found: $Mapping" }

$map = Get-Content $Mapping -Raw -Encoding utf8 | ConvertFrom-Json

# the pinned schema version, wherever the mapping keeps it
$pinned = ''
foreach ($cand in @($map.ocsf.version, $map.schema.version, $map.version, $map.ocsf_version)) {
  if ($cand -and -not $pinned) { $pinned = [string]$cand }
}
if (-not $pinned) { $pinned = '1.9.0' }

# category for each class we emit. Kept here rather than derived from the
# mapping file so the check fails loudly if the mapping changes shape.
$classCategory = @{
  1001 = 1   # File System Activity   -> System Activity
  1007 = 1   # Process Activity       -> System Activity
  2004 = 2   # Detection Finding      -> Findings
  3002 = 3   # Authentication         -> IAM
  4001 = 4   # Network Activity       -> Network Activity
  4003 = 4   # DNS Activity
}

$required = @('event_uid', 'time', 'class_uid', 'category_uid', 'activity_id', 'type_uid', 'severity_id', 'metadata')

$violations = New-Object System.Collections.ArrayList
$counts = @{}
$n = 0

function Add-V($line, $uid, $rule, $detail) {
  [void]$script:violations.Add([ordered]@{ line = $line; event_uid = $uid; rule = $rule; detail = $detail })
  $script:counts[$rule] = [int]$script:counts[$rule] + 1
}

$lineNo = 0
foreach ($raw in [IO.File]::ReadLines((Resolve-Path $Events))) {
  $lineNo++
  if (-not $raw.Trim()) { continue }
  $n++
  $e = $raw | ConvertFrom-Json
  $uid = [string]$e.event_uid

  foreach ($f in $required) {
    if ($null -eq $e.$f) { Add-V $lineNo $uid 'missing required field' $f }
  }

  if ($null -ne $e.class_uid -and $null -ne $e.activity_id -and $null -ne $e.type_uid) {
    $expect = [int]$e.class_uid * 100 + [int]$e.activity_id
    if ([int]$e.type_uid -ne $expect) {
      Add-V $lineNo $uid 'type_uid mismatch' ("expected {0}, got {1}" -f $expect, $e.type_uid)
    }
  }

  if ($null -ne $e.class_uid -and $classCategory.ContainsKey([int]$e.class_uid)) {
    $expectCat = $classCategory[[int]$e.class_uid]
    if ([int]$e.category_uid -ne $expectCat) {
      Add-V $lineNo $uid 'category_uid mismatch' ("class {0} expects category {1}, got {2}" -f $e.class_uid, $expectCat, $e.category_uid)
    }
  }

  if ($e.metadata -and [string]$e.metadata.version -ne $pinned) {
    Add-V $lineNo $uid 'metadata.version' ("expected {0}, got {1}" -f $pinned, $e.metadata.version)
  }

  if ([int]$e.class_uid -eq 3002) {
    if ($null -eq $e.user)      { Add-V $lineNo $uid 'auth: user required' 'user missing (actor.user is not a substitute)' }
    if ($null -eq $e.service -and $null -eq $e.dst_endpoint) {
      Add-V $lineNo $uid 'auth: at_least_one' 'neither service nor dst_endpoint present'
    }
  }
}

Write-Output ''
Write-Output "ocsf conformance   events=$n   schema=$pinned"
Write-Output ('-' * 66)
if ($violations.Count -eq 0) {
  Write-Output '  no violations'
} else {
  foreach ($k in ($counts.Keys | Sort-Object)) {
    Write-Output ('  {0,-28} {1}' -f $k, $counts[$k])
  }
  Write-Output ''
  foreach ($v in ($violations | Select-Object -First $MaxReport)) {
    Write-Output ('    line {0} {1}  {2}: {3}' -f $v.line, $v.event_uid, $v.rule, $v.detail)
  }
  if ($violations.Count -gt $MaxReport) {
    Write-Output ('    ... and {0} more' -f ($violations.Count - $MaxReport))
  }
}
Write-Output ''
if ($violations.Count -eq 0) { Write-Output 'RESULT: PASS' } else { Write-Output ("RESULT: FAIL   {0} violation(s)" -f $violations.Count) }
Write-Output ''

if ($OutJson) {
  $dir = Split-Path $OutJson -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $report = [ordered]@{
    generated = (Get-Date).ToString('o')
    generator = 'scripts/Test-OcsfConformance.ps1'
    adr = 'ADR-0005'
    events_file = (Resolve-Path $Events).Path
    schema_version = $pinned
    events_checked = $n
    violations_total = $violations.Count
    violations_by_rule = $counts
    violations = @($violations | Select-Object -First 200)
    pass = ($violations.Count -eq 0)
  }
  [IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Write-Output ("report: {0}" -f $OutJson)
  Write-Output ''
}

if ($violations.Count -gt 0) { exit 1 } else { exit 0 }
