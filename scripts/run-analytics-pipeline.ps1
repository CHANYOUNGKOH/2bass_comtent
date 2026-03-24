param(
  [switch]$SkipNormalize,
  [switch]$SkipMatch,
  [switch]$SkipContentAnalyze
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

function Run-Step([string]$name, [scriptblock]$cmd) {
  Write-Host "[pipeline] start: $name"
  & $cmd
  if ($LASTEXITCODE -ne 0) {
    throw "step failed: $name (exit=$LASTEXITCODE)"
  }
  Write-Host "[pipeline] done:  $name"
}

Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $SkipNormalize) {
  Run-Step "analytics normalize" { npm.cmd run blog:analytics:normalize }
}

if (-not $SkipMatch) {
  Run-Step "analytics match" { npm.cmd run blog:analytics:match }
}

if (-not $SkipContentAnalyze) {
  Run-Step "content analyze" { npm.cmd run content:analyze }
}

Write-Host "[pipeline] completed"

