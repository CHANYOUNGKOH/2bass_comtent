import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const MULTI_PROGRESS_PATH =
  process.env.NAVER_BLOG_ANALYTICS_MULTI_PROGRESS_PATH || 'output/naver-blog-analytics-download-multi-progress.json';
const NORMALIZED_PATH =
  process.env.NAVER_BLOG_ANALYTICS_NORMALIZED_PATH || 'data/content/analysis/naver-analytics-normalized.json';
const OUT_JSON = process.env.NAVER_BLOG_ANALYTICS_REPORT_JSON || 'output/naver-blog-analytics-summary.json';
const OUT_XLSX = process.env.NAVER_BLOG_ANALYTICS_REPORT_XLSX || 'output/naver-blog-analytics-summary.xlsx';

function nowIso() {
  return new Date().toISOString();
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function parsePeriodFromFileName(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('-day-')) return 'day';
  if (s.includes('-week-')) return 'week';
  if (s.includes('-month-')) return 'month';
  return 'unknown';
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function saveJson(filePath, obj) {
  const abs = path.resolve(ROOT, filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

async function main() {
  const multiAbs = path.resolve(ROOT, MULTI_PROGRESS_PATH);
  const normalizedAbs = path.resolve(ROOT, NORMALIZED_PATH);
  const outJsonAbs = path.resolve(ROOT, OUT_JSON);
  const outXlsxAbs = path.resolve(ROOT, OUT_XLSX);

  const multi = await loadJson(multiAbs);
  const normalized = await loadJson(normalizedAbs);

  const timeSummary = Array.isArray(normalized.timeSeriesSummary) ? normalized.timeSeriesSummary : [];
  const byFile = new Map(timeSummary.map((x) => [String(x.sourceFile || ''), x]));

  const runs = Array.isArray(multi.runs) ? multi.runs : [];
  const fileRows = [];
  const urlRows = [];

  for (const run of runs) {
    const files = Array.isArray(run.newFiles) ? run.newFiles : [];
    let dayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;
    let dayCount = 0;
    let weekCount = 0;
    let monthCount = 0;

    for (const f of files) {
      const name = String(f.name || '');
      const period = parsePeriodFromFileName(name);
      const series = byFile.get(name) || null;
      const total = toNumber(series?.total);
      const rowCount = toNumber(series?.rowCount);
      const range = String(series?.period || '');

      if (period === 'day') {
        dayTotal += total;
        dayCount += 1;
      } else if (period === 'week') {
        weekTotal += total;
        weekCount += 1;
      } else if (period === 'month') {
        monthTotal += total;
        monthCount += 1;
      }

      fileRows.push({
        path: run.path,
        fileName: name,
        period,
        fileSize: toNumber(f.size),
        rowCount,
        total,
        dataRange: range,
      });
    }

    urlRows.push({
      path: run.path,
      url: run.url,
      ok: run.ok ? 'Y' : 'N',
      fileCount: files.length,
      dayFileCount: dayCount,
      weekFileCount: weekCount,
      monthFileCount: monthCount,
      dayTotal,
      weekTotal,
      monthTotal,
      runAt: run.at,
    });
  }

  const summary = {
    generatedAt: nowIso(),
    blogId: multi.blogId || '',
    status: multi.status || '',
    totalTargets: Array.isArray(multi.targets) ? multi.targets.length : 0,
    completedRuns: runs.length,
    totalFiles: fileRows.length,
    totalDayFiles: fileRows.filter((x) => x.period === 'day').length,
    totalWeekFiles: fileRows.filter((x) => x.period === 'week').length,
    totalMonthFiles: fileRows.filter((x) => x.period === 'month').length,
    totalDayValue: fileRows.filter((x) => x.period === 'day').reduce((a, b) => a + b.total, 0),
    totalWeekValue: fileRows.filter((x) => x.period === 'week').reduce((a, b) => a + b.total, 0),
    totalMonthValue: fileRows.filter((x) => x.period === 'month').reduce((a, b) => a + b.total, 0),
  };

  await saveJson(OUT_JSON, { summary, urlRows, fileRows });

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(
    Object.entries(summary).map(([k, v]) => ({ 항목: k, 값: typeof v === 'number' ? v : String(v) }))
  );
  const wsUrl = XLSX.utils.json_to_sheet(
    urlRows.map((x) => ({
      수집URL경로: x.path,
      수집URL: x.url,
      성공: x.ok,
      생성파일수: x.fileCount,
      일간파일수: x.dayFileCount,
      주간파일수: x.weekFileCount,
      월간파일수: x.monthFileCount,
      일간합계: x.dayTotal,
      주간합계: x.weekTotal,
      월간합계: x.monthTotal,
      실행시각: x.runAt,
    }))
  );
  const wsFiles = XLSX.utils.json_to_sheet(
    fileRows.map((x) => ({
      수집URL경로: x.path,
      파일명: x.fileName,
      기간구분: x.period,
      파일크기: x.fileSize,
      시계열행수: x.rowCount,
      합계값: x.total,
      데이터기간: x.dataRange,
    }))
  );

  XLSX.utils.book_append_sheet(wb, wsSummary, '요약');
  XLSX.utils.book_append_sheet(wb, wsUrl, 'URL별');
  XLSX.utils.book_append_sheet(wb, wsFiles, '파일별');

  await mkdir(path.dirname(outXlsxAbs), { recursive: true });
  XLSX.writeFile(wb, outXlsxAbs);

  console.log(
    JSON.stringify(
      {
        outJson: outJsonAbs,
        outXlsx: outXlsxAbs,
        totalTargets: summary.totalTargets,
        completedRuns: summary.completedRuns,
        totalFiles: summary.totalFiles,
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
