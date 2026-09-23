# Deploy the demo copy to S3 + CloudFront. ASCII only in this file.
#
# WHY THIS EXISTS
#
# docs/21-deployment.md already writes the procedure down, and a procedure that
# is only prose gets skipped on the day it matters. Three of its steps are easy
# to get wrong in a way nothing reports:
#
#   - config.json goes into ui\dist, not ui\public. Editing public/ is correct
#     for the NEXT build and does nothing for the artifact about to be
#     uploaded, so the bundle ships the loopback default and the visitor's own
#     machine becomes the model endpoint.
#   - assets/ and the rest of the bundle want opposite cache headers. The asset
#     filenames are content-hashed and can be immutable for a year; index.html
#     and config.json must not be, or the next deploy is invisible.
#   - s3 sync cannot set a per-key cache-control, which is why config.json is
#     uploaded twice: once by the sync, once by itself with no-store.
#
# So this is the executable half of that procedure. Every step exits 1 on
# failure, and -DryRun prints the commands instead of running them.
#
# WHAT -DryRun DOES AND DOES NOT DO
#
# It runs the local, reversible steps (posture config, bundle gate) and only
# prints the ones that touch AWS or rebuild the bundle. That is deliberate:
# those two are the steps that can fail for a reason worth knowing about
# before anyone types real credentials.
#
# Usage:
#   .\scripts\Deploy-Aws.ps1 -Bucket <name> -DistributionId <id>
#   .\scripts\Deploy-Aws.ps1 -Bucket <name> -DistributionId <id> -Posture proxied
#   .\scripts\Deploy-Aws.ps1 -Bucket <name> -DistributionId <id> -DryRun
#
# -Bucket and -DistributionId are the BucketName and DistributionId outputs of
# the infra/demo-static.yaml stack:
#
#   aws cloudformation describe-stacks --stack-name mc-cycop-demo `
#     --query "Stacks[0].Outputs" --output table
#
# -Posture off (the default) ships llm.enabled = false. -Posture proxied flips
# that one flag, and is only correct when the distribution actually has a model
# origin behind /api/llm with auth and a rate limit (docs/21-deployment.md
# section 3).

