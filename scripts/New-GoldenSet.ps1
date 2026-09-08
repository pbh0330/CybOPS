# E3 step 1: derive the golden set from the deterministic engine.
#
# ASCII ONLY IN THIS FILE. Korean question and answer templates live in
# prompts/golden-templates.ko.json, read with -Encoding utf8 (CLAUDE.md rule 3).
#
# WHY THIS IS GENERATED AND NOT HAND WRITTEN
#
# The plan's risk register calls manual effort the largest risk, and hand
# writing several hundred golden items is exactly that risk. It is also
# unnecessary, because ADR-0003 already decided what the model is for:
#
#   the LLM summarises, explains and maps. It does not decide state.
#
# So the factual content of a briefing is something the engine has already
# computed. "What is C2 degradation at t+300 and how much of it is attack,
# environment and interaction" has an answer that was calculated, not judged.
# The same is true of which links are cut and under which cause label, which
# assets are compromised, and what isolating a given asset would cost.
#
# The golden answers are therefore READ OFF THE REPLAY. Two scenarios times
# twenty-eight steps times several question shapes is several hundred items with
# no hand labelling, and every one of them is checkable.
#
# This is not a shortcut around the work. It is the payoff of having drawn the
# ADR-0003 boundary in the first place: if the model decided state, there would
# be no ground truth and the set would have to be written by hand.
#
# WHAT THIS CANNOT PRODUCE
#
# Whether a summary is USEFUL. These items ask whether the facts are right.
# Whether a commander is better off for having read it is a different question,
# and ADR-0015 took human evaluation off the table, so docs/20 section 4 records
# it as not measured rather than pretending otherwise.
#
# Usage:
#   .\scripts\New-GoldenSet.ps1
#   .\scripts\New-GoldenSet.ps1 -Scenarios tacnet-01 -OutDir eval\golden

param(
  [string[]]$Scenarios = @('tacnet-01', 'defnet-01'),
  [string]  $DataDir   = "$PSScriptRoot\..\ui\public\data",
  [string]  $OutDir    = "$PSScriptRoot\..\eval\golden",
  [string]  $Templates = "$PSScriptRoot\..\prompts\golden-templates.ko.json",
  [string]  $Author    = 'generated'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not (Test-Path $Templates)) { throw "templates not found: $Templates" }
# $TPL, not $T. PowerShell variables are case insensitive, so $T and the step
# time $t are the SAME variable - assigning $t = [int]$s.t silently replaced the
# template object with an integer and every question came out empty. This is the
# second time this exact bug has happened in this repo (New-BriefingPack.ps1 had
# $l overwrite $L and null every label). Single letter variables are banned here.
$TPL = Get-Content $Templates -Raw -Encoding utf8 | ConvertFrom-Json

function Pct($v) { '{0:N1}%' -f ([double]$v * 100) }

$stamp = (Get-Date).ToString('s')
$counts = [ordered]@{}
$total = 0

