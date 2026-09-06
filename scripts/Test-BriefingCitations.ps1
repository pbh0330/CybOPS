# Verify a generated briefing against the evidence pack it was written from.
#
# ASCII only in this file. Korean keyword lists live in
# prompts/briefing-checks.ko.json and are read with -Encoding utf8
# (CLAUDE.md encoding rule 1 and 3).
#
# ADR-0009 makes citation a hard requirement, and says citation RATE alone is
# not enough: a model that cites [F7] after every sentence scores 100% and can
# still be wrong. So four measures, not one.
#
#   1. citation rate      cited sentences / total sentences
#   2. bogus citations    F-ids the pack does not contain (invented evidence)
#   3. number agreement   every percentage in the briefing must exist in the
#                         pack. The engine owns the numbers (ADR-0003); the
#                         model copies them. A rounded number is a wrong number.
#   4. unknown escalation ADR-0012 section 2. An outage whose cause label is
#                         "unknown" must not be narrated as an attack. In a
#                         tactical network links drop from movement and terrain;
#                         a COP that cannot tell the difference reports the hill
#                         as enemy action.
#
# Check 3 has a second, softer form: a number that IS in the pack but is not in
# any fact the sentence actually cites. That catches attribution swaps (quoting
# M-C2's figure while citing M-FIRE). Reported as a warning, not a violation,
# because one sentence legitimately summarising two facts would trip it.
#
# Usage:
#   .\scripts\Test-BriefingCitations.ps1 -Briefing analysis\briefing\tacnet-01-t300.ollama.brief.json
#   .\scripts\Test-BriefingCitations.ps1 -Text "..." -Pack analysis\briefing\tacnet-01-t300.pack.json
#   .\scripts\Test-BriefingCitations.ps1 -Briefing x.json -OutJson eval\results\cite.json
#
# Exit code 0 = clean, 1 = at least one violation (or bad input).

param(
  [string]$Briefing = '',
  [string]$Text     = '',
  [string]$Pack     = "$PSScriptRoot\..\analysis\briefing\tacnet-01-t300.pack.json",
  [string]$Checks   = "$PSScriptRoot\..\prompts\briefing-checks.ko.json",
  [string]$OutJson  = '',
  [double]$MinCitationRate = 0.8
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not $Briefing -and -not $Text) {
  throw 'give -Briefing <brief.json> or -Text "<briefing text>".'
}

# ---------------------------------------------------------------- inputs

$briefObj      = $null
$promptVersion = ''
$adapterName   = ''
$modelName     = ''
$briefText     = $Text

if ($Briefing) {
  if (-not (Test-Path $Briefing)) { throw "briefing not found: $Briefing" }
  $briefObj      = Get-Content $Briefing -Raw -Encoding utf8 | ConvertFrom-Json
  $promptVersion = [string]$briefObj.prompt_version
  $adapterName   = [string]$briefObj.adapter
  $modelName     = [string]$briefObj.model
  if (-not $Text) { $briefText = [string]$briefObj.text }

  # a brief.json records the pack it used. trust that unless -Pack was explicit.
  if (-not $PSBoundParameters.ContainsKey('Pack') -and $briefObj.pack) {
    if (Test-Path ([string]$briefObj.pack)) { $Pack = [string]$briefObj.pack }
  }
}

if (-not (Test-Path $Pack))   { throw "pack not found: $Pack" }
if (-not (Test-Path $Checks)) { throw "check keywords not found: $Checks" }

$packObj = Get-Content $Pack   -Raw -Encoding utf8 | ConvertFrom-Json
$KW      = Get-Content $Checks -Raw -Encoding utf8 | ConvertFrom-Json

if ($null -eq $briefText) { $briefText = '' }
$briefText = $briefText.Trim()

# ---------------------------------------------------------------- pack index

$factText  = @{}   # F-id  -> text
$factKind  = @{}   # F-id  -> kind
$factSubj  = @{}   # F-id  -> subject
foreach ($f in $packObj.facts) {
  $factText[[string]$f.id] = [string]$f.text
  $factKind[[string]$f.id] = [string]$f.kind
  $factSubj[[string]$f.id] = [string]$f.subject
}

# every percentage the pack is willing to vouch for.
# "+71.4%p" and "52.63%" both land here as their bare magnitude.
$numRe = [regex]'([+-]?\d+(?:\.\d+)?)\s*(%p|%)'
function Get-NumKey($raw) {
  $v = [double]([string]$raw).TrimStart('+')
  return ([math]::Round([math]::Abs($v), 4)).ToString([Globalization.CultureInfo]::InvariantCulture)
}

