# Deploy gate for a built bundle. ASCII only in this file.
#
# ADR-0021 chose a runtime config file over a build flag so that one artifact
# could serve three postures. That choice moved the failure: there is now
# exactly one file that has to be right, the default value of that file is the
# wrong one for a public host, and nothing about a wrong value is visible
# until a visitor clicks the wargame's LLM attacker and either waits out a
# timeout or, worse, has an Ollama of their own and drives someone else's
# scenario on their own GPU.
#
# The ADR's own closing note says an example file sitting next to the real one
# is not enough and that it belongs in a deployment procedure. A procedure that
# is only prose gets skipped on the day it matters, so this is the procedure's
# machine-checkable half: it exits non-zero, and it is meant to run in the
# deploy step before anything is copied to a server.
#
# Usage:
#   .\scripts\Test-BundleConfig.ps1 -Bundle ui\dist -Posture hosted
#   .\scripts\Test-BundleConfig.ps1 -Bundle ui\dist -Posture local
#
# Exit 0 = the bundle matches the posture. Exit 1 = do not deploy this.

param(
  [string]$Bundle = "$PSScriptRoot\..\ui\dist",
  [ValidateSet('hosted', 'local')]
  [string]$Posture = '',
  [string]$OutJson = ''
)

# The default used to be -Bundle ui\dist with -Posture hosted, which is the one
# pairing that cannot pass: ui\dist is the local build and carries
# llm.endpoint = http://127.0.0.1:11434 on purpose. Running the gate with no
# arguments therefore printed DO NOT DEPLOY about a bundle nobody was
# deploying. A gate that fails when nothing is wrong stops being read.
#
# So infer the posture from the bundle when it is not given, and say which one
# was chosen. ui\dist-hosted is built by Publish-Briefings for a public host;
# anything else is local.
if (-not $Posture) {
  $leaf = Split-Path $Bundle -Leaf
  if ($leaf -like '*hosted*') { $Posture = 'hosted' } else { $Posture = 'local' }
  Write-Output ("  posture   : {0} (inferred from '{1}'; pass -Posture to override)" -f $Posture, $leaf)
}

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$fail = New-Object System.Collections.ArrayList
$warn = New-Object System.Collections.ArrayList
$ok   = New-Object System.Collections.ArrayList

function Add-Fail($m) { [void]$fail.Add($m) }
function Add-Warn($m) { [void]$warn.Add($m) }
function Add-Ok($m)   { [void]$ok.Add($m) }

if (-not (Test-Path $Bundle)) {
  Write-Output ''
  Write-Output ("ERROR: bundle not found: {0}" -f $Bundle)
  Write-Output '  build it first:  cd ui; npm run build'
  Write-Output ''
  exit 1
}
$Bundle = (Resolve-Path $Bundle).Path

# ---------------------------------------------------------------- index

$index = Join-Path $Bundle 'index.html'
if (Test-Path $index) { Add-Ok 'index.html present' }
else { Add-Fail 'index.html missing: this is not a built bundle' }

# ---------------------------------------------------------------- config

$cfgPath = Join-Path $Bundle 'config.json'
$cfg = $null
if (-not (Test-Path $cfgPath)) {
  # Not fatal by itself: config.js falls back to DEFAULTS. That is exactly the
  # problem for a hosted bundle, because the default is the loopback posture.
  if ($Posture -eq 'hosted') {
    Add-Fail 'config.json missing. The loader falls back to its defaults, and the default endpoint is 127.0.0.1 - which on a public host means the VISITOR machine'
  } else {
    Add-Warn 'config.json missing; the loader defaults apply (local posture, so this is fine)'
  }
} else {
  try {
    $cfg = Get-Content $cfgPath -Raw -Encoding utf8 | ConvertFrom-Json
    Add-Ok 'config.json parses'
  } catch {
    Add-Fail ("config.json does not parse: {0}" -f $_.Exception.Message)
  }
}

