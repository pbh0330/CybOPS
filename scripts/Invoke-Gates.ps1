# Run every check that can fail on its own and report them in one table.
#
# ASCII only in this file.
#
# WHY THIS EXISTS
#
# As of 2026-10-14 there are sixteen Test-*.ps1 scripts in scripts\, and the
# $gates list below has thirteen entries - ten of those scripts (Test-BundleConfig
# appears twice, once per bundle) plus Add-Bom.ps1 and Write-OptcManifestLog.ps1.
# This sentence used to say "ten Test-*.ps1 gates in this repo" and had drifted
# well before the gate added today: count the files, do not trust the number in
# a comment. The list below is the authority.
#
# CLAUDE.md tells you to put two of them "in CI". There is no CI, and there was
# no way to run them together, so
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
#
# An optional 'skipExit' is the one exit code from that gate which means "I
# checked nothing, and here is why" rather than pass or fail. It exists because
# the alternative is worse in both directions: a gate that passes when its
# target is absent is a gate that reports on nothing, and a gate that fails
# when its target is absent trains everybody to read red as normal. A skip
# prints the gate's own reason and does not set the exit code of this script.
#
# THE BUNDLE GATES AND ui\dist-hosted
#
# 'bundle: hosted' used to point at ui\dist-hosted. No script in this repo
# builds that directory - Publish-Briefings.ps1 writes briefing JSON into
# ui\public\data and never a bundle - so the gate was green in the main tree
# only because a directory from 2026-09-09 happened to still be there, and red
# in every fresh worktree for the same reason. Three agents in a row read that
# red as "worktrees are like that".
#
# What the deploy actually gates is ui\dist with a hosted config.json copied
# into it (Deploy-Aws.ps1 step 3, then step 4's gate). So that is what this
# gates: the same bundle directory, judged against the hosted config file the
# deploy copies in. No second directory, nothing to keep in sync, and the
# answer depends only on committed inputs plus whether a build was run.
$gates = @(
  @{ name = 'case collisions';    tier = 'offline'; script = 'Test-CaseCollisions.ps1';   args = @{} },
  @{ name = 'ps1 encoding (bom)'; tier = 'offline'; script = 'Add-Bom.ps1';               args = @{ Check = $true } },
  @{ name = 'ontology';           tier = 'offline'; script = 'Test-Ontology.ps1';         args = @{} },
  @{ name = 'ocsf conformance';   tier = 'offline'; script = 'Test-OcsfConformance.ps1';  args = @{} },
  @{ name = 'geo invariance';     tier = 'offline'; script = 'Test-GeoInvariance.ps1';    args = @{} },
  @{ name = 'scenario invariants';tier = 'offline'; script = 'Test-ScenarioInvariants.ps1'; args = @{} },
  @{ name = 'token parity';       tier = 'offline'; script = 'Test-TokenParity.ps1';       args = @{} },
  @{ name = 'ui unit tests';      tier = 'offline'; script = 'Test-UiUnit.ps1';         args = @{} },
  @{ name = 'bundle: local';      tier = 'offline'; script = 'Test-BundleConfig.ps1'; skipExit = 3;
     args = @{ Bundle = (Join-Path $root 'ui\dist'); Posture = 'local' } },
  @{ name = 'bundle: hosted';     tier = 'offline'; script = 'Test-BundleConfig.ps1'; skipExit = 3;
     args = @{ Bundle  = (Join-Path $root 'ui\dist'); Posture = 'hosted'
               Config  = (Join-Path $root 'ui\public\config.aws.example.json') } },
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
  $status = 'FAIL'
  if ($code -eq 0) {
    $status = 'pass'
  } elseif ($null -ne $g.skipExit -and $code -eq $g.skipExit) {
    # The gate ran and told us it could not check anything. Its own output says
    # why and what to run, and the quoting below prints that.
    $status = 'skip'
  }

  [void]$results.Add([pscustomobject]@{
    name = $g.name; tier = $g.tier; status = $status; exit = $code; seconds = $secs
  })
  Write-Output ("  {0,-4}  {1,-22} {2,6}s  exit {3}" -f $status, $g.name, $secs, $code)

  # Only a failure is worth quoting - a passing gate has already said so - and
  # a skip, because a skip that does not say why is the thing this avoids.
  if ($code -ne 0) {
    $tail = @($out | Select-Object -Last 4)
    foreach ($line in $tail) { Write-Output ("          | " + $line) }
  }
}

$ran    = @($results | Where-Object { $_.status -ne 'skipped' -and $_.status -ne 'skip' })
$failed = @($ran | Where-Object { $_.status -ne 'pass' })
$unable = @($results | Where-Object { $_.status -eq 'skip' })
$byTier = @($results | Where-Object { $_.status -eq 'skipped' })

Write-Output '=========================================================================='
Write-Output ("  ran {0}, passed {1}, failed {2}, not checked {3}, skipped (tier) {4}" -f `
  $ran.Count, ($ran.Count - $failed.Count), $failed.Count, $unable.Count, $byTier.Count)
Write-Output ''
if ($failed.Count -gt 0) {
  Write-Output ("RESULT: FAIL   " + (($failed | ForEach-Object { $_.name }) -join ', '))
} elseif ($unable.Count -gt 0) {
  # Not a pass about the skipped gate. A pass about everything that could run,
  # with the one thing nobody checked named out loud.
  Write-Output ("RESULT: PASS   not checked: " + (($unable | ForEach-Object { $_.name }) -join ', '))
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
