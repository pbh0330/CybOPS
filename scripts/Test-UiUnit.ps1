# Runs the UI unit tests (vitest) and exits with their code, so
# Invoke-Gates.ps1 can list them like every other gate. ASCII only.
#
# Usage:
#   .\scripts\Test-UiUnit.ps1
$ErrorActionPreference = 'Continue'
$ui = Join-Path (Split-Path $PSScriptRoot -Parent) 'ui'
if (-not (Test-Path (Join-Path $ui 'node_modules'))) {
  Write-Output "ui/node_modules missing - run npm install in ui first"
  exit 1
}
Push-Location $ui
try {
  cmd /c "npm test --silent"
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($null -eq $code) { $code = 1 }
exit $code
