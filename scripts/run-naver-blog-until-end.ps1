param(
  [int]$StartPage = 43,
  [int]$EndPage = 206,
  [string]$ProgressPath = "output/naver-blog-pdf-progress.json",
  [string]$DownloadDir = "output/naver-blog-pdfs",
  [string]$Headless = "true",
  [int]$SlowMo = 50,
  [int]$MaxAttempts = 300,
  [int]$SleepSeconds = 5
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

if (-not $env:NAVER_ID -or -not $env:NAVER_PW) {
  throw "Set NAVER_ID and NAVER_PW before running."
}

$logPath = Join-Path (Get-Location) "output\daily-run-loop.log"
New-Item -ItemType Directory -Path (Split-Path $logPath) -Force | Out-Null

function Write-LoopLog([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line
  $line | Out-File -FilePath $logPath -Append -Encoding utf8
}

function Get-ProgressSafe([string]$path) {
  try {
    if (-not (Test-Path $path)) { return $null }
    return Get-Content -Raw $path | ConvertFrom-Json
  } catch {
    return $null
  }
}

$attempt = 0
while ($attempt -lt $MaxAttempts) {
  $attempt += 1

  $progress = Get-ProgressSafe -path $ProgressPath
  $nextPage = if ($progress -and $progress.nextPage) { [int]$progress.nextPage } else { $StartPage }

  if ($nextPage -gt $EndPage) {
    Write-LoopLog "completed: nextPage=$nextPage > endPage=$EndPage"
    break
  }

  $env:NAVER_BLOG_START_PAGE = "$StartPage"
  $env:NAVER_BLOG_MAX_ITERATIONS = "$EndPage"
  $env:NAVER_BLOG_PROGRESS_PATH = $ProgressPath
  $env:NAVER_BLOG_DOWNLOAD_DIR = $DownloadDir
  if (-not $env:NAVER_BLOG_TITLE_PREFIX) { $env:NAVER_BLOG_TITLE_PREFIX = "투베이스_블로그" }
  $env:HEADLESS = $Headless
  $env:SLOW_MO = "$SlowMo"

  Write-LoopLog "attempt=$attempt run start (nextPage=$nextPage, endPage=$EndPage)"
  try {
    $dailyLogPath = Join-Path (Get-Location) "output\daily-run.log"
    node "scripts/naver-blog-pdf-batch.js" 2>&1 | ForEach-Object {
      $line = [string]$_
      Write-Host $line
      $line | Out-File -FilePath $dailyLogPath -Append -Encoding utf8
    }
  } catch {
    Write-LoopLog "node run error: $($_.Exception.Message)"
  }

  $after = Get-ProgressSafe -path $ProgressPath
  if ($after -and $after.nextPage -and [int]$after.nextPage -gt $EndPage) {
    Write-LoopLog "completed after run: nextPage=$($after.nextPage)"
    break
  }

  $reason = if ($after) { $after.stopReason } else { "unknown" }
  $afterNext = if ($after -and $after.nextPage) { [int]$after.nextPage } else { -1 }
  Write-LoopLog "run ended: status=$($after.status) reason=$reason nextPage=$afterNext; sleep ${SleepSeconds}s then retry"

  Start-Sleep -Seconds $SleepSeconds
}

Write-LoopLog "loop finished"
