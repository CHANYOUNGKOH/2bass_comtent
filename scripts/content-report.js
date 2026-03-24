import { readFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const CONTENT_CATALOG_PATH = process.env.CONTENT_CATALOG_PATH || 'data/content/catalog.json';

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function countBy(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  return out;
}

async function main() {
  const catalogPathAbs = path.resolve(ROOT, CONTENT_CATALOG_PATH);
  const catalog = await loadJson(catalogPathAbs);
  const items = (catalog.orderedHashes || []).map((h) => catalog.itemsByHash[h]).filter(Boolean);

  const parseStates = countBy(items.map((x) => x.pipeline?.parseState || 'unknown'));
  const segmentStates = countBy(items.map((x) => x.pipeline?.segmentState || 'unknown'));
  const classifyStates = countBy(items.map((x) => x.pipeline?.classifyState || 'unknown'));
  const reviewStates = countBy(items.map((x) => x.pipeline?.reviewState || 'unknown'));

  const channelNames = ['naver_blog', 'instagram', 'facebook', 'smartstore'];
  const channelStates = {};
  for (const ch of channelNames) {
    channelStates[ch] = countBy(items.map((x) => x.channels?.[ch] || 'unknown'));
  }

  const pages = items
    .map((x) => x.identity?.pageNo)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const report = {
    generatedAt: new Date().toISOString(),
    catalogPath: catalogPathAbs,
    totalItems: items.length,
    pageRange: {
      min: pages.length > 0 ? pages[0] : null,
      max: pages.length > 0 ? pages[pages.length - 1] : null,
    },
    pipeline: {
      parseStates,
      segmentStates,
      classifyStates,
      reviewStates,
    },
    channels: channelStates,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
