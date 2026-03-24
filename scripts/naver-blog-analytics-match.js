import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const ANALYTICS_PATH =
  process.env.NAVER_BLOG_ANALYTICS_NORMALIZED_PATH || 'data/content/analysis/naver-analytics-normalized.json';
const UNIQUE_PATH = process.env.CONTENT_UNIQUE_POSTS_PATH || 'data/content/dedup/posts-unique.json';
const OUT_JSON = process.env.NAVER_BLOG_ANALYTICS_MATCH_OUT_JSON || 'output/naver-blog-analytics-match.json';
const OUT_XLSX = process.env.NAVER_BLOG_ANALYTICS_MATCH_OUT_XLSX || 'output/naver-blog-analytics-match.xlsx';

function toNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function normalizeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^m\./i, '').toLowerCase();
    const pathOnly = u.pathname.replace(/\/+$/, '').toLowerCase();
    const postParam = u.searchParams.get('logNo') || u.searchParams.get('Redirect');
    if (postParam) {
      return `${host}${pathOnly}?logNo=${postParam}`.toLowerCase();
    }
    return `${host}${pathOnly}`.toLowerCase();
  } catch {
    return s.replace(/^https?:\/\//i, '').replace(/^m\./i, '').replace(/\/+$/, '').toLowerCase();
  }
}