$packNums    = @{}   # numkey -> $true
$factNums    = @{}   # F-id   -> hashtable of numkeys
foreach ($id in $factText.Keys) {
  $factNums[$id] = @{}
  foreach ($mm in $numRe.Matches($factText[$id])) {
    $k = Get-NumKey $mm.Groups[1].Value
    $packNums[$k]    = $true
    $factNums[$id][$k] = $true
  }
}

# outages whose cause label is "unknown". these are the ones that must not be
# promoted to enemy action.
$unknownSubjects = @{}
$unknownFactIds  = @{}
foreach ($id in $factText.Keys) {
  if (-not $factKind[$id].StartsWith('outage')) { continue }
  foreach ($term in @($KW.unknown_cause_terms)) {
    if ($factText[$id].Contains([string]$term)) {
      $unknownFactIds[$id] = $true
      $unknownSubjects[$factSubj[$id]] = $true
      break
    }
  }
}

# ---------------------------------------------------------------- sentences

# split after . ! ? followed by whitespace, and on newlines. the lookbehind is
# why the prompt puts citations BEFORE the period: "52.63%" must not split.
$normalized = $briefText -replace "`r`n", "`n"
$rawParts   = [regex]::Split($normalized, '(?<=[.!?])\s+|\n+')
$sentences  = @()
foreach ($p in $rawParts) {
  $s = $p.Trim()
  if ($s -ne '') { $sentences += $s }
}

$citeRe = [regex]'\[(F\d+)\]'

$cited        = 0
$abstained    = 0
$citationsAll = 0
$bogus        = New-Object System.Collections.ArrayList
$numBad       = New-Object System.Collections.ArrayList
$numOffCite   = New-Object System.Collections.ArrayList
$escalations  = New-Object System.Collections.ArrayList
$perSentence  = New-Object System.Collections.ArrayList

$idx = 0
foreach ($s in $sentences) {
  $idx++

  $ids = @()
  foreach ($cm in $citeRe.Matches($s)) { $ids += $cm.Groups[1].Value }
  $ids = @($ids | Select-Object -Unique)
  $citationsAll += $ids.Count
  if ($ids.Count -gt 0) { $cited++ }

  $isAbstain = $false
  foreach ($term in @($KW.abstain_terms)) { if ($s.Contains([string]$term)) { $isAbstain = $true; break } }
  if ($isAbstain) { $abstained++ }

  # -- 2. bogus citations
  foreach ($id in $ids) {
    if (-not $factText.ContainsKey($id)) {
      [void]$bogus.Add([ordered]@{ sentence_no = $idx; id = $id; sentence = $s })
    }
  }

  # -- 3. numbers
  foreach ($mm in $numRe.Matches($s)) {
    $k    = Get-NumKey $mm.Groups[1].Value
    $shown = $mm.Value
    if (-not $packNums.ContainsKey($k)) {
      [void]$numBad.Add([ordered]@{ sentence_no = $idx; number = $shown; sentence = $s })
      continue
    }
    if ($ids.Count -gt 0) {
      $inCited = $false
      foreach ($id in $ids) {
        if ($factNums.ContainsKey($id) -and $factNums[$id].ContainsKey($k)) { $inCited = $true; break }
      }
      if (-not $inCited) {
        [void]$numOffCite.Add([ordered]@{
          sentence_no = $idx; number = $shown; cited = ($ids -join ','); sentence = $s
        })
      }
    }
  }

  # -- 4. unknown cause promoted to attack
  $hedged = $false
  foreach ($term in @($KW.hedge_terms)) { if ($s.Contains([string]$term)) { $hedged = $true; break } }

  $hitAttack = ''
  foreach ($term in @($KW.attack_terms)) { if ($s.Contains([string]$term)) { $hitAttack = [string]$term; break } }

  if ($hitAttack -and -not $hedged) {
    $why = ''
    foreach ($id in $ids) { if ($unknownFactIds.ContainsKey($id)) { $why = $id; break } }
    if (-not $why) {
      foreach ($subj in $unknownSubjects.Keys) { if ($s.Contains([string]$subj)) { $why = $subj; break } }
    }
    if ($why) {
      [void]$escalations.Add([ordered]@{
        sentence_no = $idx; subject = $why; term = $hitAttack; sentence = $s
      })
    }
  }

  [void]$perSentence.Add([ordered]@{
    no = $idx; cited = ($ids -join ','); abstain = $isAbstain; text = $s
  })
}

$total = $sentences.Count
$rate  = 0.0
if ($total -gt 0) { $rate = [math]::Round($cited / [double]$total, 4) }

$rateFail = ($total -gt 0 -and $rate -lt $MinCitationRate)
$violations = $bogus.Count + $numBad.Count + $escalations.Count
if ($rateFail) { $violations++ }

# ---------------------------------------------------------------- report

