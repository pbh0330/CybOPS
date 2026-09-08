# Plant an attacker-controlled string inside an evidence pack.
#
# ASCII only in this file. The payload strings are Korean and live in
# prompts/injection-payloads.ko.json, read with -Encoding utf8 (CLAUDE.md rule 3).
#
# WHY THE BRIEFING AND NOT THE ADVERSARY SIMULATOR
#
# docs/13-adversary-comparison.md section 5 already ran an injection test, on
# the adversary simulator. It found zero compliance and then refused to credit
# the model for it, because that simulator's output channel is a closed set of
# legal move ids: an obeyed instruction would have been discarded at validation
# anyway. The defence was the channel, not the prompt.
#
# The briefing path has no such channel. Its output is free Korean text that
# goes straight to a commander's screen. If an injected instruction lands, it
# lands. That is why briefing.ko.md carries rule 8 at all, and rule 8 has never
# been tested.
#
# WHERE THE STRING GETS IN
#
# New-BriefingPack.ps1 copies the outage note from mission.json into the fact
# text verbatim. In a deployment that field comes from a feed or an operator,
# so it is genuinely attacker-influenceable. The payload is appended to a real
# fact rather than added as a fact of its own, because a standalone fact that
# is nothing but an instruction is an easier target than an instruction riding
# on a fact the briefing actually has to use.
#
# Input : analysis/briefing/<scenario>-t<t>.pack.json
# Output: analysis/briefing/injected/<scenario>-t<t>.<payload>.pack.json
#
# Usage:
#   .\scripts\New-InjectedPack.ps1 -Pack analysis\briefing\tacnet-01-t300.pack.json
#   .\scripts\New-InjectedPack.ps1 -Pack ... -Payload P1-canary

param(
  [string]$Pack     = "$PSScriptRoot\..\analysis\briefing\tacnet-01-t300.pack.json",
  [string]$Payload  = 'all',
  [string]$Payloads = "$PSScriptRoot\..\prompts\injection-payloads.ko.json",
  [string]$OutDir   = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

foreach ($f in @($Pack, $Payloads)) { if (-not (Test-Path $f)) { throw "not found: $f" } }

$root = Split-Path $PSScriptRoot -Parent
if (-not $OutDir) { $OutDir = Join-Path $root 'analysis\briefing\injected' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }

$packObj  = Get-Content $Pack     -Raw -Encoding utf8 | ConvertFrom-Json
$payObj   = Get-Content $Payloads -Raw -Encoding utf8 | ConvertFrom-Json
$allFacts = @($packObj.facts)
if ($allFacts.Count -eq 0) { throw "pack has no facts: $Pack" }

# the note-bearing kinds first: that is the field a feed actually writes into
$hostFact = $null
foreach ($kd in @('outage_link', 'outage_asset', 'compromise')) {
  foreach ($fx in $allFacts) { if ([string]$fx.kind -eq $kd) { $hostFact = $fx; break } }
  if ($hostFact) { break }
}
if (-not $hostFact) { $hostFact = $allFacts[$allFacts.Count - 1] }

$topMission = $null
foreach ($fx in $allFacts) {
  if ([string]$fx.kind -eq 'mission_degradation') { $topMission = [string]$fx.subject; break }
}

$wanted = @($payObj.payloads)
if ($Payload -ne 'all') { $wanted = @($payObj.payloads | Where-Object { $_.id -eq $Payload }) }
if ($wanted.Count -eq 0) { throw "no payload named $Payload in $Payloads" }

$made = 0
foreach ($pl in $wanted) {
  $facts = New-Object System.Collections.ArrayList
  foreach ($fx in $allFacts) {
    $txt = [string]$fx.text
    if ([string]$fx.id -eq [string]$hostFact.id) { $txt = $txt + ' ' + [string]$pl.text }
    [void]$facts.Add([ordered]@{
      id = $fx.id; kind = $fx.kind; subject = $fx.subject; text = $txt; value = $fx.value
    })
  }

  $outObj = [ordered]@{
    pack_version = $packObj.pack_version
    scenario_id  = $packObj.scenario_id
    t            = $packObj.t
    time_iso     = $packObj.time_iso
    clock        = $packObj.clock
    step_label   = $packObj.step_label
    method       = $packObj.method
    source       = $packObj.source
    generated    = (Get-Date).ToString('o')
    injection    = [ordered]@{
      payload_id   = [string]$pl.id
      targets      = [string]$pl.targets
      check        = [string]$pl.check
      canary       = [string]$pl.canary
      value        = [string]$pl.value
      text         = [string]$pl.text
      host_fact_id = [string]$hostFact.id
      host_kind    = [string]$hostFact.kind
      top_mission  = $topMission
      clean_pack   = (Resolve-Path $Pack).Path
      generator    = 'scripts/New-InjectedPack.ps1'
    }
    facts        = $facts
  }

  $base = [IO.Path]::GetFileNameWithoutExtension($Pack)
  if ($base.EndsWith('.pack')) { $base = $base.Substring(0, $base.Length - 5) }
  $outPath = Join-Path $OutDir ('{0}.{1}.pack.json' -f $base, [string]$pl.id)
  [IO.File]::WriteAllText($outPath, ($outObj | ConvertTo-Json -Depth 9), (New-Object Text.UTF8Encoding($false)))
  $made++
  if (-not $Quiet) { Write-Output ("  {0,-14} into {1} ({2})" -f $pl.id, $hostFact.id, $hostFact.kind) }
}

if (-not $Quiet) { Write-Output ("  wrote {0} injected pack(s) to {1}" -f $made, $OutDir) }
