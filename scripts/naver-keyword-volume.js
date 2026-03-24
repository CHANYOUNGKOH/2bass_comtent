/**
 * naver-keyword-volume.js
 * 네이버 검색광고 API + 데이터랩 트렌드 API
 *
 * 환경변수:
 *   NAVER_AD_CUSTOMER_ID, NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY  (검색광고)
 *   NAVER_DATALAB_CLIENT_ID, NAVER_DATALAB_CLIENT_SECRET          (데이터랩, 선택)
 *
 * 사용법:
 *   node scripts/naver-keyword-volume.js "파주캘리퍼,일산디스크"
 *   node scripts/naver-keyword-volume.js --scan   (전체 스캔 + 트렌드)
 */
import crypto from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;
const API_KEY     = process.env.NAVER_AD_API_KEY;
const SECRET_KEY  = process.env.NAVER_AD_SECRET_KEY;

if (!CUSTOMER_ID || !API_KEY || !SECRET_KEY) {
  console.error('환경변수 필요: NAVER_AD_CUSTOMER_ID, NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY');
  process.exit(1);
}

function generateSignature(timestamp, method, uri) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', SECRET_KEY).update(message).digest('base64');
}

async function getKeywordVolume(keywords) {
  const timestamp = String(Date.now());
  const method = 'GET';
  const uri = '/keywordstool';
  const signature = generateSignature(timestamp, method, uri);

  const params = new URLSearchParams({
    hintKeywords: keywords.join(','),
    showDetail: '1',
  });

  const url = `https://api.searchad.naver.com${uri}?${params}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': API_KEY,
      'X-Customer': CUSTOMER_ID,
      'X-Signature': signature,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// 지역+부품 조합 (주요 지역만)
const REGIONS = ['일산', '파주', '고양'];
const PARTS_LOCAL = ['브레이크', '브레이크튜닝', '캘리퍼', '브렘보'];

async function scanAll() {
  const allKeywords = [];
  // 지역 조합 (12개 — 핵심만)
  for (const r of REGIONS) {
    for (const p of PARTS_LOCAL) {
      allKeywords.push(`${r}${p}`);
    }
  }

  // ── 단독 부품 키워드 (핵심 트래픽) ──
  allKeywords.push(
    '브레이크패드', '브레이크패드교체', '브레이크디스크', '브레이크디스크교체',
    '브레이크튜닝', '브렘보', '브렘보캘리퍼', '브렘보브레이크',
    '캘리퍼', '캘리퍼교체', '디스크연마', '브레이크오일교환',
    '브레이크액교환', '브레이크호스', '브레이크라인',
  );

  // ── 증상 키워드 (정보형 — 블로그 유입 핵심) ──
  allKeywords.push(
    '브레이크떨림', '브레이크소음', '브레이크밀림', '브레이크쏠림',
    '브레이크끼익', '브레이크경고등', '브레이크페이드',
    '핸들떨림', '고속떨림', '하체떨림', '타이어떨림', '휠떨림',
    '제동불량', '제동거리', '브레이크페달밀림',
    '디스크편마모', '패드마모', '브레이크잠김',
  );

  // ── 차종+브레이크 조합 (거래형) ──
  allKeywords.push(
    // 국산
    '그랜저브레이크', '소나타브레이크', 'K5브레이크', 'K7브레이크', 'K8브레이크',
    '아반떼브레이크', '투싼브레이크', '싼타페브레이크', '쏘렌토브레이크',
    '스포티지브레이크', '팰리세이드브레이크', '카니발브레이크',
    '스타리아브레이크', '제네시스브레이크',
    // 수입
    'BMW브레이크', '벤츠브레이크', '아우디브레이크', '폭스바겐브레이크',
    '볼보브레이크', '렉서스브레이크', '미니브레이크',
  );

  // ── 작업 관련 검색 ──
  allKeywords.push(
    '브레이크튜닝샵', '브레이크전문점', '브레이크교체비용',
    '브렘보장착', '빅브레이크킷', '순정브레이크업그레이드',
  );

  console.log(`총 ${allKeywords.length}개 키워드 조회 중...\n`);

  // API는 한 번에 5개씩 제한
  const results = [];
  for (let i = 0; i < allKeywords.length; i += 5) {
    const batch = allKeywords.slice(i, i + 5);
    console.log(`  배치 ${Math.floor(i / 5) + 1}: ${batch.join(', ')}`);
    try {
      const data = await getKeywordVolume(batch);
      const list = data.keywordList || [];
      // 힌트 키워드만 필터 (연관 키워드 제외)
      for (const kw of batch) {
        const found = list.find(k => k.relKeyword === kw);
        if (found) {
          const pc = found.monthlyPcQcCnt;
          const mo = found.monthlyMobileQcCnt;
          const pcN = typeof pc === 'string' ? 5 : pc;   // "< 10" → 5로 추정
          const moN = typeof mo === 'string' ? 5 : mo;
          results.push({ keyword: kw, pc: pcN, mobile: moN, total: pcN + moN, comp: found.compIdx });
        } else {
          results.push({ keyword: kw, pc: 0, mobile: 0, total: 0, comp: '-' });
        }
      }
    } catch (err) {
      console.error(`  에러: ${err.message}`);
      for (const kw of batch) results.push({ keyword: kw, pc: -1, mobile: -1, total: -1, comp: 'ERR' });
    }
    // rate limit 방지
    if (i + 5 < allKeywords.length) await new Promise(r => setTimeout(r, 300));
  }

  // 결과 출력 (총 검색량 내림차순)
  results.sort((a, b) => b.total - a.total);
  console.log('\n═══ 검색량 결과 (월간) ═══');
  console.log('키워드'.padEnd(20) + 'PC'.padStart(8) + '모바일'.padStart(8) + '합계'.padStart(8) + '  경쟁');
  console.log('─'.repeat(55));
  for (const r of results) {
    console.log(
      r.keyword.padEnd(20) +
      String(r.pc).padStart(8) +
      String(r.mobile).padStart(8) +
      String(r.total).padStart(8) +
      '  ' + r.comp
    );
  }

  // 트렌드 조회 (검색량 상위 30개만)
  const topKws = results.filter(r => r.total > 10).slice(0, 30).map(r => r.keyword);
  const trends = await scanTrends(topKws);

  // 캐시 파일 저장
  const cache = {
    meta: {
      updatedAt: new Date().toISOString(),
      keywordCount: results.filter(r => r.total >= 0).length,
      source: 'naver-searchad-api',
      hasTrend: Object.keys(trends).length > 0,
    },
    keywords: {},
  };
  for (const r of results) {
    if (r.total < 0) continue; // ERR 제외
    const t = trends[r.keyword];
    cache.keywords[r.keyword] = {
      pc: r.pc, mobile: r.mobile, total: r.total, comp: r.comp,
      trend: t ? t.score : null,
      trendDir: t ? t.direction : null,
    };
  }
  const cachePath = path.join(process.cwd(), 'data/work/keyword-volume-cache.json');
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2));
  console.log(`\n캐시 저장: ${cachePath} (${cache.meta.keywordCount}개 키워드)`);

  return results;
}

// ═══════════════════════════════════════════════════
// 데이터랩 트렌드 API
// ═══════════════════════════════════════════════════
const DL_CLIENT_ID     = process.env.NAVER_DATALAB_CLIENT_ID;
const DL_CLIENT_SECRET = process.env.NAVER_DATALAB_CLIENT_SECRET;

async function fetchTrend(keywordGroups) {
  if (!DL_CLIENT_ID || !DL_CLIENT_SECRET) return null;

  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const startDate3m = new Date(now - 90 * 86400000).toISOString().slice(0, 10);

  const body = {
    startDate: startDate3m,
    endDate,
    timeUnit: 'month',
    keywordGroups,
  };

  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': DL_CLIENT_ID,
      'X-Naver-Client-Secret': DL_CLIENT_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  [트렌드] API ${res.status}: ${text.slice(0, 100)}`);
    return null;
  }
  return res.json();
}

