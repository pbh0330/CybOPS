# Turn a deterministic evidence pack into an LLM briefing.
#
# ASCII only in this file. Every Korean string lives in prompts/ and is read
# with -Encoding utf8 (CLAUDE.md encoding rule 1 and 3). Do not paste Korean
# into this source: PS 5.1 reads a BOM-less .ps1 as the ANSI codepage and the
# mojibake ends up inside generated data.
#
# The model NEVER produces state (ADR-0003). Every number it is allowed to say
# was already computed by the propagation engine and shipped in the pack by
# New-BriefingPack.ps1. This script only formats the pack, calls a model behind
# an adapter, and stores the raw text. Nothing here feeds back into the COP.
#
# The adapter layer is required by ADR-0007: swapping models must cost a prompt
# template plus an eval set, not a rewrite of the call sites. Three adapters:
#
#   dryrun  no model at all. Renders the prompt and writes it to a .prompt.txt.
#           Use this when Ollama is not installed yet, and in CI.
#   ollama  POST {endpoint}/api/generate      default endpoint 127.0.0.1:11434
#   openai  POST {endpoint}/v1/chat/completions   OpenAI-compatible server
#           (llama.cpp --server, vLLM, LM Studio). Default 127.0.0.1:8080.
#
# Model sizing is fixed by ADR-0016: 4-bit 7-14B on the local 11 GB RTX 2080 Ti.
# Do not default to a cloud model here; the demo path must not need network
# (ADR-0016 results, ADR-0012 section 6).
#
# Input : analysis/briefing/<scenario>-t<t>.pack.json  (New-BriefingPack.ps1)
#         prompts/briefing.ko.md
# Output: analysis/briefing/<scenario>-t<t>.<adapter>.brief.json
#
# Usage:
#   .\scripts\Invoke-Briefing.ps1 -Adapter dryrun
#   .\scripts\Invoke-Briefing.ps1 -Adapter ollama -Model qwen2.5:7b-instruct-q4_K_M
#   .\scripts\Invoke-Briefing.ps1 -Adapter openai -Endpoint http://127.0.0.1:8080 -Model local
#
# Exit code 0 = wrote output, 1 = adapter unavailable or bad input.