if ($cfg) {
  $enabled  = $true
  $endpoint = ''
  if ($null -ne $cfg.llm) {
    if ($null -ne $cfg.llm.enabled) { $enabled = [bool]$cfg.llm.enabled }
    $endpoint = [string]$cfg.llm.endpoint
  }

  $isLoopback = ($endpoint -match '^https?://(127\.0\.0\.1|localhost|\[::1\])')
  $isSameOrigin = ($endpoint -like '/*')

  if ($Posture -eq 'hosted') {
    if (-not $enabled) {
      Add-Ok 'llm.enabled is false: the off posture. The staff query buttons still answer with facts and tables, the wargame keeps greedy and random, and briefings are pre-generated'
      if ($isLoopback) {
        Add-Warn 'endpoint still points at loopback. Harmless while enabled is false, but it is a live trap for whoever flips that flag next'
      }
    } elseif ($isLoopback) {
      Add-Fail ("llm.enabled is true and endpoint is {0}. On a public host that address is the VISITOR machine, not this server. Use /api/llm behind a proxy, or set llm.enabled to false" -f $endpoint)
    } elseif ($isSameOrigin) {
      Add-Ok ("endpoint {0} is same-origin: the proxied posture. Confirm the proxy actually has auth and a rate limit (docs/21-deployment.md section 3)" -f $endpoint)
    } elseif ($endpoint) {
      Add-Warn ("endpoint {0} is an absolute address that is not loopback. It will need CORS, and it is reachable by anyone who reads the bundle" -f $endpoint)
    } else {
      Add-Fail 'llm.enabled is true but no endpoint is set'
    }
  } else {
    if ($enabled -and $isLoopback) { Add-Ok 'local posture: loopback endpoint, as intended' }
    elseif (-not $enabled)         { Add-Warn 'local posture but llm.enabled is false: the staff question box (and the attacker, if llm.attacker_enabled is on) will be off on this machine too' }
    else                           { Add-Warn ("local posture with a non-loopback endpoint: {0}" -f $endpoint) }
  }

  $note = ''
  if ($null -ne $cfg.llm) { $note = [string]$cfg.llm.unavailable_note }
  if (-not $enabled -and -not $note) {
    Add-Warn 'llm.enabled is false and unavailable_note is empty. The panel will look broken rather than deliberate'
  }
}

# ---------------------------------------------------------------- data

$dataDir = Join-Path $Bundle 'data'
if (-not (Test-Path $dataDir)) {
  Add-Fail 'data/ missing: every view reads from it'
} else {
  $replays = @(Get-ChildItem $dataDir -Filter '*.replay.json' -File -ErrorAction SilentlyContinue)
  if ($replays.Count -eq 0) {
    Add-Fail 'no *.replay.json in data/. Run scripts/Export-ReplayData.ps1 and rebuild'
  } else {
    Add-Ok ("{0} replay file(s): {1}" -f $replays.Count, (($replays | ForEach-Object { $_.BaseName }) -join ', '))
    foreach ($r in $replays) {
      if ($r.Length -lt 1024) { Add-Fail ("{0} is only {1} bytes" -f $r.Name, $r.Length) }
    }
  }
}

# ---------------------------------------------------------------- size
#
# A dataset file inside the bundle is a licensing problem before it is a size
# problem (CLAUDE.md: raw datasets are never committed or redistributed).

$all = @(Get-ChildItem $Bundle -Recurse -File -ErrorAction SilentlyContinue)
$totalMb = [math]::Round((($all | Measure-Object Length -Sum).Sum / 1MB), 1)
Add-Ok ("{0} files, {1} MB total" -f $all.Count, $totalMb)

$big = @($all | Where-Object { $_.Length -gt 20MB })
foreach ($b in $big) {
  Add-Fail ("{0} is {1:N0} MB. Nothing in a bundle should be that size - check that no raw dataset slice was copied in" -f $b.Name, ($b.Length / 1MB))
}
$gz = @($all | Where-Object { $_.Extension -in @('.gz', '.csv', '.txt') -and $_.Length -gt 1MB })
foreach ($g in $gz) {
  Add-Warn ("{0} ({1:N1} MB) looks like a data extract rather than a UI asset" -f $g.Name, ($g.Length / 1MB))
}

# ---------------------------------------------------------------- report

Write-Output ''
Write-Output ("bundle config check   posture: {0}" -f $Posture)
Write-Output ("bundle: {0}" -f $Bundle)
Write-Output ('=' * 74)
foreach ($m in $ok)   { Write-Output ("  ok    {0}" -f $m) }
foreach ($m in $warn) { Write-Output ("  warn  {0}" -f $m) }
foreach ($m in $fail) { Write-Output ("  FAIL  {0}" -f $m) }
Write-Output ('=' * 74)

if ($OutJson) {
  $report = [ordered]@{
    generated = (Get-Date).ToString('o')
    generator = 'scripts/Test-BundleConfig.ps1'
    bundle    = $Bundle
    posture   = $Posture
    ok        = @($ok)
    warnings  = @($warn)
    failures  = @($fail)
    pass      = ($fail.Count -eq 0)
  }
  $dir = Split-Path $OutJson -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  [IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Write-Output ("report: {0}" -f $OutJson)
}

if ($fail.Count -gt 0) {
  Write-Output ("RESULT: DO NOT DEPLOY   {0} failure(s)" -f $fail.Count)
  Write-Output ''
  exit 1
}
Write-Output ("RESULT: OK   {0} warning(s)" -f $warn.Count)
Write-Output ''
exit 0
