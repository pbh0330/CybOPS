# Run every check that can fail on its own and report them in one table.
#
# ASCII only in this file.
#
# WHY THIS EXISTS
#
# There are ten Test-*.ps1 gates in this repo and CLAUDE.md tells you to put two
# of them "in CI". There is no CI, and there was no way to run them together, so
# in practice each one got run when someone remembered it. Two consequences
# showed up on 2026-09-10:
#
#   - Test-BundleConfig.ps1 with no arguments printed DO NOT DEPLOY, because the
#     default -Bundle was the local build and the default -Posture was hosted.
#     Nobody noticed, because nobody ran it with no arguments.
#   - Write-OptcManifestLog.ps1 -Check had been failing for days (901 records in
#     the manifest, 952 files on disk). That one matters: ADR-0010 says the raw
#     data is temporary and the manifest is what survives deleting it.
#
# A gate nobody runs is documentation. This makes one command run all of them.
#
# TIERS
#
#   offline  no model, no raw dataset, seconds. Always run.
#   data     needs F:\mc-cycop-data. Reads the manifest, does not hash 90 GB.
#   model    needs Ollama running and takes minutes. Opt in with -WithModel.
#
# Usage:
#   .\scripts\Invoke-Gates.ps1                 # offline
#   .\scripts\Invoke-Gates.ps1 -WithData
#   .\scripts\Invoke-Gates.ps1 -WithData -WithModel -OutJson eval\results\gates.json
#
# Exit code is 1 if any gate that ran failed, so this is the thing to put in CI.

param(
  [switch]$WithData,
  [switch]$WithModel,
  [string]$OutJson = ''
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root = Split-Path $PSScriptRoot -Parent

# Each gate is a name, a tier, and how to call it. Nothing here interprets the
# output: a gate is expected to set its own exit code, and a gate that does not
# is a gate to fix rather than to special-case.
$gates = @(
  @{ name = 'case collisions';    tier = 'offline'; script = 'Test-CaseCollisions.ps1';   args = @{} },
  @{ name = 'ps1 encoding (bom)'; tier = 'offline'; script = 'Add-Bom.ps1';               args = @{ Check = $true } },
  @{ name = 'ontology';           tier = 'offline'; script = 'Test-Ontology.ps1';         args = @{} },
  @{ name = 'ocsf conformance';   tier = 'offline'; script = 'Test-OcsfConformance.ps1';  args = @{} },
  @{ name = 'geo invariance';     tier = 'offline'; script = 'Test-GeoInvariance.ps1';    args = @{} },
  @{ name = 'ui unit tests';      tier = 'offline'; script = 'Test-UiUnit.ps1';         args = @{} },
  @{ name = 'bundle: local';      tier = 'offline'; script = 'Test-BundleConfig.ps1';
     args = @{ Bundle = (Join-Path $root 'ui\dist') } },
  @{ name = 'bundle: hosted';     tier = 'offline'; script = 'Test-BundleConfig.ps1';
     args = @{ Bundle = (Join-Path $root 'ui\dist-hosted') } },
  @{ name = 'proxy allowlist';    tier = 'offline'; script = 'Test-ProxyAllowlist.ps1';   args = @{} },
  @{ name = 'optc manifest';      tier = 'data';    script = 'Write-OptcManifestLog.ps1'; args = @{ Check = $true } },
  @{ name = 'briefing citations'; tier = 'model';   script = 'Test-BriefingCitations.ps1'; args = @{} }
)

$want = @('offline')
if ($WithData)  { $want += 'data' }
if ($WithModel) { $want += 'model' }

Write-Output ''
Write-Output ("gates   tiers: {0}" -f ($want -join ', '))
Write-Output '=========================================================================='

$results = New-Object System.Collections.ArrayList
foreach ($g in $gates) {
  if ($want -notcontains $g.tier) {
    [void]$results.Add([pscustomobject]@{
      name = $g.name; tier = $g.tier; status = 'skipped'; exit = $null; seconds = 0
    })
    continue
  }

  $path = Join-Path $PSScriptRoot $g.script
  if (-not (Test-Path $path)) {
    # A gate named here and missing on disk is a failure of this file, and
    # silently skipping it would hide exactly what the list is for.
    [void]$results.Add([pscustomobject]@{
      name = $g.name; tier = $g.tier; status = 'MISSING'; exit = $null; seconds = 0
    })
    Write-Output ("  MISSING  {0,-22} {1}" -f $g.name, $g.script)
    continue
  }

  $t0 = Get-Date
  $out = @()
  $code = $null
  # Two splatting rules, and getting them backwards cost two runs here. @ must
  # prefix a VARIABLE, not an expression - `& $path @($g.args)` passes the array
  # as one positional argument. And an ARRAY splats positionally while only a
  # HASHTABLE splats by name, so @('-Check') bound the string '-Check' to the
  # first positional parameter instead of setting the switch.
  $callArgs = $g.args
  try {
    $out = & $path @callArgs *>&1
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
  } catch {
    $out += ("threw: " + $_.Exception.Message)
    $code = 1
  }
  $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $status = if ($code -eq 0) { 'pass' } else { 'FAIL' }

  [void]$results.Add([pscustomobject]@{
    name = $g.name; tier = $g.tier; status = $status; exit = $code; seconds = $secs
  })
  Write-Output ("  {0,-4}  {1,-22} {2,6}s  exit {3}" -f $status, $g.name, $secs, $code)

  # Only a failure is worth quoting. A passing gate has already said so.
  if ($code -ne 0) {
    $tail = @($out | Select-Object -Last 4)
    foreach ($line in $tail) { Write-Output ("          | " + $line) }
  }
}

$ran    = @($results | Where-Object { $_.status -ne 'skipped' })
$failed = @($ran | Where-Object { $_.status -ne 'pass' })

Write-Output '=========================================================================='
Write-Output ("  ran {0}, passed {1}, failed {2}, skipped {3}" -f `
  $ran.Count, ($ran.Count - $failed.Count), $failed.Count, ($results.Count - $ran.Count))
Write-Output ''
if ($failed.Count -gt 0) {
  Write-Output ("RESULT: FAIL   " + (($failed | ForEach-Object { $_.name }) -join ', '))
} else {
  Write-Output 'RESULT: PASS'
}

if ($OutJson) {
  $dir = Split-Path $OutJson -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $payload = [ordered]@{
    generated = (Get-Date).ToUniversalTime().ToString('o')
    generator = 'scripts/Invoke-Gates.ps1'
    tiers     = $want
    gates     = $results
    passed    = ($failed.Count -eq 0)
  }
  $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutJson -Encoding UTF8
  Write-Output ("wrote " + $OutJson)
}

if ($failed.Count -gt 0) { exit 1 } else { exit 0 }