foreach ($sid in $Scenarios) {
  $path = Join-Path $DataDir "$sid.replay.json"
  if (-not (Test-Path $path)) { Write-Output ("SKIP {0}: no replay" -f $sid); continue }
  $r = Get-Content $path -Raw -Encoding utf8 | ConvertFrom-Json
  $g = $r.graph
  $steps = @($r.steps)

  $missionName = @{}
  foreach ($m in $g.missions) { $missionName[$m.id] = [string]$m.name }
  $causeLabel = @{}
  if ($g.cause_labels) {
    foreach ($p in $g.cause_labels.PSObject.Properties) { $causeLabel[$p.Name] = [string]$p.Value }
  }

  $items = @{
    'summary'     = New-Object System.Collections.ArrayList
    'cause'       = New-Object System.Collections.ArrayList
    'containment' = New-Object System.Collections.ArrayList
    'query'       = New-Object System.Collections.ArrayList
  }

  for ($i = 0; $i -lt $steps.Count; $i++) {
    $s = $steps[$i]
    $t = if ($null -ne $s.t) { [int]$s.t } else { -1 }
    # The question is read by a person and shown to a model; a full ISO string
    # with seven fractional digits is noise in both cases. The full value stays
    # in time_iso for joining back to the replay.
    $iso = [string]$s.time_iso
    $clock = if ($iso) { ([datetimeoffset]$iso).ToString('HH:mm') } else { "t+$t" }

    foreach ($mid in $missionName.Keys) {
      $tot = [double]$s.mission.$mid
      $atk = if ($s.mission_attack) { [double]$s.mission_attack.$mid } else { $null }
      $env = if ($s.mission_env)    { [double]$s.mission_env.$mid }    else { $null }

      # ---- summary: state the degradation, correctly
      [void]$items['summary'].Add([ordered]@{
        id         = ("{0}:sum:{1}:{2}" -f $sid, $t, $mid)
        scenario   = $sid
        task       = 'summary'
        t          = $t
        time_iso   = $clock
        question   = ($TPL.summary.question -f $missionName[$mid], $clock)
        answer     = [ordered]@{
          mission            = $mid
          degradation        = [math]::Round($tot, 6)
          degradation_text   = (Pct $tot)
        }
        must_contain = @((Pct $tot))
        must_not_say = @()
        difficulty   = if ($tot -eq 0) { 'easy' } else { 'normal' }
        source       = 'engine replay'
        author       = $Author
        created      = $stamp
      })
      $total++

      # ---- cause decomposition: the demo claim of this whole project
      if ($null -ne $atk -and $null -ne $env) {
        $inter = [math]::Max(0.0, $tot - $atk - $env)
        $dominant = if ($inter -gt $atk -and $inter -gt $env) { 'interaction' }
                    elseif ($atk -ge $env) { 'attack' } else { 'environment' }
        [void]$items['cause'].Add([ordered]@{
          id       = ("{0}:cause:{1}:{2}" -f $sid, $t, $mid)
          scenario = $sid
          task     = 'cause'
          t        = $t
          time_iso = $clock
          question = ($TPL.cause.question -f $missionName[$mid], $clock)
          answer   = [ordered]@{
            mission     = $mid
            total       = [math]::Round($tot, 6)
            attack_only = [math]::Round($atk, 6)
            env_only    = [math]::Round($env, 6)
            interaction = [math]::Round($inter, 6)
            dominant    = $dominant
          }
          must_contain = @((Pct $tot), (Pct $atk), (Pct $env))
          # the trap this project exists to avoid: narrating environment as attack
          must_not_say = @(@(if ($atk -eq 0 -and $tot -gt 0) { $TPL.cause.forbidden_attack_claim }) | Where-Object { $_ })
          difficulty   = if ($inter -gt 0.5) { 'hard' } else { 'normal' }
          source       = 'engine replay, cause decomposition'
          author       = $Author
          created      = $stamp
        })
        $total++
      }
    }

    # ---- containment cost: the number a human approves against (ADR-0004)
    if ($s.whatif) {
      foreach ($p in $s.whatif.PSObject.Properties) {
        $aid = $p.Name
        foreach ($mp in $p.Value.delta.PSObject.Properties) {
          $d = [double]$mp.Value
          [void]$items['containment'].Add([ordered]@{
            id       = ("{0}:cost:{1}:{2}:{3}" -f $sid, $t, $aid, $mp.Name)
            scenario = $sid
            task     = 'containment'
            t        = $t
            time_iso = $clock
            question = ($TPL.containment.question -f $aid, $missionName[$mp.Name], $clock)
            answer   = [ordered]@{
              asset        = $aid
              mission      = $mp.Name
              delta        = [math]::Round($d, 6)
              delta_text   = (Pct $d)
              costs_more   = ($d -gt 0)
            }
            must_contain = @((Pct $d))
            must_not_say = @($TPL.containment.forbidden_execution)
            difficulty   = if ($d -gt 0.3) { 'hard' } else { 'normal' }
            source       = 'engine what-if isolation'
            author       = $Author
            created      = $stamp
          })
          $total++
        }
      }
    }

    # ---- query: cut links and their cause labels
    $lo = $s.link_outage
    if ($lo) {
      $cuts = @($lo.PSObject.Properties)
      $unknown = @($cuts | Where-Object { [string]$_.Value -eq 'unknown' } | ForEach-Object { $_.Name })
      [void]$items['query'].Add([ordered]@{
        id       = ("{0}:cuts:{1}" -f $sid, $t)
        scenario = $sid
        task     = 'query'
        t        = $t
        time_iso = $clock
        question = ($TPL.query.question -f $clock)
        answer   = [ordered]@{
          cut_count   = $cuts.Count
          cuts        = @($cuts | ForEach-Object { [ordered]@{ link = $_.Name; cause = [string]$_.Value } })
          unknown_ids = $unknown
        }
        must_contain = @("$($cuts.Count)")
        # ADR-0012: an unknown cause must not be narrated as an attack
        must_not_say = @(@(if ($unknown.Count -gt 0) { $TPL.query.forbidden_unknown_as_attack }) | Where-Object { $_ })
        difficulty   = if ($unknown.Count -gt 0) { 'hard' } else { 'normal' }
        source       = 'engine replay, outage cause labels'
        author       = $Author
        created      = $stamp
      })
      $total++
    }
  }

  foreach ($task in $items.Keys) {
    $rows = $items[$task]
    if ($rows.Count -eq 0) { continue }
    $dir = Join-Path $OutDir $task
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    $out = Join-Path $dir "$sid.jsonl"
    $enc = New-Object System.Text.UTF8Encoding($false)
    $sw = New-Object System.IO.StreamWriter($out, $false, $enc)
    foreach ($row in $rows) { $sw.WriteLine(($row | ConvertTo-Json -Depth 8 -Compress)) }
    $sw.Close()
    $counts["$sid/$task"] = $rows.Count
  }
}

Write-Output ''
Write-Output 'E3 golden set'
Write-Output ('-' * 66)
foreach ($k in $counts.Keys) { Write-Output ("  {0,-28} {1,5} items" -f $k, $counts[$k]) }
Write-Output ('-' * 66)
Write-Output ("  total {0} items" -f $total)
Write-Output ''
Write-Output '  Every answer here was computed by the deterministic engine, not judged.'
Write-Output '  That is possible because ADR-0003 keeps the model out of the state path.'
Write-Output ''
Write-Output ("  written under: {0}" -f (Resolve-Path $OutDir).Path)
Write-Output ''
