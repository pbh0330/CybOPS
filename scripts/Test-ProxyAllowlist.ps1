# Deploy allowlist drift gate. ASCII only in this file.
#
# The client calls Ollama through /api/llm/. The proxy examples allow exactly
# the upstream paths the client uses and refuse the rest, because Ollama's API
# is also a model management API. That only holds while the two lists agree.
# They did not: the client moved to /api/chat and the examples still allowed
# /api/generate, so the proxied posture answered 403 to every call.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'ui\src'
$conf = @(
  (Join-Path $root 'deploy\nginx.example.conf'),
  (Join-Path $root 'deploy\Caddyfile.example')
)

$wanted = New-Object System.Collections.Generic.HashSet[string]
Get-ChildItem -Path $src -Recurse -Include *.js, *.mjs | ForEach-Object {
  $text = Get-Content -Raw -Encoding utf8 $_.FullName
  # Any interpolated identifier followed by an upstream path, not just a
  # variable literally named `endpoint`: config.js builds its probe URL from a
  # local `base`, and a regex that only knew `endpoint` would not see it.
  foreach ($m in [regex]::Matches($text, '\$\{[A-Za-z_$][\w.$]*\}(/api/[a-z]+)')) {
    [void]$wanted.Add($m.Groups[1].Value)
  }
}

if ($wanted.Count -eq 0) { Write-Host 'FAIL: no upstream paths found in ui/src'; exit 1 }

$bad = @()
foreach ($file in $conf) {
  $text = Get-Content -Raw -Encoding utf8 $file
  foreach ($path in $wanted) {
    if ($text -notmatch [regex]::Escape("/api/llm$path")) {
      $bad += "$(Split-Path -Leaf $file) is missing /api/llm$path"
    }
  }
}

if ($bad.Count -gt 0) { $bad | ForEach-Object { Write-Host "FAIL: $_" }; exit 1 }
Write-Host "OK: proxy allowlist covers $($wanted.Count) upstream path(s): $($wanted -join ', ')"
exit 0
