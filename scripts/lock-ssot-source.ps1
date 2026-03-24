param(
  [string]$SourceDir = "output/naver-blog-pdfs"
)

$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$target = Resolve-Path (Join-Path $root $SourceDir)

Get-ChildItem -File -Recurse $target | ForEach-Object {
  $_.IsReadOnly = $true
}

Write-Host "[lock-ssot-source] read-only applied:" $target
