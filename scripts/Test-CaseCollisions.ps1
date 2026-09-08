# Find variables in one file whose names differ only by case.
#
# ASCII only in this file.
#
# WHY THIS EXISTS
#
# PowerShell variable names are case-insensitive, so $Tag and $tag are one
# variable. This repository has now hit that five times:
#
#   $T / $t          New-GoldenSet.ps1        templates overwritten by a step
#                                             time; every generated question
#                                             came out empty
#   $l / $L          New-BriefingPack.ps1     label object overwritten by a
#                                             link loop variable; facts
#                                             rendered as bare values
#   $BAND / $band    Test-GoldenBriefing.ps1  band table overwritten by a band
#                                             name; ECE reported 0.8333 for a
#                                             model that was right 83% of the
#                                             time
#   $SlotTerms /     Test-Abstention.ps1      parameter path overwritten by a
#     $slotTerms                              hashtable; System.String was
#                                             asked for ContainsKey
#   $Tag / $tag      Compare-BriefingModels   parameter overwritten by a per
#                                             -run label; reports were written
#                                             under the wrong name
#
# Three of those produced plausible numbers rather than errors, which is the
# expensive kind. After the third one the note in docs/20 said "writing the
# second one in capitals is not a defence" - and then the fourth and fifth
# happened anyway, written by someone who had just read that note.
#
# Knowing about a bug does not prevent it. A check does.
#
# WHAT IT CANNOT DO
#
# It reads names, not scopes. Function parameters are excluded because those
# genuinely live in their own scope, but a name reused inside a script block or
# a nested function still gets flagged. Treat a hit as a question, not a
# verdict: two spellings of one name are worth ten seconds of reading even when
# they turn out to be fine.
#
# Usage:
#   .\scripts\Test-CaseCollisions.ps1
#   .\scripts\Test-CaseCollisions.ps1 -Path scripts\Compare-BriefingModels.ps1
#
# Exit 1 when a collision is found, so this belongs in CI next to Add-Bom.ps1.

param(
  [string]$Path = "$PSScriptRoot",
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Automatic and preference variables are case-insensitive by definition and are
# not what this is looking for.
$SKIP = @(
  'true','false','null','_','args','input','error','host','home','pwd','pid',
  'psscriptroot','pscommandpath','psitem','matches','lastexitcode','profile',
  'psversiontable','erroractionpreference','warningpreference','myinvocation',
  'stopwatch','ofs','psboundparameters'
)

$files = @()
if (Test-Path $Path -PathType Container) {
  $files = @(Get-ChildItem $Path -Filter '*.ps1' -File | Sort-Object Name)
} else {
  $files = @(Get-Item $Path)
}

$hits = New-Object System.Collections.ArrayList

foreach ($f in $files) {
  $text = Get-Content $f.FullName -Raw

  # Strip line comments and here-strings before looking. A variable that only
  # appears inside a comment cannot collide with anything, and this file itself
  # names five collisions in its own header.
  $code = [regex]::Replace($text, '(?m)#.*$', '')
  $code = [regex]::Replace($code, "@'.*?'@", '', 'Singleline')
  $code = [regex]::Replace($code, '@".*?"@', '', 'Singleline')

  # Names declared as function parameters live in the function's own scope, so
  # `function Combine($pairs, $method)` does not collide with a script-level
  # $Method - the call site passes the value in explicitly. Excluding them is
  # what separates the five real bugs from the ordinary shadowing that fills
  # any PowerShell file.
  $fnParams = @{}
  foreach ($fm in [regex]::Matches($code, '(?im)^\s*function\s+[A-Za-z_][A-Za-z0-9_-]*\s*\(([^)]*)\)')) {
    foreach ($pm in [regex]::Matches($fm.Groups[1].Value, '\$([A-Za-z_][A-Za-z0-9_]*)')) {
      $fnParams[$pm.Groups[1].Value] = $true
    }
  }
  # The other form: a function with its own param() block. The FIRST param()
  # in the file is the script's own, and those are precisely the names that
  # get clobbered by a loop variable later, so it is the one block that must
  # not be excluded.
  $pb = @([regex]::Matches($code, '(?is)param\s*\(([^)]*)\)'))
  for ($bi = 1; $bi -lt $pb.Count; $bi++) {
    foreach ($pm in [regex]::Matches($pb[$bi].Groups[1].Value, '\$([A-Za-z_][A-Za-z0-9_]*)')) {
      $fnParams[$pm.Groups[1].Value] = $true
    }
  }

  $seen = @{}   # lowercase name -> list of spellings actually used
  foreach ($m in [regex]::Matches($code, '\$([A-Za-z_][A-Za-z0-9_]*)')) {
    $name = $m.Groups[1].Value
    $key  = $name.ToLowerInvariant()
    if ($SKIP -contains $key) { continue }
    if ($fnParams.ContainsKey($name)) { continue }
    if (-not $seen.ContainsKey($key)) { $seen[$key] = New-Object System.Collections.ArrayList }
    if (-not $seen[$key].Contains($name)) { [void]$seen[$key].Add($name) }
  }

  foreach ($key in ($seen.Keys | Sort-Object)) {
    if ($seen[$key].Count -lt 2) { continue }
    [void]$hits.Add([ordered]@{
      file      = $f.Name
      name      = $key
      spellings = @($seen[$key])
    })
  }
}

if (-not $Quiet) {
  Write-Output ''
  Write-Output ("case-collision check   {0} file(s) under {1}" -f $files.Count, $Path)
  Write-Output ('=' * 74)
  if ($hits.Count -eq 0) {
    Write-Output '  none'
  } else {
    foreach ($h in $hits) {
      Write-Output ("  {0,-32} {1}" -f $h.file, ((@($h.spellings) | ForEach-Object { '$' + $_ }) -join '  and  '))
    }
    Write-Output ''
    Write-Output '  These are the SAME variable. Rename one so the two differ by more than case.'
  }
  Write-Output ('=' * 74)
}

if ($hits.Count -gt 0) { exit 1 }
exit 0
