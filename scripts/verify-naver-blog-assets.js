import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const PDF_DIR = process.env.NAVER_BLOG_PDF_DIR || 'output/naver-blog-pdfs';
const STATS_DIR = process.env.NAVER_BLOG_ANALYTICS_DIR || 'output/naver-blog-analytics';
const ANALYSIS_DIR = process.env.CONTENT_ANALYSIS_DIR || 'data/content/analysis';
const PARSED_DIR = process.env.CONTENT_PARSED_DIR || 'data/content/parsed';
const CLASSIFIED_DIR = process.env.CONTENT_CLASSIFIED_DIR || 'data/content/classified';
const SEGMENTED_DIR = process.env.CONTENT_SEGMENTED_DIR || 'data/content/segmented';
const REPORT_JSON = process.env.COLLECTION_VERIFY_JSON || 'output/naver-blog-collection-verify.json';
const REPORT_XLSX = process.env.COLLECTION_VERIFY_XLSX || 'output/naver-blog-collection-verify.xlsx';
const EXPECTED_START = Number(process.env.NAVER_EXPECTED_START_PAGE || 43);
const EXPECTED_END = Number(process.env.NAVER_EXPECTED_END_PAGE || 206);

function parsePageNo(fileName) {
  const n = String(fileName || '');
  const m = n.match(/_(\d{3})(?:-(\d+))?(?:-(\d+))?\.pdf$/i);
  if (!m) return null;
  return Number(m[1]);
}

