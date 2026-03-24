import { readdir, readFile } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const CATALOG_PATH = process.env.CONTENT_CATALOG_PATH || 'data/content/catalog.json';
const CLASSIFIED_DIR = process.env.CONTENT_CLASSIFIED_DIR || 'data/content/classified';
const SEGMENTED_DIR = process.env.CONTENT_SEGMENTED_DIR || 'data/content/segmented';
const DEDUP_UNIQUE_PATH = process.env.CONTENT_UNIQUE_POSTS_PATH || 'data/content/dedup/posts-unique.json';
const DEDUP_DUP_PATH = process.env.CONTENT_DUPLICATE_POSTS_PATH || 'data/content/dedup/posts-duplicates.json';
const OUT_XLSX_PATH = process.env.CONTENT_XLSX_PATH || 'output/content-classification-report.xlsx';

const LABELS = {
  brand: {
    bmw: 'BMW',
    audi: '아우디',
    benz: '벤츠',
    hyundai_kia: '현대/기아',
    chevrolet: '쉐보레',
    renault: '르노',
    toyota: '토요타',
    ford: '포드',
    land_rover: '랜드로버',
    infiniti: '인피니티',
    none: '미분류',
  },
  workType: {
    brake_tuning: '브레이크 튜닝',
    pad_change: '패드 교체',
    disc_repair: '디스크 정비',
    announcement: '공지/안내',
    custom_fabrication: '커스텀 제작',
    inspection_maintenance: '점검/정비',
    none: '미분류',
  },
  contentType: {
    notice: '공지',
    case_study: '시공사례',
    information: '정보',
    none: '미분류',
  },
  targetRegion: {
    paju_ilsan: '파주/일산',
    seoul: '서울권',
    nationwide: '전국',
    none: '미분류',
  },
};

function mapLabel(group, key) {
  const k = String(key || 'none');
  return LABELS[group]?.[k] || k;
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadJsonOrNull(filePath) {
  try {
    return await loadJson(filePath);
  } catch {
    return null;
  }
}

function csvList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.join(', ');
}

