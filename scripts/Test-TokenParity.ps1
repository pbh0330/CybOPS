# Runs the colour token parity check (ui/tools/token-parity.mjs) and exits with
# its code, so Invoke-Gates.ps1 can list it like every other gate.
# ASCII only in this file.
#
# WHY THE WORK IS IN NODE AND THIS IS A WRAPPER
#
# The source of the palette is ui/src/tokens.mjs, an ES module. Reading it from
# PowerShell would mean parsing JavaScript with a regex, which is a second
# reader of the same file and therefore a second thing that can be wrong about
# it. node imports the module the way the app does. Same shape as
# Test-ScenarioInvariants.ps1 and Test-UiUnit.ps1.
#
# WHAT IT CATCHES
#
# The eight cause colours are written in three files: src/tokens.mjs (source),
# src/style.css :root (CSS cannot import a value), and docs/design/tokens.md
# (the table a human diffs against Figma). Edit one, forget the others, and
# nothing complains until the screen and the doc disagree about what red means.
#
# Usage:
#   .\scripts\Test-TokenParity.ps1
#   .\scripts\Test-TokenParity.ps1 -Detail
param(
  [switch]$Detail
)
$ErrorActionPreference = 'Continue'
$ui = Join-Path (Split-Path $PSScriptRoot -Parent) 'ui'
$tool = Join-Path $ui 'tools\token-parity.mjs'
if (-not (Test-Path $tool)) {
  Write-Output "missing: $tool"
  exit 1
}
Push-Location $ui
try {
  if ($Detail) {
    cmd /c "node tools\token-parity.mjs --verbose"
  } else {
    cmd /c "node tools\token-parity.mjs"
  }
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($null -eq $code) { $code = 1 }
exit $code
