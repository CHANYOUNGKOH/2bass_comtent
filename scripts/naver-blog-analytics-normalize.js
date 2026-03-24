import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const IN_DIR = process.env.NAVER_BLOG_ANALYTICS_DOWNLOAD_DIR || 'output/naver-blog-analytics';
const UNIQUE_PATH = process.env.CONTENT_UNIQUE_POSTS_PATH || 'data/content/dedup/posts-unique.json';
const OUT_PATH = process.env.NAVER_BLOG_ANALYTICS_NORMALIZED_PATH || 'data/content/analysis/naver-analytics-normalized.json';

const URL_COL_HINTS = ['url', '링크', '주소', 'post', '게시글'];
const TITLE_COL_HINTS = ['제목', '타이틀', 'title', '글제목'];
const VIEW_HINTS = ['조회', 'view', '노출'];
const COMMENT_HINTS = ['댓글', 'comment'];
const LIKE_HINTS = ['공감', '좋아요', 'like'];
const VISITOR_HINTS = ['방문', '유입', 'visitor'];
const DATE_HINTS = ['날짜', '일자', 'date'];

function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v || '').replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function isUrl(v) {
  const s = String(v || '').trim();
  return /^https?:\/\//i.test(s) && /blog\.naver\.com/i.test(s);
}

function pickColumn(headers, hints) {
  const normalized = headers.map((h) => ({ raw: h, key: normalizeKey(h) }));
  for (const hint of hints) {
    const h = normalizeKey(hint);
    const found = normalized.find((x) => x.key.includes(h));
    if (found) return found.raw;
  }
  return '';
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseUrlRowSheets(filePath) {
  const wb = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = parseRowsWithDetectedHeader(ws);
    for (const r of rows) out.push({ sheet: name, row: r });
  }
  return out;
}

function scoreHeaderCells(cells) {
  if (!Array.isArray(cells)) return -1;
  const nonEmpty = cells.map((x) => String(x || '').trim()).filter(Boolean);
  if (nonEmpty.length < 2) return -1;
  const hints = [...URL_COL_HINTS, ...TITLE_COL_HINTS, ...DATE_HINTS, ...VIEW_HINTS, ...COMMENT_HINTS, ...LIKE_HINTS, ...VISITOR_HINTS];
  let score = 0;
  for (const c of nonEmpty) {
    const nk = normalizeKey(c);
    if (hints.some((h) => nk.includes(normalizeKey(h)))) score += 4;
    else score += 1;
  }
  return score;
}

function parseRowsWithDetectedHeader(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!Array.isArray(aoa) || aoa.length === 0) return [];
  const maxScan = Math.min(40, aoa.length);
  let headerIdx = -1;
  let best = -1;
  for (let i = 0; i < maxScan; i += 1) {
    const s = scoreHeaderCells(aoa[i]);
    if (s > best) {
      best = s;
      headerIdx = i;
    }
  }
  if (headerIdx < 0) return [];

  const headers = (aoa[headerIdx] || []).map((x) => String(x || '').trim());
  const rows = [];
  for (let r = headerIdx + 1; r < aoa.length; r += 1) {
    const row = aoa[r] || [];
    const obj = {};
    let nonEmpty = 0;
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c] || `col_${c}`;
      const val = row[c] ?? '';
      if (String(val).trim()) nonEmpty += 1;
      obj[key] = val;
    }
    if (nonEmpty === 0) continue;
    rows.push(obj);
  }
  return rows;
}

function parseTimeseriesSheet(filePath, sheetName, ws) {
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!Array.isArray(arr) || arr.length < 8) return null;

  const findMeta = (label) => {
    const row = arr.find((r) => String(r?.[0] || '').trim() === label);
    return row ? String(row[1] || '').trim() : '';
  };

  const metricName = findMeta('데이터명') || sheetName;
  const unit = findMeta('데이터 단위') || '';
  const period = findMeta('데이터 기간') || '';
  const downloadedAt = findMeta('다운로드 날짜') || '';

  const headerIndex = arr.findIndex((r) => {
    const first = String(r?.[0] || '').trim();
    return first === '날짜' || first === '기간';
  });
  if (headerIndex < 0) return null;

  const header = arr[headerIndex].map((x) => String(x || '').trim());
  const rows = [];
  for (let i = headerIndex + 1; i < arr.length; i += 1) {
    const row = arr[i];
    const date = String(row?.[0] || '').trim();
    const isDaily = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const isRange = /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(date);
    if (!date || !(isDaily || isRange)) continue;
    const obj = {};
    for (let c = 0; c < header.length; c += 1) {
      const key = header[c] || `col_${c}`;
      obj[key] = c <= 1 ? String(row[c] || '').trim() : toNumber(row[c]);
    }
    rows.push(obj);
  }

  return {
    sourceFile: path.basename(filePath),
    sourceSheet: sheetName,
    metricName,
    unit,
    period,
    downloadedAt,
    header,
    rows,
  };
}