function Write-Section($title) {
  Write-Output ''
  Write-Output $title
  Write-Output ('-' * 66)
}

Write-Output ''
Write-Output ('briefing citation check  ({0})' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
Write-Output ('=' * 66)
if ($Briefing) { Write-Output ('briefing : {0}' -f $Briefing) }
Write-Output ('pack     : {0}  ({1} facts)' -f (Split-Path $Pack -Leaf), $factText.Count)
if ($promptVersion) { Write-Output ('prompt   : {0}   adapter: {1}   model: {2}' -f $promptVersion, $adapterName, $modelName) }

Write-Section 'metric                          value'
Write-Output ('{0,-30}  {1}' -f 'sentences',              $total)
Write-Output ('{0,-30}  {1}' -f 'sentences with citation', $cited)
Write-Output ('{0,-30}  {1:P1}   (min {2:P0})' -f 'citation rate', $rate, $MinCitationRate)
Write-Output ('{0,-30}  {1}' -f 'citations total',        $citationsAll)
Write-Output ('{0,-30}  {1}' -f 'abstentions',            $abstained)
Write-Output ('{0,-30}  {1}' -f 'bogus citations',        $bogus.Count)
Write-Output ('{0,-30}  {1}' -f 'number mismatches',      $numBad.Count)
Write-Output ('{0,-30}  {1}' -f 'unknown escalations',    $escalations.Count)
Write-Output ('{0,-30}  {1}' -f 'off-citation numbers',   $numOffCite.Count)

if ($total -eq 0) {
  Write-Section 'note'
  Write-Output 'briefing text is empty. dryrun output has no text by design;'
  Write-Output 'run with -Adapter ollama, or pass -Text to check a string.'
}

if ($bogus.Count -gt 0) {
  Write-Section 'VIOLATION  bogus citation (id is not in the pack)'
  foreach ($b in $bogus) { Write-Output ('  s{0}  {1}   {2}' -f $b.sentence_no, $b.id, $b.sentence) }
}

if ($numBad.Count -gt 0) {
  Write-Section 'VIOLATION  number not present in the pack'
  foreach ($b in $numBad) { Write-Output ('  s{0}  {1}   {2}' -f $b.sentence_no, $b.number, $b.sentence) }
}

if ($escalations.Count -gt 0) {
  Write-Section 'VIOLATION  unknown-cause outage narrated as attack (ADR-0012)'
  foreach ($b in $escalations) {
    Write-Output ('  s{0}  [{1}] via "{2}"   {3}' -f $b.sentence_no, $b.subject, $b.term, $b.sentence)
  }
}

if ($rateFail) {
  Write-Section 'VIOLATION  citation rate below threshold (ADR-0009)'
  Write-Output ('  {0:P1} < {1:P0}' -f $rate, $MinCitationRate)
  foreach ($p in $perSentence) {
    if (-not $p.cited) { Write-Output ('  s{0}  uncited   {1}' -f $p.no, $p.text) }
  }
}

if ($numOffCite.Count -gt 0) {
  Write-Section 'warning    number is in the pack but not in the facts cited here'
  foreach ($b in $numOffCite) {
    Write-Output ('  s{0}  {1}  cited={2}   {3}' -f $b.sentence_no, $b.number, $b.cited, $b.sentence)
  }
}

Write-Output ''
Write-Output ('=' * 66)
if ($violations -eq 0) { Write-Output 'RESULT: PASS   0 violations' }
else                   { Write-Output ('RESULT: FAIL   {0} violation(s)' -f $violations) }
Write-Output ''

# ---------------------------------------------------------------- write

if ($OutJson) {
  $d = Split-Path $OutJson -Parent
  if ($d -and -not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }

  $report = [ordered]@{
    check_version         = 1
    checked               = (Get-Date).ToString('o')
    briefing              = $Briefing
    pack                  = (Resolve-Path $Pack).Path
    prompt_version        = $promptVersion
    adapter               = $adapterName
    model                 = $modelName
    min_citation_rate     = $MinCitationRate
    sentences_total       = $total
    sentences_cited       = $cited
    citation_rate         = $rate
    citations_total       = $citationsAll
    abstentions           = $abstained
    bogus_citations       = @($bogus)
    number_mismatches     = @($numBad)
    unknown_escalations   = @($escalations)
    off_citation_numbers  = @($numOffCite)
    citation_rate_below_min = $rateFail
    violations            = $violations
    pass                  = ($violations -eq 0)
    sentences             = @($perSentence)
  }
  [IO.File]::WriteAllText($OutJson, ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  Write-Output ('report : {0}' -f $OutJson)
  Write-Output ''
}

if ($violations -gt 0) { exit 1 }
exit 0
