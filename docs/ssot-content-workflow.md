# SSOT Content Workflow

## Goal
- Keep `output/naver-blog-pdfs` as raw source-of-truth (SSOT).
- Do all analysis/transforms in separate workspace paths.
- Support incremental import as new pages are collected daily.

## Paths
- Raw source (SSOT): `output/naver-blog-pdfs`
- Immutable object store: `data/ssot/objects`
- SSOT index: `data/ssot/index.json`
- New-item queue: `data/work/queue/new-items.json`
- Daily work inbox: `data/work/inbox/YYYYMMDD`

## Rules
- Never edit/delete files in `output/naver-blog-pdfs`.
- Only process files from `data/work/inbox/*` or `data/ssot/objects/*`.
- Use SHA-256 hash to deduplicate and track versions.

## Daily run
```powershell
node scripts/ssot-sync.js
```

What it does:
- Scans all PDF files in SSOT source.
- Builds/updates hash index.
- Copies new hashes to immutable object store.
- Copies only new files into `data/work/inbox/<today>/`.

## Optional safety lock
```powershell
powershell -ExecutionPolicy Bypass -File scripts/lock-ssot-source.ps1
```

This marks raw source files as read-only to reduce accidental overwrite/delete risk.

## Incremental behavior
- If tomorrow new PDFs are added (e.g. page 207+), running `ssot-sync.js` again adds only new hashes.
- Existing hashes are not re-imported.