function parseChunkNo(fileName) {
  const n = String(fileName || '');
  const m = n.match(/_(\d{3})(?:-(\d+))?(?:-(\d+))?\.pdf$/i);
  if (!m) return null;
  if (m[3]) return Number(m[3]);
  if (m[2]) return Number(m[2]);
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

async function listFiles(absDir, exts) {
  const names = await readdir(absDir).catch(() => []);
  const out = [];
  for (const name of names) {
    const full = path.join(absDir, name);
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    const lower = name.toLowerCase();
    if (exts && exts.length > 0 && !exts.some((x) => lower.endsWith(x))) continue;
    out.push({ name, fullPath: full, size: st.size, modifiedAt: new Date(st.mtimeMs).toISOString() });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function main() {
  const pdfAbs = path.resolve(ROOT, PDF_DIR);
  const statsAbs = path.resolve(ROOT, STATS_DIR);
  const analysisAbs = path.resolve(ROOT, ANALYSIS_DIR);
  const parsedAbs = path.resolve(ROOT, PARSED_DIR);
  const classifiedAbs = path.resolve(ROOT, CLASSIFIED_DIR);
  const segmentedAbs = path.resolve(ROOT, SEGMENTED_DIR);
  const reportJsonAbs = path.resolve(ROOT, REPORT_JSON);
  const reportXlsxAbs = path.resolve(ROOT, REPORT_XLSX);

  const pdfFiles = await listFiles(pdfAbs, ['.pdf']);
  const statsFiles = await listFiles(statsAbs, ['.xls', '.xlsx', '.csv']);
  const analysisFiles = await listFiles(analysisAbs, ['.json', '.md']);
  const parsedFiles = await listFiles(parsedAbs, ['.json']);
  const classifiedFiles = await listFiles(classifiedAbs, ['.json']);
  const segmentedFiles = await listFiles(segmentedAbs, ['.json']);

  const pagesMap = new Map();
  for (const f of pdfFiles) {
    const pageNo = parsePageNo(f.name);
    if (!Number.isFinite(pageNo)) continue;
    const chunk = parseChunkNo(f.name);
    const arr = pagesMap.get(pageNo) || [];
    arr.push({ fileName: f.name, size: f.size, chunkNo: chunk });
    pagesMap.set(pageNo, arr);
  }

  const expectedPages = [];
  const missingPages = [];
  for (let p = EXPECTED_START; p <= EXPECTED_END; p += 1) {
    expectedPages.push(p);
    if (!pagesMap.has(p)) missingPages.push(p);
  }

  const validStats = statsFiles.filter((x) => x.size > 0);
  const invalidStats = statsFiles.filter((x) => x.size <= 0);

  const summary = {
    generatedAt: nowIso(),
    expectedRange: { startPage: EXPECTED_START, endPage: EXPECTED_END, totalPages: expectedPages.length },
    pdf: {
      totalFiles: pdfFiles.length,
      pagesWithPdfInExpectedRange: expectedPages.length - missingPages.length,
      missingPagesInExpectedRange: missingPages.length,
      missingPageList: missingPages,
    },
    analytics: {
      totalFiles: statsFiles.length,
      validFiles: validStats.length,
      invalidFiles: invalidStats.length,
      invalidFileNames: invalidStats.map((x) => x.name),
    },
    analysis: {
      analysisFiles: analysisFiles.length,
      parsedJson: parsedFiles.length,
      classifiedJson: classifiedFiles.length,
      segmentedJson: segmentedFiles.length,
    },
  };

  const report = {
    ...summary,
    files: {
      pdfFiles,
      statsFiles,
      analysisFiles,
      parsedFiles,
      classifiedFiles,
      segmentedFiles,
    },
    pages: [...pagesMap.entries()].map(([pageNo, arr]) => ({
      pageNo,
      fileCount: arr.length,
      totalSize: arr.reduce((a, b) => a + b.size, 0),
      fileNames: arr.map((x) => x.fileName),
    })).sort((a, b) => a.pageNo - b.pageNo),
  };

  await mkdir(path.dirname(reportJsonAbs), { recursive: true });
  await writeFile(reportJsonAbs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet([
    { 항목: '생성시각', 값: summary.generatedAt },
    { 항목: '검증범위시작', 값: EXPECTED_START },
    { 항목: '검증범위종료', 값: EXPECTED_END },
    { 항목: 'PDF파일수', 값: summary.pdf.totalFiles },
    { 항목: '수집완료페이지수', 값: summary.pdf.pagesWithPdfInExpectedRange },
    { 항목: '누락페이지수', 값: summary.pdf.missingPagesInExpectedRange },
    { 항목: '통계파일수(유효)', 값: summary.analytics.validFiles },
    { 항목: '통계파일수(무효)', 값: summary.analytics.invalidFiles },
    { 항목: '분석파일수', 값: summary.analysis.analysisFiles },
    { 항목: 'parsed 수', 값: summary.analysis.parsedJson },
    { 항목: 'classified 수', 값: summary.analysis.classifiedJson },
    { 항목: 'segmented 수', 값: summary.analysis.segmentedJson },
  ]);
  const wsMissing = XLSX.utils.json_to_sheet(missingPages.map((p) => ({ 누락페이지: p })));
  const wsPdf = XLSX.utils.json_to_sheet(pdfFiles.map((x) => ({ 파일명: x.name, 크기바이트: x.size, 수정시각: x.modifiedAt, 페이지번호: parsePageNo(x.name) ?? '' })));
  const wsStats = XLSX.utils.json_to_sheet(statsFiles.map((x) => ({ 파일명: x.name, 크기바이트: x.size, 유효여부: x.size > 0 ? '유효' : '무효', 수정시각: x.modifiedAt })));
  const wsAnalysis = XLSX.utils.json_to_sheet([
    ...analysisFiles.map((x) => ({ 구분: 'analysis', 파일명: x.name, 크기바이트: x.size, 수정시각: x.modifiedAt })),
    ...parsedFiles.map((x) => ({ 구분: 'parsed', 파일명: x.name, 크기바이트: x.size, 수정시각: x.modifiedAt })),
    ...classifiedFiles.map((x) => ({ 구분: 'classified', 파일명: x.name, 크기바이트: x.size, 수정시각: x.modifiedAt })),
    ...segmentedFiles.map((x) => ({ 구분: 'segmented', 파일명: x.name, 크기바이트: x.size, 수정시각: x.modifiedAt })),
  ]);

  XLSX.utils.book_append_sheet(wb, wsSummary, '요약');
  XLSX.utils.book_append_sheet(wb, wsMissing, '누락페이지');
  XLSX.utils.book_append_sheet(wb, wsPdf, 'PDF파일');
  XLSX.utils.book_append_sheet(wb, wsStats, '통계파일');
  XLSX.utils.book_append_sheet(wb, wsAnalysis, '분석파일');
  XLSX.writeFile(wb, reportXlsxAbs);

  console.log(JSON.stringify({ reportJson: reportJsonAbs, reportXlsx: reportXlsxAbs, summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
