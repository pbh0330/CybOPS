# Rewrite PowerShell script files as UTF-8 WITH BOM.
#
# Windows PowerShell 5.1 assumes the system ANSI codepage for a .ps1 file that
# has no BOM. A UTF-8 source without one gets silently mis-decoded: on this
# machine that turned Korean string literals into mojibake, and the corruption
# flowed straight into generated data files before anyone noticed.
#
# Two ways to stay safe, and this repo uses both:
#   1. Download/acquisition scripts stay pure ASCII (nothing to corrupt).
#   2. Any script that does contain non-ASCII must be saved with a BOM.
#      Run this after editing such a file with a tool that writes BOM-less UTF-8.
#
# Usage:
#   .\scripts\Add-Bom.ps1                    # fix every .ps1 that needs it
#   .\scripts\Add-Bom.ps1 -Path scripts\Test-Ontology.ps1
#   .\scripts\Add-Bom.ps1 -Check             # report only, exit 1 if any need it

param(
  [string]$Path  = '',
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

$targets = @()
if ($Path) {
  $targets = @(Get-Item $Path)
} else {
  $root = Join-Path $PSScriptRoot '..'
  $targets = @(Get-ChildItem $root -Recurse -Filter *.ps1 -File)
}

$needed = @()

foreach ($f in $targets) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  if ($bytes.Length -eq 0) { continue }

  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)

  # non-ASCII present?
  $nonAscii = $false
  foreach ($b in $bytes) { if ($b -gt 0x7F) { $nonAscii = $true; break } }

  if (-not $nonAscii) {
    if ($hasBom) { Write-Output ("ascii+bom  {0}  (harmless)" -f $f.Name) }
    else         { Write-Output ("ascii      {0}" -f $f.Name) }
    continue
  }

  if ($hasBom) {
    Write-Output ("utf8+bom   {0}  ok" -f $f.Name)
    continue
  }

  $needed += $f
  if ($Check) {
    Write-Output ("NEEDS BOM  {0}" -f $f.Name)
    continue
  }

  # decode as UTF-8 (that is what the editor actually wrote) and rewrite with BOM
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $enc  = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($f.FullName, $text, $enc)
  Write-Output ("FIXED      {0}  -> utf8 with BOM" -f $f.Name)
}

Write-Output ""
if ($Check -and $needed.Count -gt 0) {
  Write-Output ("{0} file(s) need a BOM. Run scripts\Add-Bom.ps1 to fix." -f $needed.Count)
  exit 1
}
Write-Output ("done. {0} file(s) changed." -f $(if ($Check) { 0 } else { $needed.Count }))
exit 0
