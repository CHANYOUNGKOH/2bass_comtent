# Naver Blog PDF Batch Runbook

## Scope
- Script: `scripts/naver-blog-pdf-batch.js`
- Progress file: `output/naver-blog-pdf-progress.json`
- Download directory: `output/naver-blog-pdfs`

## What the script does
- Processes blog pages in order (supports resume).
- For each page: tries `10` posts, on failure tries `5+5`, then `3+3+4`.
- On "saved list full (20)" dialog:
  - opens saved list
  - downloads each row to local
  - deletes the row from saved list
  - re-enters the target page and retries
- Writes progress continuously to `output/naver-blog-pdf-progress.json`.

## Required environment variables
- `NAVER_ID`
- `NAVER_PW`

## Recommended run command (resume-safe)
```powershell
$env:NAVER_ID='...'
$env:NAVER_PW='...'
$env:NAVER_BLOG_START_PAGE='43'
$env:NAVER_BLOG_MAX_ITERATIONS='206'
$env:NAVER_BLOG_PROGRESS_PATH='output/naver-blog-pdf-progress.json'
node scripts/naver-blog-pdf-batch.js
```

## Daily run (recommended)
Run this every day. It starts from page `43` minimum, resumes from progress, and allows future pages (`207+`) by using a large max range.

```powershell
$env:NAVER_ID='...'
$env:NAVER_PW='...'
powershell -ExecutionPolicy Bypass -File scripts/run-naver-blog-daily.ps1 -StartPage 43 -MaxIterations 9999
```

Notes:
- Even if `START_PAGE` is set, script resumes from `progress.nextPage` when that value is within range.
- If you need a hard restart, move/remove `output/naver-blog-pdf-progress.json`.
- With `MaxIterations=9999`, newly added pages after `206` are processed automatically (e.g. `207`, `208`, ...).

## Stop reasons you will see
- `dialog_blocked_on_add`: usually saved-list capacity issue (auto-drain is attempted).
- `make_click_failed`: often daily PDF quota reached.
- `cannot_navigate_to_target_page`: page navigation failed.
- `no_selectable_posts`: no selectable posts in page.

## Daily quota behavior
- Naver can block PDF creation by daily quota ("하루 최대 3GB").
- Saved-list cleanup does **not** reset daily quota.
- Typical recovery is next day reset (KST date boundary in practice).

## Quick verification commands
```powershell
Get-Content output/naver-blog-pdf-progress.json -Raw
(Get-ChildItem -File output/naver-blog-pdfs).Count
```

## Quota/day estimate command
```powershell
$env:NAVER_BLOG_FROM_PAGE='43'
$env:NAVER_BLOG_TO_PAGE='206'
$env:NAVER_BLOG_OBS_PAGES_PER_DAY='24'
node scripts/estimate-naver-blog-quota-days.js
```

Output file:
- `output/naver-blog-quota-estimate-43-206.json`

## Page-size scan (row MB sum)
Use this when you want per-page size from the 10 rows shown in PDF form:
```powershell
$env:NAVER_ID='...'
$env:NAVER_PW='...'
$env:NAVER_BLOG_USAGE_START_PAGE='43'
$env:NAVER_BLOG_USAGE_END_PAGE='206'
node scripts/calc-page-usage-by-row-size.js
```

Output file:
- `output/naver-blog-page-usage-43-206.json`

Notes:
- Script sums per-row `MB` text for first 10 rows per page.
- Some `...1` pages can fail by paginator behavior. Re-scan via:
```powershell
$env:NAVER_BLOG_USAGE_PAGE_LIST='51,61,71,81,91,101,111,121,131,141,151,161,171,181,191,201'
node scripts/calc-page-usage-by-row-size.js
```