param(
  [Parameter(Mandatory = $true)][string]$Bucket,
  [Parameter(Mandatory = $true)][string]$DistributionId,
  [ValidateSet('off', 'proxied')][string]$Posture = 'off',
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$repoRoot  = Split-Path $PSScriptRoot -Parent
$uiDir     = Join-Path $repoRoot 'ui'
$bundleDir = Join-Path $uiDir 'dist'
$stepNo    = 0
$stepTotal = 8

function Write-Step($caption) {
  $script:stepNo++
  Write-Output ''
  Write-Output ("[{0}/{1}] {2}" -f $script:stepNo, $script:stepTotal, $caption)
}

function Stop-Deploy($reason) {
  Write-Output ''
  Write-Output ("STOP: {0}" -f $reason)
  Write-Output ''
  exit 1
}

# Quoting for display only. The real call passes the array through, so an
# argument with a space in it never depends on this.
function Format-Piece($piece) {
  if ($piece -match '[\s*]') { return ('"' + $piece + '"') }
  return $piece
}

function Invoke-Aws($pieces) {
  Write-Output ("      aws " + ((@($pieces) | ForEach-Object { Format-Piece $_ }) -join ' '))
  if ($DryRun) { return }
  & aws @pieces
  if ($LASTEXITCODE -ne 0) { Stop-Deploy ("aws exited {0}" -f $LASTEXITCODE) }
}

# ---------------------------------------------------------------- input check
#
# infra/demo-static.yaml caps BucketName at 56 characters because the log
# bucket is named <name>-logs and S3 stops at 63. Catching a bad name here is
# cheaper than catching it after a build.

if ($Bucket.Length -lt 3 -or $Bucket.Length -gt 56) {
  Stop-Deploy ("bucket name is {0} characters. The stack allows 3 to 56, because the log bucket is <name>-logs and the S3 limit is 63" -f $Bucket.Length)
}
if ($Bucket -notmatch '^[a-z0-9][a-z0-9.-]*[a-z0-9]$') {
  Stop-Deploy ("bucket name '{0}' does not match the stack pattern: lowercase letters, digits, dots and hyphens, starting and ending with a letter or digit" -f $Bucket)
}

$modeLabel = 'live'
if ($DryRun) { $modeLabel = 'DRY RUN - nothing is uploaded' }

Write-Output ''
Write-Output 'deploy: MC-CyCOP demo copy -> S3 + CloudFront'
Write-Output ('=' * 74)
Write-Output ("  bucket       : {0}" -f $Bucket)
Write-Output ("  distribution : {0}" -f $DistributionId)
Write-Output ("  posture      : {0}" -f $Posture)
Write-Output ("  mode         : {0}" -f $modeLabel)
Write-Output ('=' * 74)

# ---------------------------------------------------------------- 1. tools

Write-Step 'tools: aws, node'

$absent = New-Object System.Collections.ArrayList
foreach ($toolName in @('aws', 'node')) {
  $found = Get-Command $toolName -ErrorAction SilentlyContinue
  if ($found) {
    Write-Output ("      ok      {0,-5} {1}" -f $toolName, $found.Source)
  } else {
    Write-Output ("      MISSING {0}" -f $toolName)
    [void]$absent.Add($toolName)
  }
}

if ($absent.Count -gt 0) {
  $howTo = @{
    'aws'  = 'AWS CLI v2 from https://awscli.amazonaws.com/AWSCLIV2.msi , then: aws configure'
    'node' = 'Node 24 portable (the one ui\package.json already uses); put its directory on PATH'
  }
  foreach ($lackingTool in $absent) {
    Write-Output ("      install {0}: {1}" -f $lackingTool, $howTo[$lackingTool])
  }
  if ($DryRun) {
    # A dry run is the one case where a missing tool is not a reason to stop:
    # nothing is going to be invoked, and the remaining steps are what the
    # operator is here to read.
    Write-Output '      dry run: continuing anyway so the rest of the plan stays visible'
  } else {
    Stop-Deploy ("not installed: {0}" -f ($absent -join ', '))
  }
}

# ---------------------------------------------------------------- 2. build

Write-Step 'build the bundle'

if ($SkipBuild) {
  Write-Output '      skipped (-SkipBuild). The existing ui\dist is what gets uploaded'
} else {
  Write-Output ("      cd {0}; npm run build" -f $uiDir)
  if (-not $DryRun) {
    Push-Location $uiDir
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0) { Stop-Deploy ("npm run build exited {0}" -f $LASTEXITCODE) }
    } finally {
      Pop-Location
    }
  }
}

# ---------------------------------------------------------------- 3. config
#
# This one runs in a dry run too. It writes a single file inside the build
# output, which any rebuild undoes, and it is the step whose result the
# operator most needs to see before a real deploy.

Write-Step ("posture config -> ui\dist\config.json ({0})" -f $Posture)

$examplePath = Join-Path $uiDir 'public\config.aws.example.json'
$targetPath  = Join-Path $bundleDir 'config.json'

if (-not (Test-Path $examplePath)) {
  Stop-Deploy ("missing {0}" -f $examplePath)
}
if (-not (Test-Path $bundleDir)) {
  Stop-Deploy ("no bundle at {0}. Run again without -SkipBuild, or build it by hand: cd ui; npm run build" -f $bundleDir)
}

Copy-Item $examplePath $targetPath -Force
Write-Output ("      copied  {0}" -f $examplePath)
Write-Output ("          ->  {0}" -f $targetPath)

if ($Posture -eq 'proxied') {
  $cfgObj = Get-Content $targetPath -Raw -Encoding utf8 | ConvertFrom-Json
  $cfgObj.llm.enabled = $true
  # UTF-8 with no BOM. Set-Content -Encoding utf8 on PowerShell 5.1 writes one,
  # and a BOM in front of a JSON document is the kind of thing that survives
  # fetch().json() and breaks the next reader that runs JSON.parse over the raw
  # text. Test-BundleConfig.ps1 writes its own report the same way.
  $jsonText = $cfgObj | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($targetPath, $jsonText, (New-Object Text.UTF8Encoding($false)))
  Write-Output '      set     llm.enabled = true'
}