function jaccard(a, b) {
  const ta = new Set(
    String(a || '')
      .split(/[^0-9a-zA-Z가-힣]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2)
  );
  const tb = new Set(
    String(b || '')
      .split(/[^0-9a-zA-Z가-힣]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2)
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const uni = ta.size + tb.size - inter;
  return uni > 0 ? inter / uni : 0;
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function pickRepresentativeTitle(rawRows) {
  const titleKeys = ['제목', '글제목', '타이틀', 'title'];
  for (const row of rawRows || []) {
    const raw = row?.raw || {};
    const keys = Object.keys(raw);
    for (const key of keys) {
      const nk = normalizeText(key);
      if (!titleKeys.some((h) => nk.includes(normalizeText(h)))) continue;
      const value = String(raw[key] || '').trim();
      if (value) return value;
    }
  }
  return '';
}

async function main() {
  const analyticsAbs = path.resolve(ROOT, ANALYTICS_PATH);
  const uniqueAbs = path.resolve(ROOT, UNIQUE_PATH);
  const outJsonAbs = path.resolve(ROOT, OUT_JSON);
  const outXlsxAbs = path.resolve(ROOT, OUT_XLSX);

  const analytics = await loadJson(analyticsAbs);
  const unique = await loadJson(uniqueAbs);

  const allByUrl = Array.isArray(analytics?.allByUrl) ? analytics.allByUrl : [];
  const allByTitle = Array.isArray(analytics?.allByTitle) ? analytics.allByTitle : [];
  const uniquePosts = Array.isArray(unique?.uniquePosts) ? unique.uniquePosts : [];

  const uniqueByUrl = new Map();
  const uniqueByNormUrl = new Map();
  const uniquePool = [];

  for (const u of uniquePosts) {
    const keep = u?.keep || {};
    const url = String(u?.url || '').trim();
    const normUrl = normalizeUrl(url);
    const item = {
      url,
      normUrl,
      contentId: keep.contentId || '',
      postIndex: keep.postIndex || '',
      title: keep.title || '',
      publishedAt: keep.publishedAt || '',
    };
    if (url) uniqueByUrl.set(url, item);
    if (normUrl) uniqueByNormUrl.set(normUrl, item);
    uniquePool.push(item);
  }

  const matchedRows = [];
  const unmatchedRows = [];

  for (const row of allByUrl) {
    const url = String(row?.url || '').trim();
    const normUrl = normalizeUrl(url);
    let matchType = '';
    let confidence = 0;
    let matched = null;

    if (uniqueByUrl.has(url)) {
      matched = uniqueByUrl.get(url);
      matchType = 'url_exact';
      confidence = 1.0;
    } else if (normUrl && uniqueByNormUrl.has(normUrl)) {
      matched = uniqueByNormUrl.get(normUrl);
      matchType = 'url_normalized';
      confidence = 0.95;
    } else {
      const repTitle = pickRepresentativeTitle(row?.sources || []);
      if (repTitle) {
        let best = null;
        let bestScore = 0;
        for (const cand of uniquePool) {
          const score = jaccard(repTitle, cand.title);
          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }
        if (best && bestScore >= 0.55) {
          matched = best;
          matchType = 'title_similarity';
          confidence = Number(bestScore.toFixed(4));
        }
      }
    }

    const base = {
      url,
      normalizedUrl: normUrl,
      totalViews: toNumber(row?.totalViews),
      totalVisitors: toNumber(row?.totalVisitors),
      totalLikes: toNumber(row?.totalLikes),
      totalComments: toNumber(row?.totalComments),
      dataPoints: toNumber(row?.dataPoints),
      latestDate: row?.latestDate || '',
      matchType,
      matchConfidence: confidence,
      matchedContentId: matched?.contentId || '',
      matchedPostIndex: matched?.postIndex || '',
      matchedTitle: matched?.title || '',
      matchedPublishedAt: matched?.publishedAt || '',
    };

    if (matched) matchedRows.push(base);
    else unmatchedRows.push(base);
  }

  for (const row of allByTitle) {
    const title = String(row?.title || '').trim();
    if (!title) continue;
    let best = null;
    let bestScore = 0;
    for (const cand of uniquePool) {
      const score = jaccard(title, cand.title);
      if (score > bestScore) {
        best = cand;
        bestScore = score;
      }
    }

    const base = {
      url: '',
      normalizedUrl: '',
      totalViews: toNumber(row?.totalViews),
      totalVisitors: toNumber(row?.totalVisitors),
      totalLikes: toNumber(row?.totalLikes),
      totalComments: toNumber(row?.totalComments),
      dataPoints: toNumber(row?.dataPoints),
      latestDate: row?.latestDate || '',
      sourceTitle: title,
      matchType: '',
      matchConfidence: 0,
      matchedContentId: '',
      matchedPostIndex: '',
      matchedTitle: '',
      matchedPublishedAt: '',
    };

    if (best && bestScore >= 0.55) {
      base.matchType = 'title_similarity';
      base.matchConfidence = Number(bestScore.toFixed(4));
      base.matchedContentId = best.contentId || '';
      base.matchedPostIndex = best.postIndex || '';
      base.matchedTitle = best.title || '';
      base.matchedPublishedAt = best.publishedAt || '';
      matchedRows.push(base);
    } else {
      unmatchedRows.push(base);
    }
  }

  matchedRows.sort((a, b) => b.totalVisitors - a.totalVisitors || b.totalViews - a.totalViews);
  unmatchedRows.sort((a, b) => b.totalVisitors - a.totalVisitors || b.totalViews - a.totalViews);

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceAnalyticsFile: analyticsAbs,
    sourceUniqueFile: uniqueAbs,
    analyticsUrlCount: allByUrl.length,
    analyticsTitleCount: allByTitle.length,
    analyticsCandidateCount: allByUrl.length + allByTitle.length,
    uniquePostCount: uniquePosts.length,
    matchedCount: matchedRows.length,
    unmatchedCount: unmatchedRows.length,
    matchRate: allByUrl.length + allByTitle.length > 0 ? Number((matchedRows.length / (allByUrl.length + allByTitle.length)).toFixed(4)) : 0,
    byType: {
      url_exact: matchedRows.filter((x) => x.matchType === 'url_exact').length,
      url_normalized: matchedRows.filter((x) => x.matchType === 'url_normalized').length,
      title_similarity: matchedRows.filter((x) => x.matchType === 'title_similarity').length,
    },
  };

  await saveJson(outJsonAbs, { summary, matchedRows, unmatchedRows });

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet([
    { 항목: '생성시각', 값: summary.generatedAt },
    { 항목: 'analytics URL 수', 값: summary.analyticsUrlCount },
    { 항목: 'unique post 수', 값: summary.uniquePostCount },
    { 항목: 'analytics 제목 수', 값: summary.analyticsTitleCount },
    { 항목: '매칭 건수', 값: summary.matchedCount },
    { 항목: '미매칭 건수', 값: summary.unmatchedCount },
    { 항목: '매칭률', 값: summary.matchRate },
    { 항목: 'URL 정확매칭', 값: summary.byType.url_exact },
    { 항목: 'URL 정규화매칭', 값: summary.byType.url_normalized },
    { 항목: '제목유사매칭', 값: summary.byType.title_similarity },
  ]);

  const wsMatched = XLSX.utils.json_to_sheet(
    matchedRows.map((r) => ({
      URL: r.url,
      원본제목: r.sourceTitle || '',
      매칭유형: r.matchType,
      신뢰도: r.matchConfidence,
      contentId: r.matchedContentId,
      postIndex: r.matchedPostIndex,
      제목: r.matchedTitle,
      발행시각: r.matchedPublishedAt,
      방문자합계: r.totalVisitors,
      조회합계: r.totalViews,
      공감합계: r.totalLikes,
      댓글합계: r.totalComments,
      데이터포인트: r.dataPoints,
      최신일자: r.latestDate,
    }))
  );

  const wsUnmatched = XLSX.utils.json_to_sheet(
    unmatchedRows.map((r) => ({
      URL: r.url,
      normalizedUrl: r.normalizedUrl,
      방문자합계: r.totalVisitors,
      조회합계: r.totalViews,
      공감합계: r.totalLikes,
      댓글합계: r.totalComments,
      데이터포인트: r.dataPoints,
      최신일자: r.latestDate,
    }))
  );

  XLSX.utils.book_append_sheet(wb, wsSummary, '요약');
  XLSX.utils.book_append_sheet(wb, wsMatched, '매칭결과');
  XLSX.utils.book_append_sheet(wb, wsUnmatched, '미매칭');
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
