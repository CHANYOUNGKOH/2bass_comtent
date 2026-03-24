import { readdir, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const IN_DIR = process.env.NAVER_BLOG_ANALYTICS_DOWNLOAD_DIR || 'output/naver-blog-analytics';
const OUT_JSON = process.env.NAVER_BLOG_ANALYTICS_CAP_JSON || 'output/naver-blog-analytics-capability.json';
const OUT_XLSX = process.env.NAVER_BLOG_ANALYTICS_CAP_XLSX || 'output/naver-blog-analytics-capability.xlsx';

const URL_HINTS = ['url', '링크', '주소', '게시글', 'post'];
const TITLE_HINTS = ['제목', '타이틀', 'title', '글'];
const DATE_HINTS = ['날짜', '기간', '일자', 'date'];
const METRIC_HINTS = ['조회', '공감', '댓글', '방문', '재생', '순위'];

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

function hasHint(key, hints) {
  const k = norm(key);
  return hints.some((h) => k.includes(norm(h)));
}

function sheetToAoa(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function pickHeaderRow(aoa) {
  const maxScan = Math.min(40, aoa.length);
  let best = { idx: -1, score: -1, headers: [] };
  for (let i = 0; i < maxScan; i += 1) {
    const row = Array.isArray(aoa[i]) ? aoa[i].map((x) => String(x || '').trim()) : [];
    const nonEmpty = row.filter((x) => x).length;
    if (nonEmpty < 2) continue;
    const hintScore = row.reduce((acc, c) => {
      const k = norm(c);
      if (!k) return acc;
      if (hasHint(k, URL_HINTS) || hasHint(k, TITLE_HINTS) || hasHint(k, DATE_HINTS) || hasHint(k, METRIC_HINTS)) {
        return acc + 3;
      }
      return acc + 1;
    }, 0);
    if (hintScore > best.score) {
      best = { idx: i, score: hintScore, headers: row };
    }
  }
  return best;
}

async function main() {
  const inDirAbs = path.resolve(ROOT, IN_DIR);
  const outJsonAbs = path.resolve(ROOT, OUT_JSON);
  const outXlsxAbs = path.resolve(ROOT, OUT_XLSX);
  await mkdir(path.dirname(outJsonAbs), { recursive: true });

  const files = (await readdir(inDirAbs).catch(() => [])).filter((f) => /\.xlsx$/i.test(f));
  const rows = [];

  for (const f of files) {
    const full = path.join(inDirAbs, f);
    let wb = null;
    try {
      wb = XLSX.readFile(full, { raw: false, cellDates: false });
    } catch {
      continue;
    }

    for (const sheet of wb.SheetNames) {
      const ws = wb.Sheets[sheet];
      const aoa = sheetToAoa(ws);
      const headerPick = pickHeaderRow(aoa);
      const headers = headerPick.headers;
      const dataRowCount = headerPick.idx >= 0 ? Math.max(0, aoa.length - (headerPick.idx + 1)) : aoa.length;
      const urlCols = headers.filter((h) => hasHint(h, URL_HINTS));
      const titleCols = headers.filter((h) => hasHint(h, TITLE_HINTS));
      const dateCols = headers.filter((h) => hasHint(h, DATE_HINTS));
      const metricCols = headers.filter((h) => hasHint(h, METRIC_HINTS));

      rows.push({
        file: f,
        sheet,
        rowCount: dataRowCount,
        headerCount: headers.length,
        headerRowIndex: headerPick.idx,
        hasUrlColumn: urlCols.length > 0,
        hasTitleColumn: titleCols.length > 0,
        hasDateColumn: dateCols.length > 0,
        hasMetricColumn: metricCols.length > 0,
        urlColumns: urlCols.join(', '),
        titleColumns: titleCols.join(', '),
        dateColumns: dateCols.join(', '),
        metricColumns: metricCols.join(', '),
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    sheetCount: rows.length,
    urlCapableSheets: rows.filter((r) => r.hasUrlColumn).length,
    titleCapableSheets: rows.filter((r) => r.hasTitleColumn).length,
    dateCapableSheets: rows.filter((r) => r.hasDateColumn).length,
    metricCapableSheets: rows.filter((r) => r.hasMetricColumn).length,
  };

  await writeFile(outJsonAbs, `${JSON.stringify({ summary, rows }, null, 2)}\n`, 'utf8');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { 항목: '생성시각', 값: summary.generatedAt },
      { 항목: '파일수', 값: summary.fileCount },
      { 항목: '시트수', 값: summary.sheetCount },
      { 항목: 'URL컬럼 시트수', 값: summary.urlCapableSheets },
      { 항목: '제목컬럼 시트수', 값: summary.titleCapableSheets },
      { 항목: '날짜컬럼 시트수', 값: summary.dateCapableSheets },
      { 항목: '지표컬럼 시트수', 값: summary.metricCapableSheets },
    ]),
    '요약'
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '시트진단');
  XLSX.writeFile(wb, outXlsxAbs);

  console.log(
    JSON.stringify(
      {
        outJson: outJsonAbs,
        outXlsx: outXlsxAbs,
        ...summary,
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
