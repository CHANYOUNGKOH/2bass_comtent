import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import XLSX from 'xlsx';

const ROOT = process.cwd();

const MATCH_JSON = process.env.NAVER_BLOG_ANALYTICS_MATCH_JSON || 'output/naver-blog-analytics-match.json';
const SUMMARY_JSON = process.env.NAVER_BLOG_ANALYTICS_SUMMARY_JSON || 'output/naver-blog-analytics-summary.json';
const CAPABILITY_JSON =
  process.env.NAVER_BLOG_ANALYTICS_CAPABILITY_JSON || 'output/naver-blog-analytics-capability.json';
const ANALYTICS_DIR = process.env.NAVER_BLOG_ANALYTICS_DOWNLOAD_DIR || 'output/naver-blog-analytics';

const OUT_JSON = process.env.NAVER_BLOG_ANALYTICS_MASTER_JSON || 'output/naver-blog-analytics-master-report.json';
const OUT_XLSX = process.env.NAVER_BLOG_ANALYTICS_MASTER_XLSX || 'output/naver-blog-analytics-master-report.xlsx';

function toNum(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function readAoa(absPath) {
  const wb = XLSX.readFile(absPath, { raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function parseFlowRows(aoa) {
  const out = [];
  for (const row of aoa) {
    const key = String(row?.[0] || '').trim();
    if (!key) continue;
    const isDay = /^\d{4}-\d{2}-\d{2}$/.test(key);
    const isRange = /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(key);
    if (!isDay && !isRange) continue;
    out.push({
      period: key,
      total: toNum(row[2]),
      neighbor: toNum(row[3]),
      mutual: toNum(row[4]),
      other: toNum(row[5]),
    });
  }
  return out;
}

function sumFlow(rows) {
  const total = rows.reduce((a, b) => a + b.total, 0);
  const neighbor = rows.reduce((a, b) => a + b.neighbor, 0);
  const mutual = rows.reduce((a, b) => a + b.mutual, 0);
  const other = rows.reduce((a, b) => a + b.other, 0);
  return {
    rowCount: rows.length,
    total,
    neighbor,
    mutual,
    other,
    neighborPct: total ? Number(((neighbor / total) * 100).toFixed(2)) : 0,
    mutualPct: total ? Number(((mutual / total) * 100).toFixed(2)) : 0,
    otherPct: total ? Number(((other / total) * 100).toFixed(2)) : 0,
  };
}

function parseRankRows(aoa) {
  const out = [];
  for (const row of aoa) {
    const rank = String(row?.[0] || '').trim();
    if (!/^\d+$/.test(rank)) continue;
    const title = String(row?.[1] || '').trim();
    if (!title) continue;
    out.push({
      rank: toNum(rank),
      title,
      views: toNum(row?.[2]),
      date: String(row?.[3] || '').trim(),
    });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

function keywordMapFromTitles(titles) {
  const stop = new Set([
    '브레이크',
    '튜닝',
    '전문점',
    '파주',
    '일산',
    '서울',
    '작업',
    '교체',
    '세팅',
    '셋팅',
    '커스텀',
    '순정',
    '리어',
    '프론트',
    '장착',
    '투베이스',
    '2bass',
    '그리고',
    '이야기',
    '에서',
    '으로',
    '용',
    '및',
    'mm',
  ]);

  const map = new Map();
  for (const t of titles) {
    for (const tk of tokenize(t)) {
      if (tk.length < 2) continue;
      if (stop.has(tk)) continue;
      map.set(tk, (map.get(tk) || 0) + 1);
    }
  }
  return map;
}

function scoreRow(r) {
  const views = toNum(r.totalViews);
  const likes = toNum(r.totalLikes);
  const comments = toNum(r.totalComments);
  const confidence = toNum(r.matchConfidence);
  const text = String(r.sourceTitle || r.matchedTitle || '').toLowerCase();

  let localBoost = 0;
  if (text.includes('파주')) localBoost += 8;
  if (text.includes('일산')) localBoost += 8;
  if (text.includes('서울')) localBoost += 3;
  if (text.includes('브레이크')) localBoost += 5;
  if (text.includes('튜닝')) localBoost += 4;
  if (text.includes('전문')) localBoost += 3;

  return views * 1 + likes * 4 + comments * 3 + confidence * 10 + localBoost;
}

function suggestTitleActions(title) {
  const t = String(title || '');
  const out = [];
  if (!/파주|일산/.test(t)) out.push('지역 키워드(파주/일산) 보강');
  if (!/브레이크|제동/.test(t)) out.push('핵심 서비스(브레이크/제동) 명시');
  if (!/\b(4p|6p|2p|380mm|355mm|330mm)\b/i.test(t)) out.push('스펙 키워드(4P/6P/mm) 추가');
  if (!/후기|사례|전후|비교/.test(t)) out.push('신뢰 요소(사례/전후/비교) 추가');
  return out.join(' | ');
}

async function main() {
  const matchAbs = path.resolve(ROOT, MATCH_JSON);
  const summaryAbs = path.resolve(ROOT, SUMMARY_JSON);
  const capAbs = path.resolve(ROOT, CAPABILITY_JSON);
  const analyticsDirAbs = path.resolve(ROOT, ANALYTICS_DIR);
  const outJsonAbs = path.resolve(ROOT, OUT_JSON);
  const outXlsxAbs = path.resolve(ROOT, OUT_XLSX);

  const match = JSON.parse(await readFile(matchAbs, 'utf8'));
  const summary = JSON.parse(await readFile(summaryAbs, 'utf8'));
  const capability = JSON.parse(await readFile(capAbs, 'utf8'));

  const flowDay = sumFlow(parseFlowRows(readAoa(path.join(analyticsDirAbs, 'analytics-response-day-1-14.xlsx'))));
  const flowWeek = sumFlow(parseFlowRows(readAoa(path.join(analyticsDirAbs, 'analytics-response-week-1-10.xlsx'))));
  const flowMonth = sumFlow(parseFlowRows(readAoa(path.join(analyticsDirAbs, 'analytics-response-month-1-10.xlsx'))));

  const dayRank = parseRankRows(readAoa(path.join(analyticsDirAbs, 'analytics-response-day-1-38.xlsx')));
  const weekRank = parseRankRows(readAoa(path.join(analyticsDirAbs, 'analytics-response-week-1-34.xlsx')));
  const monthRank = parseRankRows(readAoa(path.join(analyticsDirAbs, 'analytics-response-month-1-34.xlsx')));

  const matchedRows = Array.isArray(match.matchedRows) ? match.matchedRows : [];
  const unmatchedRows = Array.isArray(match.unmatchedRows) ? match.unmatchedRows : [];

  const allTitles = [
    ...matchedRows.map((x) => String(x.sourceTitle || x.matchedTitle || '').trim()),
    ...unmatchedRows.map((x) => String(x.sourceTitle || x.matchedTitle || '').trim()),
  ].filter(Boolean);

  const monthTopTitles = monthRank.slice(0, 100).map((x) => x.title);

  const fullKeywordMap = keywordMapFromTitles(allTitles);
  const fullKeywords = [...fullKeywordMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([keyword, count]) => ({ keyword, count }));

  const top30Keywords = [...keywordMapFromTitles(monthTopTitles).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([keyword, count]) => ({ keyword, count }));

  const rewritePriorityAll = matchedRows
    .map((r) => ({
      priorityScore: Number(scoreRow(r).toFixed(2)),
      title: String(r.sourceTitle || r.matchedTitle || '').trim(),
      totalViews: toNum(r.totalViews),
      totalLikes: toNum(r.totalLikes),
      totalComments: toNum(r.totalComments),
      matchConfidence: toNum(r.matchConfidence),
      suggestedTitleActions: suggestTitleActions(String(r.sourceTitle || r.matchedTitle || '')),
      ctaSuggestion: '예약문의(전화/톡) + 위치(파주/일산) + 작업시간/비용범위 표기',
    }))
    .filter((x) => x.title)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const report = {
    generatedAt: new Date().toISOString(),
    sources: {
      matchJson: matchAbs,
      summaryJson: summaryAbs,
      capabilityJson: capAbs,
      analyticsDir: analyticsDirAbs,
    },
    keyNumbers: {
      analyticsCompleted: summary?.summary?.status || '',
      matchRate: match?.summary?.matchRate || 0,
      matchedCount: match?.summary?.matchedCount || 0,
      unmatchedCount: match?.summary?.unmatchedCount || 0,
      urlCapableSheets: capability?.summary?.urlCapableSheets || 0,
      titleCapableSheets: capability?.summary?.titleCapableSheets || 0,
      dateCapableSheets: capability?.summary?.dateCapableSheets || 0,
      fullKeywordCount: fullKeywords.length,
      rewritePriorityCount: rewritePriorityAll.length,
    },
    inflow: {
      day90: flowDay,
      week15: flowWeek,
      month26: flowMonth,
    },
    rank: {
      dayTop10: dayRank.slice(0, 10),
      weekTop10: weekRank.slice(0, 10),
      monthTop20: monthRank.slice(0, 20),
    },
    keywordTop30: top30Keywords,
    keywordAll: fullKeywords,
    rewritePriorityAll,
  };

  await mkdir(path.dirname(outJsonAbs), { recursive: true });
  await writeFile(outJsonAbs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet([
    { 항목: '생성시각', 값: report.generatedAt },
    { 항목: '통계수집 상태', 값: report.keyNumbers.analyticsCompleted },
    { 항목: '매칭률', 값: report.keyNumbers.matchRate },
    { 항목: '매칭 건수', 값: report.keyNumbers.matchedCount },
    { 항목: '미매칭 건수', 값: report.keyNumbers.unmatchedCount },
    { 항목: 'URL 컬럼 시트 수', 값: report.keyNumbers.urlCapableSheets },
    { 항목: '제목 컬럼 시트 수', 값: report.keyNumbers.titleCapableSheets },
    { 항목: '날짜 컬럼 시트 수', 값: report.keyNumbers.dateCapableSheets },
    { 항목: '전체 키워드 수', 값: report.keyNumbers.fullKeywordCount },
    { 항목: '재작성 우선순위 건수', 값: report.keyNumbers.rewritePriorityCount },
  ]);

  const wsInflow = XLSX.utils.json_to_sheet([
    {
      구간: '최근90일',
      전체: flowDay.total,
      피이웃: flowDay.neighbor,
      서로이웃: flowDay.mutual,
      기타: flowDay.other,
      '피이웃%': flowDay.neighborPct,
      '서로이웃%': flowDay.mutualPct,
      '기타%': flowDay.otherPct,
    },
    {
      구간: '최근15주',
      전체: flowWeek.total,
      피이웃: flowWeek.neighbor,
      서로이웃: flowWeek.mutual,
      기타: flowWeek.other,
      '피이웃%': flowWeek.neighborPct,
      '서로이웃%': flowWeek.mutualPct,
      '기타%': flowWeek.otherPct,
    },
    {
      구간: '최근26개월',
      전체: flowMonth.total,
      피이웃: flowMonth.neighbor,
      서로이웃: flowMonth.mutual,
      기타: flowMonth.other,
      '피이웃%': flowMonth.neighborPct,
      '서로이웃%': flowMonth.mutualPct,
      '기타%': flowMonth.otherPct,
    },
  ]);

  const wsMonthTop = XLSX.utils.json_to_sheet(
    report.rank.monthTop20.map((r) => ({
      순위: r.rank,
      제목: r.title,
      조회수: r.views,
      작성일: r.date,
    }))
  );

  const wsKeywordsTop = XLSX.utils.json_to_sheet(
    report.keywordTop30.map((k, idx) => ({
      순위: idx + 1,
      키워드: k.keyword,
      빈도: k.count,
    }))
  );

  const wsKeywordsAll = XLSX.utils.json_to_sheet(
    report.keywordAll.map((k, idx) => ({
      순위: idx + 1,
      키워드: k.keyword,
      빈도: k.count,
    }))
  );

  const wsRewriteAll = XLSX.utils.json_to_sheet(
    report.rewritePriorityAll.map((r, idx) => ({
      우선순위: idx + 1,
      점수: r.priorityScore,
      제목: r.title,
      조회수합: r.totalViews,
      공감합: r.totalLikes,
      댓글합: r.totalComments,
      매칭신뢰도: r.matchConfidence,
      제목개선포인트: r.suggestedTitleActions,
      전환CTA권장: r.ctaSuggestion,
    }))
  );

  XLSX.utils.book_append_sheet(wb, wsSummary, '요약');
  XLSX.utils.book_append_sheet(wb, wsInflow, '유입요약');
  XLSX.utils.book_append_sheet(wb, wsMonthTop, '월간상위글');
  XLSX.utils.book_append_sheet(wb, wsKeywordsTop, '키워드TOP30');
  XLSX.utils.book_append_sheet(wb, wsKeywordsAll, '전체키워드');
  XLSX.utils.book_append_sheet(wb, wsRewriteAll, '재작성우선순위전체');

  await mkdir(path.dirname(outXlsxAbs), { recursive: true });
  XLSX.writeFile(wb, outXlsxAbs);

  console.log(
    JSON.stringify(
      {
        outJson: outJsonAbs,
        outXlsx: outXlsxAbs,
        fullKeywordCount: report.keyNumbers.fullKeywordCount,
        rewritePriorityCount: report.keyNumbers.rewritePriorityCount,
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