// 트렌드 점수 계산: 최근 월 ratio / 첫 월 ratio → 1보다 크면 상승세
function calcTrendScore(data) {
  if (!data || !data.length) return 1.0;
  const first = data[0]?.ratio || 1;
  const last = data[data.length - 1]?.ratio || 1;
  if (first === 0) return last > 0 ? 2.0 : 1.0;
  return Math.round((last / first) * 100) / 100;
}

async function scanTrends(topKeywords) {
  if (!DL_CLIENT_ID || !DL_CLIENT_SECRET) {
    console.log('\n[트렌드] NAVER_DATALAB 키 미설정 — 트렌드 스킵');
    return {};
  }

  console.log('\n═══ 데이터랩 트렌드 조회 ═══');
  const trends = {};

  // 5개씩 그룹으로 조회 (API 제한: 최대 5그룹)
  for (let i = 0; i < topKeywords.length; i += 5) {
    const batch = topKeywords.slice(i, i + 5);
    const keywordGroups = batch.map(kw => ({
      groupName: kw,
      keywords: [kw],
    }));

    console.log(`  배치 ${Math.floor(i / 5) + 1}: ${batch.join(', ')}`);
    try {
      const result = await fetchTrend(keywordGroups);
      if (result?.results) {
        for (const r of result.results) {
          const score = calcTrendScore(r.data);
          const direction = score > 1.1 ? '↑' : score < 0.9 ? '↓' : '→';
          trends[r.title] = { score, direction, data: r.data };
        }
      }
    } catch (err) {
      console.error(`  에러: ${err.message}`);
    }
    if (i + 5 < topKeywords.length) await new Promise(r => setTimeout(r, 300));
  }

  // 트렌드 결과 출력
  const sorted = Object.entries(trends).sort((a, b) => b[1].score - a[1].score);
  console.log('\n키워드'.padEnd(20) + '트렌드'.padStart(8) + '  방향');
  console.log('─'.repeat(35));
  for (const [kw, t] of sorted) {
    console.log(kw.padEnd(20) + `×${t.score}`.padStart(8) + '  ' + t.direction);
  }

  return trends;
}

// 직접 키워드 조회
async function queryDirect(keywords) {
  const data = await getKeywordVolume(keywords);
  const list = data.keywordList || [];
  console.log(`\n결과: ${list.length}개\n`);
  for (const k of list) {
    console.log(`${k.relKeyword}: PC ${k.monthlyPcQcCnt} / 모바일 ${k.monthlyMobileQcCnt} / 경쟁 ${k.compIdx}`);
  }
}

// main
const args = process.argv.slice(2);
if (args.includes('--scan')) {
  scanAll().catch(err => { console.error(err); process.exit(1); });
} else if (args.length > 0) {
  const keywords = args[0].split(',').map(s => s.trim());
  queryDirect(keywords).catch(err => { console.error(err); process.exit(1); });
} else {
  console.log('사용법:');
  console.log('  node scripts/naver-keyword-volume.js "파주캘리퍼,일산디스크"');
  console.log('  node scripts/naver-keyword-volume.js --scan');
}
