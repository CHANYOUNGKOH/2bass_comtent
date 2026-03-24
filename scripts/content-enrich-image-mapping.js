/**
 * content-enrich-image-mapping.js
 * 기존 SSOT에 parsed 데이터 기반 이미지 위치 정보(images.positions) 일괄 추가
 * - parsed 블록에서 pageRange 범위의 이미지 블록 추출
 * - 직전 텍스트 블록 참조(prevTextBlockId, prevText) 기록
 * - images.count를 파싱 기준 이미지 수로 보정, extracted 필드 추가
 */
import { readFile, writeFile, readdir } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const SSOT_DIR = path.resolve(ROOT, 'data/ssot-posts');
const PARSED_DIR = path.resolve(ROOT, 'data/content/parsed');
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const FORCE = String(process.env.FORCE || 'false').toLowerCase() === 'true';

const PAGE_FOOTER_RE = /^\d+\s*[·.]\s*/;

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/**
 * parsed 블록 배열에서 pageRange 범위에 해당하는 블록만 필터
 */
function filterBlocksByPageRange(blocks, pageRange) {
  if (!pageRange || !Array.isArray(blocks)) return [];
  const { start, end } = pageRange;
  return blocks.filter(b => {
    const p = Number(b.pageNo || 0);
    return p >= start && p <= end;
  });
}

/**
 * 이미지 블록마다 직전 텍스트 블록을 찾아 위치 정보 배열 생성
 */
function buildImagePositions(scopedBlocks) {
  const positions = [];
  for (let i = 0; i < scopedBlocks.length; i++) {
    const block = scopedBlocks[i];
    if (block.type !== 'image') continue;

    let prevTextBlock = null;
    for (let j = i - 1; j >= 0; j--) {
      if (scopedBlocks[j]?.type === 'text') {
        const t = normalizeSpace(scopedBlocks[j].text);
        if (PAGE_FOOTER_RE.test(t)) continue; // 페이지 푸터 스킵
        prevTextBlock = scopedBlocks[j];
        break;
      }
    }

    positions.push({
      blockId: block.blockId,
      pageNo: block.pageNo,
      order: block.order,
      prevTextBlockId: prevTextBlock?.blockId || null,
      prevText: prevTextBlock ? normalizeSpace(prevTextBlock.text).slice(0, 80) : null,
    });
  }
  return positions;
}

async function main() {
  // parsed 데이터 캐시 (contentId → blocks)
  const parsedCache = new Map();

  async function getParsedBlocks(contentId) {
    if (parsedCache.has(contentId)) return parsedCache.get(contentId);
    try {
      const parsed = await loadJson(path.join(PARSED_DIR, `${contentId}.json`));
      const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
      parsedCache.set(contentId, blocks);
      return blocks;
    } catch {
      parsedCache.set(contentId, null);
      return null;
    }
  }

  const ssotFiles = (await readdir(SSOT_DIR))
    .filter(f => f.startsWith('cnt_') && f.endsWith('.json'));

  console.log(`SSOT 파일 ${ssotFiles.length}개 처리 시작${DRY_RUN ? ' (DRY RUN)' : ''}...\n`);

  let enriched = 0;
  let skipped = 0;
  let noParsed = 0;
  let alreadyDone = 0;

  for (const file of ssotFiles) {
    const ssotPath = path.join(SSOT_DIR, file);
    const ssot = await loadJson(ssotPath);

    // 이미 positions가 있으면 스킵 (FORCE=true 시 재처리)
    if (!FORCE && Array.isArray(ssot.images?.positions) && ssot.images.positions.length > 0) {
      alreadyDone++;
      continue;
    }

    const contentId = ssot.contentId;
    const pageRange = ssot.pageRange;
    if (!contentId || !pageRange) {
      skipped++;
      continue;
    }

    const blocks = await getParsedBlocks(contentId);
    if (!blocks) {
      noParsed++;
      continue;
    }

    const scopedBlocks = filterBlocksByPageRange(blocks, pageRange);
    const positions = buildImagePositions(scopedBlocks);
    const imageCount = positions.length;

    // images 객체 업데이트
    if (!ssot.images) ssot.images = {};
    const prevCount = ssot.images.count || 0;
    ssot.images.positions = positions;
    ssot.images.count = imageCount;
    // 기존 count를 extracted로 보존 (아직 없는 경우에만)
    if (ssot.images.extracted === undefined) {
      ssot.images.extracted = prevCount;
    }

    if (!DRY_RUN) {
      await writeFile(ssotPath, JSON.stringify(ssot, null, 2) + '\n', 'utf8');
    }

    enriched++;
    if (enriched % 100 === 0) {
      console.log(`  ${enriched}건 처리...`);
    }
  }

  console.log(`\n=== 완료 ===`);
  console.log(`보강: ${enriched}건`);
  console.log(`이미 완료: ${alreadyDone}건`);
  console.log(`parsed 없음: ${noParsed}건`);
  console.log(`스킵(메타 부족): ${skipped}건`);
  console.log(`총 SSOT: ${ssotFiles.length}건`);
}

main().catch(err => { console.error(err); process.exit(1); });