function countBy(values) {
  const out = {};
  for (const v of values) {
    const key = String(v || 'none');
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function pushCategoryRows(rows, type, map) {
  Object.keys(map)
    .sort((a, b) => map[b] - map[a] || a.localeCompare(b))
    .forEach((name) => {
      rows.push({
        분류유형: type,
        분류명: name,
        건수: map[name],
      });
    });
}

async function loadJsonByContentId(dirPathAbs) {
  const files = await readdir(dirPathAbs).catch(() => []);
  const out = {};

  for (const name of files) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const fullPath = path.join(dirPathAbs, name);
    const json = await loadJson(fullPath).catch(() => null);
    if (!json?.contentId) continue;
    out[json.contentId] = json;
  }

  return out;
}

async function main() {
  const catalogAbs = path.resolve(ROOT, CATALOG_PATH);
  const classifiedDirAbs = path.resolve(ROOT, CLASSIFIED_DIR);
  const segmentedDirAbs = path.resolve(ROOT, SEGMENTED_DIR);
  const dedupUniqueAbs = path.resolve(ROOT, DEDUP_UNIQUE_PATH);
  const dedupDupAbs = path.resolve(ROOT, DEDUP_DUP_PATH);
  const outAbs = path.resolve(ROOT, OUT_XLSX_PATH);

  const catalog = await loadJson(catalogAbs);
  const hashes = catalog.orderedHashes || [];

  const classifiedById = await loadJsonByContentId(classifiedDirAbs);
  const segmentedById = await loadJsonByContentId(segmentedDirAbs);
  const dedupUnique = await loadJsonOrNull(dedupUniqueAbs);
  const dedupDup = await loadJsonOrNull(dedupDupAbs);

  const itemRows = [];
  const postRows = [];
  const verifyRows = [];

  for (const hash of hashes) {
    const item = catalog.itemsByHash?.[hash];
    if (!item) continue;

    const cls = classifiedById[item.contentId] || item.classification || {};
    const seg = segmentedById[item.contentId] || {};
    const categories = cls.categories || {};

    const brand = Array.isArray(categories.brand) ? categories.brand : [];
    const workType = Array.isArray(categories.workType) ? categories.workType : [];
    const contentType = Array.isArray(categories.contentType) ? categories.contentType : [];
    const targetRegion = Array.isArray(categories.targetRegion) ? categories.targetRegion : [];

    const postCount = Number(seg.summary?.postCount || item.segmentMeta?.postCount || 0);
    const bodyLineCount = Number(seg.summary?.bodyLines || item.segmentMeta?.bodyLines || 0);
    const commentLineCount = Number(seg.summary?.commentLines || item.segmentMeta?.commentLines || 0);

    itemRows.push({
      콘텐츠ID: item.contentId,
      페이지번호: item.identity?.pageNo ?? '',
      분할번호: item.identity?.chunkNo ?? '',
      제목키: item.identity?.titleStem || '',
      원본파일명: item.source?.latestSourceName || '',
      원본크기바이트: item.source?.size ?? '',
      해시: item.sha256 || '',
      파싱상태: item.pipeline?.parseState || '',
      분할상태: item.pipeline?.segmentState || '',
      분류상태: item.pipeline?.classifyState || '',
      검토상태: item.pipeline?.reviewState || '',
      글개수: postCount,
      본문라인수: bodyLineCount,
      댓글라인수: commentLineCount,
      신뢰도: cls.confidence ?? '',
      브랜드: csvList(brand.map((x) => mapLabel('brand', x))),
      작업유형: csvList(workType.map((x) => mapLabel('workType', x))),
      콘텐츠유형: csvList(contentType.map((x) => mapLabel('contentType', x))),
      타깃지역: csvList(targetRegion.map((x) => mapLabel('targetRegion', x))),
      이미지블록수: cls.signals?.imageBlockCount ?? '',
      텍스트블록수: cls.signals?.textBlockCount ?? '',
      파싱시각: item.pipeline?.lastParsedAt || '',
      분할시각: item.pipeline?.lastSegmentedAt || '',
      분류시각: item.pipeline?.lastClassifiedAt || '',
    });

    const posts = Array.isArray(seg.posts) ? seg.posts : [];
    for (const post of posts) {
      const startPage = Number(post.pageRange?.start || 0);
      const endPage = Number(post.pageRange?.end || 0);
      const hasMarker = Boolean(post.publishedAt) && Boolean(post.sourceUrl);
      const pageRangeOk = Number.isFinite(startPage) && Number.isFinite(endPage) && startPage > 0 && endPage >= startPage;
      const hasContent =
        Number(post.counts?.bodyLines || 0) > 0 ||
        Number(post.counts?.commentLines || 0) > 0 ||
        Number(post.counts?.imageBlocks || 0) > 0;

      const issueList = [];
      if (!hasMarker) issueList.push('마커누락');
      if (!pageRangeOk) issueList.push('페이지범위오류');
      if (!hasContent) issueList.push('내용없음');

      postRows.push({
        콘텐츠ID: item.contentId,
        페이지번호: item.identity?.pageNo ?? '',
        분할번호: item.identity?.chunkNo ?? '',
        글순번: post.postIndex ?? '',
        글ID: post.postId || '',
        발행시각: post.publishedAt || '',
        글URL: post.sourceUrl || '',
        글제목: post.title || '',
        시작페이지: post.pageRange?.start ?? '',
        종료페이지: post.pageRange?.end ?? '',
        본문라인수: post.counts?.bodyLines ?? '',
        댓글라인수: post.counts?.commentLines ?? '',
        이미지블록수: post.counts?.imageBlocks ?? '',
        본문미리보기: csvList(Array.isArray(post.bodyPreview) ? post.bodyPreview : []),
      });

      verifyRows.push({
        콘텐츠ID: item.contentId,
        페이지번호: item.identity?.pageNo ?? '',
        분할번호: item.identity?.chunkNo ?? '',
        글순번: post.postIndex ?? '',
        발행시각마커: post.publishedAt || '',
        URL마커: post.sourceUrl || '',
        시작페이지: post.pageRange?.start ?? '',
        종료페이지: post.pageRange?.end ?? '',
        본문라인수: post.counts?.bodyLines ?? '',
        댓글라인수: post.counts?.commentLines ?? '',
        이미지블록수: post.counts?.imageBlocks ?? '',
        검증결과: issueList.length === 0 ? '정상' : '점검필요',
        점검항목: issueList.join(', '),
      });
    }
  }

  const summaryRows = [];
  const parseStates = countBy(itemRows.map((r) => r.파싱상태 || 'none'));
  const segmentStates = countBy(itemRows.map((r) => r.분할상태 || 'none'));
  const classifyStates = countBy(itemRows.map((r) => r.분류상태 || 'none'));
  const reviewStates = countBy(itemRows.map((r) => r.검토상태 || 'none'));

  summaryRows.push({ 항목: '생성시각', 값: new Date().toISOString() });
  summaryRows.push({ 항목: 'PDF건수', 값: itemRows.length });
  summaryRows.push({ 항목: '글건수', 값: postRows.length });
  summaryRows.push({ 항목: '검증점검건수', 값: verifyRows.filter((x) => x.검증결과 !== '정상').length });
  if (dedupUnique) {
    summaryRows.push({ 항목: 'URL유니크글건수', 값: Number(dedupUnique.uniquePostCount || 0) });
    summaryRows.push({ 항목: '중복URL건수', 값: Number(dedupUnique.duplicateUrlCount || 0) });
  }
  Object.entries(parseStates).forEach(([k, v]) => summaryRows.push({ 항목: `파싱상태:${k}`, 값: v }));
  Object.entries(segmentStates).forEach(([k, v]) => summaryRows.push({ 항목: `분할상태:${k}`, 값: v }));
  Object.entries(classifyStates).forEach(([k, v]) => summaryRows.push({ 항목: `분류상태:${k}`, 값: v }));
  Object.entries(reviewStates).forEach(([k, v]) => summaryRows.push({ 항목: `검토상태:${k}`, 값: v }));

  const categoryRows = [];
  const brandCount = {};
  const workTypeCount = {};
  const contentTypeCount = {};
  const regionCount = {};

  for (const row of itemRows) {
    const brands = String(row.브랜드 || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const works = String(row.작업유형 || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const ctypes = String(row.콘텐츠유형 || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const regions = String(row.타깃지역 || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

    (brands.length ? brands : ['미분류']).forEach((k) => {
      brandCount[k] = (brandCount[k] || 0) + 1;
    });
    (works.length ? works : ['미분류']).forEach((k) => {
      workTypeCount[k] = (workTypeCount[k] || 0) + 1;
    });
    (ctypes.length ? ctypes : ['미분류']).forEach((k) => {
      contentTypeCount[k] = (contentTypeCount[k] || 0) + 1;
    });
    (regions.length ? regions : ['미분류']).forEach((k) => {
      regionCount[k] = (regionCount[k] || 0) + 1;
    });
  }

  pushCategoryRows(categoryRows, '브랜드', brandCount);
  pushCategoryRows(categoryRows, '작업유형', workTypeCount);
  pushCategoryRows(categoryRows, '콘텐츠유형', contentTypeCount);
  pushCategoryRows(categoryRows, '타깃지역', regionCount);

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  const wsItems = XLSX.utils.json_to_sheet(itemRows);
  const wsPosts = XLSX.utils.json_to_sheet(postRows);
  const wsVerify = XLSX.utils.json_to_sheet(verifyRows);
  const wsCats = XLSX.utils.json_to_sheet(categoryRows);

  XLSX.utils.book_append_sheet(wb, wsSummary, '요약');
  XLSX.utils.book_append_sheet(wb, wsItems, 'PDF항목');
  XLSX.utils.book_append_sheet(wb, wsPosts, '글단위');
  XLSX.utils.book_append_sheet(wb, wsVerify, '분할검증');
  if (dedupUnique && Array.isArray(dedupUnique.uniquePosts)) {
    const uniqueRows = dedupUnique.uniquePosts.map((x, i) => ({
      순번: i + 1,
      글URL: x.url || '',
      콘텐츠ID: x.keep?.contentId || '',
      원본파일명: x.keep?.sourceName || '',
      페이지번호: x.keep?.sourcePageNo ?? '',
      글순번: x.keep?.postIndex ?? '',
      발행시각: x.keep?.publishedAt || '',
      글제목: x.keep?.title || '',
      시작페이지: x.keep?.pageRange?.start ?? '',
      종료페이지: x.keep?.pageRange?.end ?? '',
      본문라인수: x.keep?.counts?.bodyLines ?? '',
      댓글라인수: x.keep?.counts?.commentLines ?? '',
      이미지블록수: x.keep?.counts?.imageBlocks ?? '',
      중복제거건수: x.duplicateCount ?? 0,
    }));
    const wsUnique = XLSX.utils.json_to_sheet(uniqueRows);
    XLSX.utils.book_append_sheet(wb, wsUnique, '유니크글');
  }
  if (dedupDup && Array.isArray(dedupDup.duplicateGroups)) {
    const dupRows = dedupDup.duplicateGroups.map((g, i) => ({
      순번: i + 1,
      글URL: g.url || '',
      중복개수: g.count ?? 0,
      유지콘텐츠ID: g.keep?.contentId || '',
      유지원본파일명: g.keep?.sourceName || '',
      유지글순번: g.keep?.postIndex ?? '',
      제거대상목록: csvList((g.drop || []).map((d) => `${d.contentId}#${d.postIndex}`)),
    }));
    const wsDup = XLSX.utils.json_to_sheet(dupRows);
    XLSX.utils.book_append_sheet(wb, wsDup, '중복URL');
  }
  XLSX.utils.book_append_sheet(wb, wsCats, '분류집계');

  XLSX.writeFile(wb, outAbs);

  console.log(
    JSON.stringify(
      {
        outFile: outAbs,
        totalPdfItems: itemRows.length,
        totalPostItems: postRows.length,
        totalVerifyItems: verifyRows.length,
        reviewNeeded: verifyRows.filter((x) => x.검증결과 !== '정상').length,
        summaryRows: summaryRows.length,
        categoryRows: categoryRows.length,
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
