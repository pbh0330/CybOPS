# Runs the scenario invariant checks (ui/tools/verify-scenarios.mjs) and exits
# with their code, so Invoke-Gates.ps1 can list them like every other gate.
# ASCII only in this file.
#
# WHY THE WORK IS IN NODE AND THIS IS A WRAPPER
#
# The checks have to execute ui/src/engine.js, ui/src/game.js and
# ui/src/attack.js: the step-batching property is about those modules, not about
# the JSON. A PowerShell version would have to reimplement the attacker and the
# turn loop, which is a third implementation of rules that already exist twice
# and is exactly the drift ui/tools/parity.mjs exists to police. Same shape as
# Test-UiUnit.ps1.
#
# Usage:
#   .\scripts\Test-ScenarioInvariants.ps1
#   .\scripts\Test-ScenarioInvariants.ps1 -Detail
param(
  [switch]$Detail
)
$ErrorActionPreference = 'Continue'
$ui = Join-Path (Split-Path $PSScriptRoot -Parent) 'ui'
$tool = Join-Path $ui 'tools\verify-scenarios.mjs'
if (-not (Test-Path $tool)) {
  Write-Output "missing: $tool"
  exit 1
}
Push-Location $ui
try {
  if ($Detail) {
    cmd /c "node tools\verify-scenarios.mjs --verbose"
  } else {
    cmd /c "node tools\verify-scenarios.mjs"
  }
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($null -eq $code) { $code = 1 }
exit $code