async function main() {
  const inDirAbs = path.resolve(ROOT, IN_DIR);
  const uniqueAbs = path.resolve(ROOT, UNIQUE_PATH);
  const outAbs = path.resolve(ROOT, OUT_PATH);

  const files = (await readdir(inDirAbs).catch(() => []))
    .filter((f) => /\.(csv|xlsx|xls)$/i.test(f))
    .map((f) => path.join(inDirAbs, f));

  const unique = await loadJson(uniqueAbs).catch(() => ({ uniquePosts: [] }));
  const uniquePosts = Array.isArray(unique.uniquePosts) ? unique.uniquePosts : [];
  const uniqueByUrl = new Map();
  for (const u of uniquePosts) {
    const url = String(u?.url || '').trim();
    if (url) uniqueByUrl.set(url, u);
  }

  const normalizedRows = [];
  const normalizedTitleRows = [];
  const timeSeries = [];

  for (const filePath of files) {
    let wb = null;
    try {
      wb = XLSX.readFile(filePath, { raw: false, cellDates: false });
    } catch {
      wb = null;
    }

    if (wb) {
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const series = parseTimeseriesSheet(filePath, sheetName, ws);
        if (series && series.rows.length > 0) timeSeries.push(series);
      }
    }

    let rows = [];
    try {
      rows = parseUrlRowSheets(filePath);
    } catch {
      rows = [];
    }

    for (const item of rows) {
      const r = item.row;
      const headers = Object.keys(r);
      if (headers.length === 0) continue;

      let urlCol = pickColumn(headers, URL_COL_HINTS);
      if (!urlCol) {
        urlCol = headers.find((h) => isUrl(r[h])) || '';
      }
      const viewCol = pickColumn(headers, VIEW_HINTS);
      const commentCol = pickColumn(headers, COMMENT_HINTS);
      const likeCol = pickColumn(headers, LIKE_HINTS);
      const visitorCol = pickColumn(headers, VISITOR_HINTS);
      const dateCol = pickColumn(headers, DATE_HINTS);
      const titleCol = pickColumn(headers, TITLE_COL_HINTS);

      const url = urlCol ? String(r[urlCol] || '').trim() : '';
      const title = titleCol ? String(r[titleCol] || '').trim() : '';

      if (!urlCol && !titleCol) continue;

      if (url && isUrl(url)) {
        normalizedRows.push({
          sourceFile: path.basename(filePath),
          sourceSheet: item.sheet,
          url,
          title,
          date: dateCol ? String(r[dateCol] || '').trim() : '',
          views: viewCol ? toNumber(r[viewCol]) : 0,
          comments: commentCol ? toNumber(r[commentCol]) : 0,
          likes: likeCol ? toNumber(r[likeCol]) : 0,
          visitors: visitorCol ? toNumber(r[visitorCol]) : 0,
          raw: r,
        });
      } else if (title) {
        normalizedTitleRows.push({
          sourceFile: path.basename(filePath),
          sourceSheet: item.sheet,
          title,
          date: dateCol ? String(r[dateCol] || '').trim() : '',
          views: viewCol ? toNumber(r[viewCol]) : 0,
          comments: commentCol ? toNumber(r[commentCol]) : 0,
          likes: likeCol ? toNumber(r[likeCol]) : 0,
          visitors: visitorCol ? toNumber(r[visitorCol]) : 0,
          raw: r,
        });
      }
    }
  }

  const byUrl = new Map();
  for (const row of normalizedRows) {
    const arr = byUrl.get(row.url) || [];
    arr.push(row);
    byUrl.set(row.url, arr);
  }

  const merged = [];
  for (const [url, arr] of byUrl.entries()) {
    const uniqueRef = uniqueByUrl.get(url) || null;
    merged.push({
      url,
      dataPoints: arr.length,
      totalViews: arr.reduce((a, b) => a + Number(b.views || 0), 0),
      totalComments: arr.reduce((a, b) => a + Number(b.comments || 0), 0),
      totalLikes: arr.reduce((a, b) => a + Number(b.likes || 0), 0),
      totalVisitors: arr.reduce((a, b) => a + Number(b.visitors || 0), 0),
      latestDate: arr.map((x) => String(x.date || '')).sort().slice(-1)[0] || '',
      matchedUniquePost: uniqueRef
        ? {
            contentId: uniqueRef.keep?.contentId || '',
            postIndex: uniqueRef.keep?.postIndex || '',
            title: uniqueRef.keep?.title || '',
          }
        : null,
      sources: arr.map((x) => ({ file: x.sourceFile, sheet: x.sourceSheet, date: x.date })),
    });
  }

  merged.sort((a, b) => b.totalVisitors - a.totalVisitors || b.totalViews - a.totalViews);

  const byTitle = new Map();
  for (const row of normalizedTitleRows) {
    const key = normalizeKey(row.title);
    if (!key) continue;
    const arr = byTitle.get(key) || [];
    arr.push(row);
    byTitle.set(key, arr);
  }

  const mergedByTitle = [];
  for (const [titleKey, arr] of byTitle.entries()) {
    const firstTitle = String(arr[0]?.title || '').trim();
    mergedByTitle.push({
      titleKey,
      title: firstTitle,
      dataPoints: arr.length,
      totalViews: arr.reduce((a, b) => a + Number(b.views || 0), 0),
      totalComments: arr.reduce((a, b) => a + Number(b.comments || 0), 0),
      totalLikes: arr.reduce((a, b) => a + Number(b.likes || 0), 0),
      totalVisitors: arr.reduce((a, b) => a + Number(b.visitors || 0), 0),
      latestDate: arr.map((x) => String(x.date || '')).sort().slice(-1)[0] || '',
      sources: arr.map((x) => ({ file: x.sourceFile, sheet: x.sourceSheet, date: x.date })),
    });
  }
  mergedByTitle.sort((a, b) => b.totalVisitors - a.totalVisitors || b.totalViews - a.totalViews);

  const seriesSummary = timeSeries.map((s) => {
    const totalCol = s.header.find((h) => normalizeKey(h) === normalizeKey('전체')) || s.header[2] || '';
    const total = totalCol ? s.rows.reduce((acc, r) => acc + toNumber(r[totalCol]), 0) : 0;
    return {
      sourceFile: s.sourceFile,
      sourceSheet: s.sourceSheet,
      metricName: s.metricName,
      unit: s.unit,
      period: s.period,
      rowCount: s.rows.length,
      total,
      totalColumn: totalCol,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    sourceDir: inDirAbs,
    sourceFileCount: files.length,
    parsedRowCount: normalizedRows.length,
    parsedTitleRowCount: normalizedTitleRows.length,
    urlCount: merged.length,
    titleCount: mergedByTitle.length,
    matchedUniqueCount: merged.filter((x) => x.matchedUniquePost).length,
    unmatchedCount: merged.filter((x) => !x.matchedUniquePost).length,
    topByVisitors: merged.slice(0, 50),
    allByUrl: merged,
    topByTitle: mergedByTitle.slice(0, 100),
    allByTitle: mergedByTitle,
    timeSeriesCount: timeSeries.length,
    timeSeriesSummary: seriesSummary,
    timeSeries,
  };

  await saveJson(outAbs, out);
  console.log(
    JSON.stringify(
      {
        outFile: outAbs,
        sourceFileCount: out.sourceFileCount,
        parsedRowCount: out.parsedRowCount,
        parsedTitleRowCount: out.parsedTitleRowCount,
        urlCount: out.urlCount,
        titleCount: out.titleCount,
        matchedUniqueCount: out.matchedUniqueCount,
        timeSeriesCount: out.timeSeriesCount,
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
