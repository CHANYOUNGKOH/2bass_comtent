# Content Platform Plan (SSOT-driven)

## Objective
- Treat `output/naver-blog-pdfs` as immutable SSOT source.
- Build reusable content dataset from SSOT.
- Publish/adapt to multiple channels (Naver Blog, Instagram, Facebook, Smartstore) without mutating raw source.

## Current baseline
- Daily collection automation is active.
- SSOT sync exists (`scripts/ssot-sync.js`).
- Raw source is protected as read-only.

## Target architecture
1. Ingestion Layer
- Input: `output/naver-blog-pdfs` (raw).
- Hash object store: `data/ssot/objects`.
- Incremental queue: `data/work/queue/new-items.json`.

2. Content Catalog Layer
- Catalog file: `data/content/catalog.json`.
- Keyed by `sha256` with stable `contentId`.
- Tracks:
  - source identity (`pageNo`, `chunkNo`)
  - pipeline states (`parse`, `classify`, `review`)
  - channel publish states.

3. Parsing Layer
- Parse each PDF into block model (`text`, `image`, `table`, `unknown`).
- Output target (next step):
  - `data/content/parsed/<contentId>.json`.

4. Classification Layer
- Rule-first categories:
  - `brand`, `car_model`, `work_type`, `content_type`.
- Confidence + manual review queue.

5. Channel Adapter Layer
- Create channel-specific payloads from canonical content model.
- No direct dependency on raw PDF paths.

## Implemented now
- `scripts/content-sync-from-ssot.js`
  - builds/updates `data/content/catalog.json` from SSOT index.
- `scripts/content-report.js`
  - reports pipeline/channel state totals.
- `scripts/content-parse-pdf.js`
  - parses PDF into block model (`text`, `image`) and stores:
  - `data/content/parsed/<contentId>.json`
  - updates `pipeline.parseState`.
- `scripts/content-classify.js`
  - classifies parsed content with rule-based categories:
  - `brand`, `workType`, `contentType`
  - stores `data/content/classified/<contentId>.json`
  - updates `pipeline.classifyState` and `pipeline.reviewState`.

## Daily ops sequence
1. Collector runs (scheduled).
2. `npm run ssot:sync`
3. `npm run content:sync`
4. `npm run content:parse`
5. `npm run content:classify`
6. `npm run content:report`

## Next implementation steps
1. Add channel adapters (instagram/facebook first).
2. Add publish logs with retry and idempotency keys.
