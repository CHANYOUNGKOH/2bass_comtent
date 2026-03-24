import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = process.cwd();
const CONTENT_CATALOG_PATH = process.env.CONTENT_CATALOG_PATH || 'data/content/catalog.json';
const PARSED_DIR = process.env.CONTENT_PARSED_DIR || 'data/content/parsed';
const PARSE_LIMIT = Number(process.env.CONTENT_PARSE_LIMIT || 0); // 0 = all

function nowIso() {
  return new Date().toISOString();
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureCatalogShape(input) {
  return {
    generatedAt: input?.generatedAt || '',
    sourceIndexPath: input?.sourceIndexPath || '',
    itemsByHash: input?.itemsByHash || {},
    orderedHashes: Array.isArray(input?.orderedHashes) ? input.orderedHashes : [],
  };
}

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function groupTextLines(items) {
  const clean = items
    .map((it) => {
      const text = normalizeText(it?.str);
      if (!text) return null;
      const t = Array.isArray(it?.transform) ? it.transform : [0, 0, 0, 0, 0, 0];
      return {
        text,
        x: Number(t[4] || 0),
        y: Number(t[5] || 0),
      };
    })
    .filter(Boolean);

  clean.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 1.5) return dy;
    return a.x - b.x;
  });

  const lines = [];
  for (const item of clean) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.y - item.y) > 1.8) {
      lines.push({ y: item.y, parts: [item] });
      continue;
    }
    last.parts.push(item);
  }

  return lines.map((line, idx) => {
    const sorted = [...line.parts].sort((a, b) => a.x - b.x);
    return {
      lineNo: idx + 1,
      y: Number(line.y.toFixed(2)),
      text: normalizeText(sorted.map((p) => p.text).join(' ')),
    };
  });
}

async function parsePdfToBlocks(filePath) {
  const docTask = pdfjsLib.getDocument({
    url: filePath,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await docTask.promise;
  const blocks = [];
  const pages = [];
  let order = 0;

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    const lines = groupTextLines(textContent.items || []);

    let textCount = 0;
    for (const line of lines) {
      if (!line.text) continue;
      order += 1;
      textCount += 1;
      blocks.push({
        blockId: `b_${pageNo}_${order}`,
        pageNo,
        order,
        type: 'text',
        text: line.text,
        bbox: {
          y: line.y,
        },
      });
    }

    const operatorList = await page.getOperatorList().catch(() => ({ fnArray: [] }));
    const fnArray = operatorList?.fnArray || [];
    const imageOps = fnArray.filter(
      (fn) =>
        fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintInlineImageXObject ||
        fn === pdfjsLib.OPS.paintJpegXObject
    );

    for (let i = 0; i < imageOps.length; i += 1) {
      order += 1;
      blocks.push({
        blockId: `b_${pageNo}_${order}`,
        pageNo,
        order,
        type: 'image',
        text: '',
        bbox: null,
      });
    }

    pages.push({
      pageNo,
      width: Number(viewport.width.toFixed(2)),
      height: Number(viewport.height.toFixed(2)),
      textBlocks: textCount,
      imageBlocks: imageOps.length,
    });
  }

  await doc.destroy();
  return {
    pageCount: doc.numPages,
    pages,
    blocks,
    summary: {
      textBlocks: blocks.filter((b) => b.type === 'text').length,
      imageBlocks: blocks.filter((b) => b.type === 'image').length,
    },
  };
}

async function main() {
  const catalogPathAbs = path.resolve(ROOT, CONTENT_CATALOG_PATH);
  const parsedDirAbs = path.resolve(ROOT, PARSED_DIR);
  const catalog = ensureCatalogShape(await loadJson(catalogPathAbs));

  let processed = 0;
  let parsed = 0;
  let failed = 0;

  for (const hash of catalog.orderedHashes) {
    const item = catalog.itemsByHash[hash];
    if (!item) continue;

    const state = item.pipeline?.parseState || 'pending';
    if (!(state === 'pending' || state === 'failed')) continue;
    if (PARSE_LIMIT > 0 && processed >= PARSE_LIMIT) break;
    processed += 1;

    const outputPath = path.join(parsedDirAbs, `${item.contentId}.json`);
    try {
      const parsedData = await parsePdfToBlocks(item.source.objectPath);
      const out = {
        generatedAt: nowIso(),
        contentId: item.contentId,
        sha256: item.sha256,
        source: item.source,
        identity: item.identity,
        ...parsedData,
      };
      await saveJson(outputPath, out);

      item.pipeline.parseState = 'parsed';
      item.pipeline.lastParsedAt = nowIso();
      item.pipeline.parseError = '';
      item.parseMeta = {
        outputPath,
        pageCount: parsedData.pageCount,
        textBlocks: parsedData.summary.textBlocks,
        imageBlocks: parsedData.summary.imageBlocks,
        parsedAt: nowIso(),
      };
      parsed += 1;
      console.log(`[parse] ok ${item.contentId} pages=${parsedData.pageCount} text=${parsedData.summary.textBlocks} image=${parsedData.summary.imageBlocks}`);
    } catch (err) {
      item.pipeline.parseState = 'failed';
      item.pipeline.lastParsedAt = nowIso();
      item.pipeline.parseError = String(err?.message || err);
      item.parseMeta = {
        outputPath,
        parsedAt: nowIso(),
      };
      failed += 1;
      console.log(`[parse] fail ${item.contentId} ${item.pipeline.parseError}`);
    }
  }

  catalog.generatedAt = nowIso();
  await saveJson(catalogPathAbs, catalog);

  console.log(
    JSON.stringify(
      {
        catalogPath: catalogPathAbs,
        parsedDir: parsedDirAbs,
        processed,
        parsed,
        failed,
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
