import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const SSOT_INDEX_PATH = process.env.SSOT_INDEX_PATH || 'data/ssot/index.json';
const CONTENT_CATALOG_PATH = process.env.CONTENT_CATALOG_PATH || 'data/content/catalog.json';

function nowIso() {
  return new Date().toISOString();
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseSourceName(name) {
  const n = String(name || '');
  const match = n.match(/_(\d{3})(?:-(\d+))?\.pdf$/i);
  if (!match) {
    return {
      pageNo: null,
      chunkNo: null,
      titleStem: n.replace(/\.pdf$/i, ''),
    };
  }
  return {
    pageNo: Number(match[1]),
    chunkNo: match[2] ? Number(match[2]) : null,
    titleStem: n.replace(/\.pdf$/i, ''),
  };
}

function makeContentId(sha256) {
  return `cnt_${sha256.slice(0, 12)}`;
}

function ensureCatalogShape(input) {
  if (!input || typeof input !== 'object') {
    return {
      generatedAt: '',
      sourceIndexPath: '',
      itemsByHash: {},
      orderedHashes: [],
    };
  }
  return {
    generatedAt: input.generatedAt || '',
    sourceIndexPath: input.sourceIndexPath || '',
    itemsByHash: input.itemsByHash || {},
    orderedHashes: Array.isArray(input.orderedHashes) ? input.orderedHashes : [],
  };
}

async function main() {
  const ssotPathAbs = path.resolve(ROOT, SSOT_INDEX_PATH);
  const catalogPathAbs = path.resolve(ROOT, CONTENT_CATALOG_PATH);

  const ssot = await loadJson(ssotPathAbs, null);
  if (!ssot || !ssot.byHash) {
    throw new Error(`SSOT index not found or invalid: ${ssotPathAbs}`);
  }

  const catalog = ensureCatalogShape(await loadJson(catalogPathAbs, null));
  const nextItemsByHash = { ...catalog.itemsByHash };
  const added = [];
  const updated = [];

  const hashes = Object.keys(ssot.byHash);
  for (const hash of hashes) {
    const src = ssot.byHash[hash];
    const parsed = parseSourceName(src.latestSourceName);
    const prev = nextItemsByHash[hash];

    const baseItem = {
      contentId: prev?.contentId || makeContentId(hash),
      sha256: hash,
      source: {
        objectPath: src.objectPath,
        latestSourceName: src.latestSourceName,
        size: src.size,
        firstSeenAt: src.firstSeenAt,
        lastSeenAt: src.lastSeenAt,
      },
      identity: {
        pageNo: parsed.pageNo,
        chunkNo: parsed.chunkNo,
        titleStem: parsed.titleStem,
      },
      pipeline: {
        parseState: prev?.pipeline?.parseState || 'pending',
        segmentState: prev?.pipeline?.segmentState || 'pending',
        classifyState: prev?.pipeline?.classifyState || 'pending',
        reviewState: prev?.pipeline?.reviewState || 'pending',
      },
      channels: {
        naver_blog: prev?.channels?.naver_blog || 'pending',
        instagram: prev?.channels?.instagram || 'pending',
        facebook: prev?.channels?.facebook || 'pending',
        smartstore: prev?.channels?.smartstore || 'pending',
      },
      updatedAt: nowIso(),
      createdAt: prev?.createdAt || nowIso(),
    };

    nextItemsByHash[hash] = baseItem;
    if (!prev) added.push(hash);
    else updated.push(hash);
  }

  const orderedHashes = Object.values(nextItemsByHash)
    .sort((a, b) => {
      const pa = Number.isFinite(a.identity.pageNo) ? a.identity.pageNo : Number.MAX_SAFE_INTEGER;
      const pb = Number.isFinite(b.identity.pageNo) ? b.identity.pageNo : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const ca = Number.isFinite(a.identity.chunkNo) ? a.identity.chunkNo : 0;
      const cb = Number.isFinite(b.identity.chunkNo) ? b.identity.chunkNo : 0;
      if (ca !== cb) return ca - cb;
      return a.source.latestSourceName.localeCompare(b.source.latestSourceName);
    })
    .map((x) => x.sha256);

  const out = {
    generatedAt: nowIso(),
    sourceIndexPath: ssotPathAbs,
    itemsByHash: nextItemsByHash,
    orderedHashes,
  };
  await saveJson(catalogPathAbs, out);

  console.log(
    JSON.stringify(
      {
        catalogPath: catalogPathAbs,
        totalItems: orderedHashes.length,
        added: added.length,
        updated: updated.length,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
