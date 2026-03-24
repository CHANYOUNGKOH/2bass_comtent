import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { copyFile } from 'fs/promises';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const SOURCE_DIR = process.env.SSOT_SOURCE_DIR || 'output/naver-blog-pdfs';
const OBJECT_DIR = process.env.SSOT_OBJECT_DIR || 'data/ssot/objects';
const INDEX_PATH = process.env.SSOT_INDEX_PATH || 'data/ssot/index.json';
const INBOX_DIR = process.env.SSOT_INBOX_DIR || 'data/work/inbox';
const QUEUE_PATH = process.env.SSOT_QUEUE_PATH || 'data/work/queue/new-items.json';

function nowIso() {
  return new Date().toISOString();
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function walkPdfFiles(dirPath) {
  const out = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      const child = await walkPdfFiles(full);
      out.push(...child);
      continue;
    }
    if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
      out.push(full);
    }
  }
  return out;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const rs = createReadStream(filePath);
    rs.on('data', (chunk) => h.update(chunk));
    rs.on('end', () => resolve(h.digest('hex')));
    rs.on('error', reject);
  });
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function saveJson(filePath, obj) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function dayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function uniquePath(baseDir, fileName) {
  const parsed = path.parse(fileName);
  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = i === 0
      ? `${parsed.name}${parsed.ext || '.pdf'}`
      : `${parsed.name}-${i}${parsed.ext || '.pdf'}`;
    const full = path.join(baseDir, candidate);
    // eslint-disable-next-line no-await-in-loop
    const s = await stat(full).catch(() => null);
    if (!s) return full;
    i += 1;
  }
}

async function main() {
  const sourceDirAbs = path.resolve(ROOT, SOURCE_DIR);
  const objectDirAbs = path.resolve(ROOT, OBJECT_DIR);
  const indexPathAbs = path.resolve(ROOT, INDEX_PATH);
  const inboxDirAbs = path.resolve(ROOT, INBOX_DIR, dayStamp());
  const queuePathAbs = path.resolve(ROOT, QUEUE_PATH);

  await ensureDir(objectDirAbs);
  await ensureDir(inboxDirAbs);
  await ensureDir(path.dirname(queuePathAbs));

  const index = await loadJson(indexPathAbs, {
    sourceDir: sourceDirAbs,
    generatedAt: '',
    items: [],
    byHash: {},
  });
  const knownHashes = new Set(Object.keys(index.byHash || {}));
  const sourceFiles = await walkPdfFiles(sourceDirAbs);

  const nextItems = [];
  const nextByHash = { ...(index.byHash || {}) };
  const newItems = [];

  for (const sourcePath of sourceFiles) {
    // eslint-disable-next-line no-await-in-loop
    const st = await stat(sourcePath);
    // eslint-disable-next-line no-await-in-loop
    const sha256 = await hashFile(sourcePath);
    const objectPath = path.join(objectDirAbs, `${sha256}.pdf`);
    // eslint-disable-next-line no-await-in-loop
    const objectExists = await stat(objectPath).catch(() => null);
    if (!objectExists) {
      // eslint-disable-next-line no-await-in-loop
      await copyFile(sourcePath, objectPath);
    }

    const sourceName = path.basename(sourcePath);
    const prev = nextByHash[sha256];
    nextByHash[sha256] = {
      sha256,
      objectPath,
      latestSourceName: sourceName,
      size: st.size,
      firstSeenAt: prev?.firstSeenAt || nowIso(),
      lastSeenAt: nowIso(),
    };

    const rec = {
      sourcePath,
      sourceName,
      size: st.size,
      mtimeMs: st.mtimeMs,
      sha256,
      objectPath,
      seenAt: nowIso(),
    };
    nextItems.push(rec);

    if (!knownHashes.has(sha256)) {
      // eslint-disable-next-line no-await-in-loop
      const inboxTarget = await uniquePath(inboxDirAbs, sourceName);
      // eslint-disable-next-line no-await-in-loop
      await copyFile(objectPath, inboxTarget);
      newItems.push({
        ...rec,
        inboxPath: inboxTarget,
      });
    }
  }

  const outIndex = {
    sourceDir: sourceDirAbs,
    generatedAt: nowIso(),
    items: nextItems,
    byHash: nextByHash,
  };
  await saveJson(indexPathAbs, outIndex);
  await saveJson(queuePathAbs, {
    generatedAt: nowIso(),
    newCount: newItems.length,
    items: newItems,
  });

  console.log(
    JSON.stringify(
      {
        sourceDir: sourceDirAbs,
        totalPdfFiles: sourceFiles.length,
        uniqueHashes: Object.keys(nextByHash).length,
        newItems: newItems.length,
        indexPath: indexPathAbs,
        queuePath: queuePathAbs,
        inboxDir: inboxDirAbs,
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
