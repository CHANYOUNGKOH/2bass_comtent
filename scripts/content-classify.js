import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const CONTENT_CATALOG_PATH = process.env.CONTENT_CATALOG_PATH || 'data/content/catalog.json';
const PARSED_DIR = process.env.CONTENT_PARSED_DIR || 'data/content/parsed';
const CLASSIFIED_DIR = process.env.CONTENT_CLASSIFIED_DIR || 'data/content/classified';
const CLASSIFY_LIMIT = Number(process.env.CONTENT_CLASSIFY_LIMIT || 0); // 0 = all
const FORCE_RECLASSIFY = String(process.env.CONTENT_FORCE_RECLASSIFY || 'false').toLowerCase() === 'true';

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

function normalize(s) {
  return String(s || '').toLowerCase();
}

function pickMatches(text, rules) {
  const t = normalize(text);
  return rules.filter((r) => r.patterns.some((p) => t.includes(p)));
}

function classify(item, parsed) {
  const title = item?.identity?.titleStem || '';
  const textBlocks = (parsed?.blocks || []).filter((b) => b.type === 'text').slice(0, 160);
  const body = textBlocks.map((b) => b.text).join(' ');
  const corpus = `${title} ${body}`;

  const brandRules = [
    { key: 'bmw', patterns: ['bmw'] },
    { key: 'audi', patterns: ['audi', '아우디'] },
    { key: 'benz', patterns: ['benz', '벤츠', 'mercedes'] },
    { key: 'hyundai_kia', patterns: ['현대', '기아', 'hyundai', 'kia'] },
    { key: 'chevrolet', patterns: ['쉐보레', 'chevrolet'] },
    { key: 'renault', patterns: ['르노', 'renault', 'sm5'] },
    { key: 'toyota', patterns: ['toyota', '토요타', '시에나'] },
    { key: 'ford', patterns: ['ford', '포드'] },
    { key: 'land_rover', patterns: ['land rover', '레인지로버', '벨라'] },
    { key: 'infiniti', patterns: ['infiniti', '인피니티'] },
  ];

  const workTypeRules = [
    { key: 'brake_tuning', patterns: ['브레이크 튜닝', '브레이크튜닝', '브렘보', 'brembo'] },
    { key: 'pad_change', patterns: ['패드 교체', '패드교환'] },
    { key: 'disc_repair', patterns: ['디스크 연마', '디스크연마'] },
    { key: 'announcement', patterns: ['휴무', '공지', '안내'] },
    { key: 'custom_fabrication', patterns: ['커스텀', '브라켓', '주문제작'] },
    { key: 'inspection_maintenance', patterns: ['정비', '점검', '교환'] },
  ];

  const contentTypeRules = [
    { key: 'notice', patterns: ['공지', '휴무', '안내'] },
    { key: 'case_study', patterns: ['장착', '튜닝', '교체', '셋팅', '세팅', '시공'] },
    { key: 'information', patterns: ['정보'] },
  ];

  const regionRules = [
    { key: 'paju_ilsan', patterns: ['파주', '일산'] },
    { key: 'seoul', patterns: ['서울'] },
    { key: 'nationwide', patterns: ['전국'] },
  ];

  const brand = pickMatches(corpus, brandRules).map((x) => x.key);
  const workType = pickMatches(corpus, workTypeRules).map((x) => x.key);
  const contentType = pickMatches(corpus, contentTypeRules).map((x) => x.key);
  const targetRegion = pickMatches(corpus, regionRules).map((x) => x.key);

  const hasImage = Number(parsed?.summary?.imageBlocks || 0) > 0;
  const confidence = Number(
    (
      (brand.length > 0 ? 0.3 : 0) +
      (workType.length > 0 ? 0.3 : 0) +
      (contentType.length > 0 ? 0.2 : 0) +
      (targetRegion.length > 0 ? 0.1 : 0) +
      (hasImage ? 0.1 : 0)
    ).toFixed(2)
  );

  return {
    categories: {
      brand,
      workType,
      contentType,
      targetRegion,
    },
    confidence,
    requiresReview: confidence < 0.5,
    signals: {
      textBlockCount: Number(parsed?.summary?.textBlocks || 0),
      imageBlockCount: Number(parsed?.summary?.imageBlocks || 0),
    },
  };
}

function ensureCatalogShape(input) {
  return {
    generatedAt: input?.generatedAt || '',
    sourceIndexPath: input?.sourceIndexPath || '',
    itemsByHash: input?.itemsByHash || {},
    orderedHashes: Array.isArray(input?.orderedHashes) ? input.orderedHashes : [],
  };
}

async function main() {
  const catalogPathAbs = path.resolve(ROOT, CONTENT_CATALOG_PATH);
  const parsedDirAbs = path.resolve(ROOT, PARSED_DIR);
  const classifiedDirAbs = path.resolve(ROOT, CLASSIFIED_DIR);
  const catalog = ensureCatalogShape(await loadJson(catalogPathAbs));

  let processed = 0;
  let classified = 0;
  let needsReview = 0;
  let failed = 0;

  for (const hash of catalog.orderedHashes) {
    const item = catalog.itemsByHash[hash];
    if (!item) continue;

    const parseState = item.pipeline?.parseState || 'pending';
    const classifyState = item.pipeline?.classifyState || 'pending';
    if (parseState !== 'parsed') continue;
    if (!FORCE_RECLASSIFY && !(classifyState === 'pending' || classifyState === 'failed')) continue;
    if (CLASSIFY_LIMIT > 0 && processed >= CLASSIFY_LIMIT) break;
    processed += 1;

    const parsedPath = path.join(parsedDirAbs, `${item.contentId}.json`);
    const outPath = path.join(classifiedDirAbs, `${item.contentId}.json`);
    try {
      const parsed = await loadJson(parsedPath);
      const result = classify(item, parsed);
      const out = {
        generatedAt: nowIso(),
        contentId: item.contentId,
        sha256: item.sha256,
        identity: item.identity,
        ...result,
      };
      await saveJson(outPath, out);

      item.classification = out;
      item.pipeline.classifyState = 'classified';
      item.pipeline.lastClassifiedAt = nowIso();
      item.pipeline.classifyError = '';
      item.pipeline.reviewState = out.requiresReview ? 'needs_review' : 'ready';
      if (out.requiresReview) needsReview += 1;
      classified += 1;
      console.log(`[classify] ok ${item.contentId} confidence=${out.confidence} review=${out.requiresReview}`);
    } catch (err) {
      item.pipeline.classifyState = 'failed';
      item.pipeline.lastClassifiedAt = nowIso();
      item.pipeline.classifyError = String(err?.message || err);
      failed += 1;
      console.log(`[classify] fail ${item.contentId} ${item.pipeline.classifyError}`);
    }
  }

  catalog.generatedAt = nowIso();
  await saveJson(catalogPathAbs, catalog);
  console.log(
    JSON.stringify(
      {
        catalogPath: catalogPathAbs,
        classifiedDir: classifiedDirAbs,
        processed,
        classified,
        needsReview,
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
