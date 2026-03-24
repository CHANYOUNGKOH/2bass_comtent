param(
  [int]$StartPage = 43,
  [int]$MaxIterations = 9999,
  [string]$ProgressPath = "output/naver-blog-pdf-progress.json",
  [string]$DownloadDir = "output/naver-blog-pdfs",
  [string]$Headless = "false",
  [int]$SlowMo = 100
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

if (-not $env:NAVER_ID -or -not $env:NAVER_PW) {
  throw "Set NAVER_ID and NAVER_PW in current shell before running."
}

$env:NAVER_BLOG_START_PAGE = "$StartPage"
$env:NAVER_BLOG_MAX_ITERATIONS = "$MaxIterations"
$env:NAVER_BLOG_PROGRESS_PATH = $ProgressPath
$env:NAVER_BLOG_DOWNLOAD_DIR = $DownloadDir
$env:HEADLESS = $Headless
$env:SLOW_MO = "$SlowMo"

Write-Host "[daily-run] START_PAGE=$($env:NAVER_BLOG_START_PAGE)"
Write-Host "[daily-run] MAX_ITERATIONS=$($env:NAVER_BLOG_MAX_ITERATIONS)"
Write-Host "[daily-run] PROGRESS_PATH=$($env:NAVER_BLOG_PROGRESS_PATH)"
Write-Host "[daily-run] DOWNLOAD_DIR=$($env:NAVER_BLOG_DOWNLOAD_DIR)"

node "scripts/naver-blog-pdf-batch.js"