$written = Get-Content $targetPath -Raw -Encoding utf8 | ConvertFrom-Json
Write-Output ("      result  llm.enabled = {0}   llm.endpoint = {1}" -f $written.llm.enabled, $written.llm.endpoint)

# ---------------------------------------------------------------- 4. gate

Write-Step 'bundle gate: Test-BundleConfig.ps1 -Posture hosted'

$gatePath = Join-Path $PSScriptRoot 'Test-BundleConfig.ps1'
if (-not (Test-Path $gatePath)) { Stop-Deploy ("missing {0}" -f $gatePath) }

Write-Output ("      {0} -Bundle {1} -Posture hosted" -f $gatePath, $bundleDir)
& $gatePath -Bundle $bundleDir -Posture hosted
if ($LASTEXITCODE -ne 0) {
  Stop-Deploy 'bundle gate failed. Nothing has been uploaded. Fix what it printed and run this again'
}

# ---------------------------------------------------------------- 5. assets
#
# Vite content-hashes these filenames, so a year of immutable caching is safe:
# a changed file arrives under a new name.

Write-Step 'upload assets/ (immutable, one year)'

Invoke-Aws @(
  's3', 'sync', (Join-Path $bundleDir 'assets'), ("s3://{0}/assets" -f $Bucket),
  '--delete',
  '--cache-control', 'max-age=31536000, immutable'
)

# ---------------------------------------------------------------- 6. the rest
#
# index.html, data/ and config.json keep stable names, so they have to
# revalidate. s3 sync applies one cache-control to everything it copies, which
# is why config.json is uploaded a second time on its own: editing that file IS
# the deploy, and a cached copy of it hides the deploy that just happened.

Write-Step 'upload the rest (no-cache), then config.json again (no-store)'

Invoke-Aws @(
  's3', 'sync', $bundleDir, ("s3://{0}" -f $Bucket),
  '--delete',
  '--exclude', 'assets/*',
  '--cache-control', 'no-cache'
)

Invoke-Aws @(
  's3', 'cp', $targetPath, ("s3://{0}/config.json" -f $Bucket),
  '--cache-control', 'no-store',
  '--content-type', 'application/json'
)

# ---------------------------------------------------------------- 7. invalidate

Write-Step 'invalidate the distribution'

Invoke-Aws @(
  'cloudfront', 'create-invalidation',
  '--distribution-id', $DistributionId,
  '--paths', '/*'
)

# ---------------------------------------------------------------- 8. verify

$expectLine = 'false'
if ($Posture -eq 'proxied') { $expectLine = 'true, with endpoint /api/llm' }

Write-Step 'what to check now'

Write-Output '      These six are list 7.1 of docs/24-aws-demo.md, same numbering. The four'
Write-Output '      that need the GPU origin are 7 to 10 there (AWS-1) and are not printed here.'
Write-Output ''
Write-Output '      1. the distribution URL asks for basic auth, a wrong password gives 401,'
Write-Output '         and the right one opens the page'
Write-Output ("         aws cloudfront get-distribution --id {0} --query Distribution.DomainName" -f $DistributionId)
Write-Output '      2. /config.json in the browser is the file just uploaded, not a cached one'
Write-Output ("         expect llm.enabled = {0}" -f $expectLine)
Write-Output '      3. the situation picture draws and the time slider runs. That IS the evidence'
Write-Output '         that the engine runs in the browser: dragging it adds no network requests'
Write-Output '      4. in the sandbox (sandbox-01), placing assets and linking them fills the'
Write-Output '         readiness card (providers, performers, reachability)'
Write-Output '      5. with no model at all: a briefing renders with its citations and the wargame'
Write-Output '         staff ranking table appears. Only the LLM attacker is disabled, WITH its'
Write-Output '         reason (config.json llm.unavailable_note), and greedy / random still run'
Write-Output '      6. assets/* come back with max-age=31536000 and index.html does not'
Write-Output '         curl -sI <url>/index.html   and   curl -sI <url>/assets/<one file>'

Write-Output ''
Write-Output ('=' * 74)
if ($DryRun) {
  Write-Output 'DRY RUN complete. Nothing was uploaded and no invalidation was created.'
} else {
  Write-Output 'deploy complete.'
}
Write-Output ''
exit 0