param(
  [string]$Pack     = "$PSScriptRoot\..\analysis\briefing\tacnet-01-t300.pack.json",
  [string]$Prompt   = "$PSScriptRoot\..\prompts\briefing.ko.md",
  [string]$Model    = 'qwen2.5:7b-instruct-q4_K_M',

  [ValidateSet('ollama', 'openai', 'dryrun')]
  [string]$Adapter  = 'dryrun',

  [string]$Endpoint = '',
  [string]$Out      = '',

  [double]$Temperature = 0.2,
  [int]$TimeoutSec     = 300,
  [string]$ApiKeyEnv   = 'OPENAI_API_KEY'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

if (-not (Test-Path $Pack))   { throw "pack not found: $Pack. Run New-BriefingPack.ps1 first." }
if (-not (Test-Path $Prompt)) { throw "prompt template not found: $Prompt" }

# ---------------------------------------------------------------- defaults

if (-not $Endpoint) {
  switch ($Adapter) {
    'ollama' { $Endpoint = 'http://127.0.0.1:11434' }
    'openai' { $Endpoint = 'http://127.0.0.1:8080' }
    default  { $Endpoint = '' }
  }
}
$Endpoint = $Endpoint.TrimEnd('/')

# ---------------------------------------------------------------- render prompt

$packObj = Get-Content $Pack -Raw -Encoding utf8 | ConvertFrom-Json
$tplRaw  = Get-Content $Prompt -Raw -Encoding utf8

# version string lives in the header comment, and rides along into the output
# so an eval result can never be read without knowing which prompt made it.
$promptVersion = 'unknown'
$mv = [regex]::Match($tplRaw, 'prompt_version:\s*([^\r\n>]+?)\s*-->')
if ($mv.Success) { $promptVersion = $mv.Groups[1].Value.Trim() }

# only the delimited region is sent; the rest of the .md is human commentary
$body = $tplRaw
$mb = [regex]::Match($tplRaw, '<!--\s*PROMPT-BEGIN\s*-->(.*?)<!--\s*PROMPT-END\s*-->', 'Singleline')
if ($mb.Success) {
  $body = $mb.Groups[1].Value.Trim()
} else {
  Write-Warning 'PROMPT-BEGIN / PROMPT-END markers not found; sending the whole file.'
}

$factLines = New-Object System.Collections.ArrayList
foreach ($f in $packObj.facts) {
  [void]$factLines.Add(('[{0}] {1}' -f $f.id, $f.text))
}
$factBlock = ($factLines -join "`n")

$stepLabel = [string]$packObj.step_label
if (-not $stepLabel) { $stepLabel = '-' }

$rendered = $body
$rendered = $rendered.Replace('{{SCENARIO}}',   [string]$packObj.scenario_id)
$rendered = $rendered.Replace('{{CLOCK}}',      [string]$packObj.clock)
$rendered = $rendered.Replace('{{T}}',          ([string][int]$packObj.t))
$rendered = $rendered.Replace('{{STEP_LABEL}}', $stepLabel)
$rendered = $rendered.Replace('{{FACTS}}',      $factBlock)

$left = [regex]::Matches($rendered, '\{\{[A-Z_]+\}\}')
if ($left.Count -gt 0) {
  $names = ($left | ForEach-Object { $_.Value }) -join ', '
  Write-Warning ("unsubstituted placeholders remain: {0}" -f $names)
}

# ---------------------------------------------------------------- output path

if (-not $Out) {
  $dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'analysis\briefing'
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $base = [IO.Path]::GetFileNameWithoutExtension($Pack)
  if ($base.EndsWith('.pack')) { $base = $base.Substring(0, $base.Length - 5) }
  $Out = Join-Path $dir ('{0}.{1}.brief.json' -f $base, $Adapter)
}
$outDir = Split-Path $Out -Parent
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

# ---------------------------------------------------------------- http helper

function Invoke-JsonPost {
  param(
    [string]$Uri,
    $Payload,
    [hashtable]$Headers,
    [int]$Timeout
  )
  $json  = $Payload | ConvertTo-Json -Depth 12 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $args2 = @{
    Uri             = $Uri
    Method          = 'Post'
    Body            = $bytes
    ContentType     = 'application/json; charset=utf-8'
    TimeoutSec      = $Timeout
    UseBasicParsing = $true
  }
  if ($Headers -and $Headers.Count -gt 0) { $args2['Headers'] = $Headers }
  $resp = Invoke-WebRequest @args2

  # decode the body ourselves. PS 5.1 guesses the charset from the response
  # headers and gets Korean wrong often enough to matter.
  $ms = New-Object System.IO.MemoryStream
  $resp.RawContentStream.Position = 0
  $resp.RawContentStream.CopyTo($ms)
  $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
  return ($text | ConvertFrom-Json)
}

function Show-OllamaHelp {
  param([string]$EndpointUrl, [string]$Reason, [string]$ModelName)
  Write-Output ''
  Write-Output ('ERROR: Ollama is not reachable at {0}' -f $EndpointUrl)
  if ($Reason) { Write-Output ('       {0}' -f $Reason) }
  Write-Output ''
  Write-Output 'Install and start it (ADR-0016: local GPU, 4-bit 7-14B):'
  Write-Output '  1. winget install Ollama.Ollama'
  Write-Output '     or download https://ollama.com/download/windows'
  Write-Output '  2. open a NEW terminal so PATH is picked up, then leave it running:'
  Write-Output '       ollama serve'
  Write-Output '  3. pull a model that fits 11 GB VRAM:'
  Write-Output ('       ollama pull {0}' -f $ModelName)
  Write-Output '  4. re-run this script.'
  Write-Output ''
  Write-Output 'No model yet? Render the prompt without one:'
  Write-Output '  .\scripts\Invoke-Briefing.ps1 -Adapter dryrun'
  Write-Output ''
}

# ---------------------------------------------------------------- adapters

$text     = ''
$rawMeta  = $null
$sw       = [Diagnostics.Stopwatch]::StartNew()

switch ($Adapter) {

  'dryrun' {
    # no model. the prompt itself is the artifact.
    $promptOut = ($Out -replace '\.json$', '') + '.prompt.txt'
    [IO.File]::WriteAllText($promptOut, $rendered, (New-Object Text.UTF8Encoding($false)))
    $text = ''
    $rawMeta = [ordered]@{ note = 'dryrun: no model was called'; prompt_file = $promptOut }
  }

  'ollama' {
    $tagUri = $Endpoint + '/api/tags'
    $tags = $null
    try {
      $tags = Invoke-RestMethod -Uri $tagUri -Method Get -TimeoutSec 5 -UseBasicParsing
    } catch {
      Show-OllamaHelp -EndpointUrl $Endpoint -Reason $_.Exception.Message -ModelName $Model
      exit 1
    }

    $have = @()
    foreach ($m in @($tags.models)) { $have += [string]$m.name }
    $match = $false
    foreach ($n in $have) {
      if ($n -eq $Model -or $n -eq ($Model + ':latest') -or $n.StartsWith($Model + ':')) { $match = $true }
    }
    if (-not $match) {
      Write-Output ''
      Write-Output ('ERROR: Ollama is running but has no model named "{0}".' -f $Model)
      if ($have.Count -gt 0) { Write-Output ('       installed: {0}' -f ($have -join ', ')) }
      else                   { Write-Output '       installed: (none)' }
      Write-Output ''
      Write-Output ('  ollama pull {0}' -f $Model)
      Write-Output ''
      exit 1
    }

    $payload = [ordered]@{
      model   = $Model
      prompt  = $rendered
      stream  = $false
      options = [ordered]@{ temperature = $Temperature }
    }
    $r = Invoke-JsonPost -Uri ($Endpoint + '/api/generate') -Payload $payload -Headers @{} -Timeout $TimeoutSec
    $text = [string]$r.response
    $rawMeta = [ordered]@{
      eval_count         = $r.eval_count
      prompt_eval_count  = $r.prompt_eval_count
      total_duration_ns  = $r.total_duration
      done_reason        = [string]$r.done_reason
    }
  }

  'openai' {
    $headers = @{}
    $key = ''
    if ($ApiKeyEnv) { $key = [Environment]::GetEnvironmentVariable($ApiKeyEnv) }
    if ($key) { $headers['Authorization'] = 'Bearer ' + $key }

    $payload = [ordered]@{
      model       = $Model
      messages    = @( [ordered]@{ role = 'user'; content = $rendered } )
      temperature = $Temperature
      stream      = $false
    }
    try {
      $r = Invoke-JsonPost -Uri ($Endpoint + '/v1/chat/completions') -Payload $payload -Headers $headers -Timeout $TimeoutSec
    } catch {
      Write-Output ''
      Write-Output ('ERROR: no OpenAI-compatible server at {0}' -f $Endpoint)
      Write-Output ('       {0}' -f $_.Exception.Message)
      Write-Output ''
      Write-Output 'Start one (llama.cpp server, vLLM, LM Studio), or use:'
      Write-Output '  .\scripts\Invoke-Briefing.ps1 -Adapter ollama -Model qwen2.5:7b-instruct-q4_K_M'
      Write-Output '  .\scripts\Invoke-Briefing.ps1 -Adapter dryrun'
      Write-Output ''
      exit 1
    }
    $text = [string]$r.choices[0].message.content
    $rawMeta = [ordered]@{
      finish_reason = [string]$r.choices[0].finish_reason
      usage         = $r.usage
    }
  }
}

$sw.Stop()

# ---------------------------------------------------------------- write

$result = [ordered]@{
  prompt_version = $promptVersion
  adapter        = $Adapter
  model          = $Model
  endpoint       = $Endpoint
  pack           = (Resolve-Path $Pack).Path
  pack_version   = $packObj.pack_version
  scenario_id    = $packObj.scenario_id
  t              = $packObj.t
  fact_count     = @($packObj.facts).Count
  temperature    = $Temperature
  generated      = (Get-Date).ToString('o')
  latency_ms     = [int]$sw.ElapsedMilliseconds
  text           = $text
  prompt         = $rendered
  adapter_meta   = $rawMeta
}

[IO.File]::WriteAllText($Out, ($result | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))

Write-Output ''
Write-Output ('prompt : {0}' -f $promptVersion)
Write-Output ('adapter: {0}   model: {1}' -f $Adapter, $Model)
Write-Output ('pack   : {0}  ({1} facts)' -f (Split-Path $Pack -Leaf), @($packObj.facts).Count)
Write-Output ('out    : {0}' -f $Out)
Write-Output ('latency: {0} ms   text: {1} chars' -f [int]$sw.ElapsedMilliseconds, $text.Length)
if ($Adapter -eq 'dryrun') {
  Write-Output ('prompt file: {0}' -f $rawMeta.prompt_file)
  Write-Output 'dryrun: no model was called, "text" is empty by design.'
}
Write-Output ''
