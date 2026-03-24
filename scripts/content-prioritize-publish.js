/**
 * content-prioritize-publish.js
 * SSOT 전체 스캔 → 키워드 검색량 매칭 → 발행 우선순위 리포트
 *
 * 사용법:
 *   node scripts/content-prioritize-publish.js           # 전체 리포트
 *   node scripts/content-prioritize-publish.js --top 20  # 상위 20건
 *   node scripts/content-prioritize-publish.js --unpublished  # 미발행만
 */
import { readdir } from 'fs/promises';
import path from 'path';
import { loadJson, exists, loadKeywordVolumeCache, cacheToVolumeDetail } from './_content-shared.js';

const ROOT        = process.cwd();
const SSOT_DIR    = 'data/ssot-posts';
const PUBLISH_DIR = 'data/publish/naver-v2';

// 하드코딩 fallback (캐시 없을 때)
const KEYWORD_VOLUME_FALLBACK = {
  '브레이크디스크': { vol: 2580, comp: '중간' },
  '브레이크패드교체': { vol: 1600, comp: '중간' },
  '브레이크패드': { vol: 1400, comp: '중간' },
  '브렘보캘리퍼': { vol: 420, comp: '낮음' },
  '브렘보': { vol: 350, comp: '낮음' },
  '디스크연마': { vol: 200, comp: '낮음' },
  '브레이크튜닝': { vol: 300, comp: '낮음' },
  '캘리퍼': { vol: 250, comp: '낮음' },
  '브레이크떨림': { vol: 1200, comp: '낮음' },
  '브레이크소음': { vol: 800, comp: '낮음' },
  '핸들떨림': { vol: 600, comp: '낮음' },
  '고속떨림': { vol: 500, comp: '낮음' },
  '브레이크밀림': { vol: 400, comp: '낮음' },
  '브레이크쏠림': { vol: 200, comp: '낮음' },
  '브레이크끼익': { vol: 300, comp: '낮음' },
  '제동불량': { vol: 150, comp: '낮음' },
  '그랜저브레이크': { vol: 150, comp: '낮음' },
  '소나타브레이크': { vol: 180, comp: '낮음' },
  'K5브레이크': { vol: 120, comp: '낮음' },
  'BMW브레이크': { vol: 200, comp: '낮음' },
  '벤츠브레이크': { vol: 180, comp: '낮음' },
  '쏘렌토브레이크': { vol: 100, comp: '낮음' },
  '아반떼브레이크': { vol: 90, comp: '낮음' },
  '투싼브레이크': { vol: 80, comp: '낮음' },
};
let KEYWORD_VOLUME = KEYWORD_VOLUME_FALLBACK;

const COMP_MULT = { '높음': 0.7, '중간': 1.0, '낮음': 1.3 };

function scorePost(ssot) {
  const w = ssot.work || {};
  const v = ssot.vehicle || {};
  const parts = (w.parts || []).join(' ').replace(/\s/g, '').toLowerCase();
  const wtype = (w.type || '').replace(/\s/g, '').toLowerCase();
  const model = (v.model || '').replace(/\s/g, '').toLowerCase();
  const brand = (v.brand || '').replace(/\s/g, '').toLowerCase();
  const symptomRaw = ssot.consumer?.directDemand?.symptom;
  const symptom = (Array.isArray(symptomRaw) ? symptomRaw.join(' ') : (symptomRaw || '')).replace(/\s/g, '').toLowerCase();
  const searchText = `${parts} ${wtype} ${model} ${brand} ${symptom}`;

  let totalScore = 0;
  const matched = [];

  for (const [kw, data] of Object.entries(KEYWORD_VOLUME)) {
    const kwLow = kw.toLowerCase();
    if (searchText.includes(kwLow)) {
      const vol = data.vol || 0;
      const comp = data.comp || '중간';
      const rawTrend = data.trend || 1.0;
      const trend = Math.min(1.3, Math.max(0.7, rawTrend));
      const s = vol * (COMP_MULT[comp] || 1.0) * trend;
      totalScore += s;
      matched.push({ keyword: kw, volume: vol, competition: comp, trend: rawTrend, score: Math.round(s) });
    }
  }

  // 증상 보너스
  if (/떨림|소음|밀림|쏠림|편마모/.test(searchText)) totalScore += 300;

  // 인기 차종 보너스
  if (/그랜저|쏘나타|k5|k7|스포티지|투싼|싼타페/.test(model)) totalScore += 200;
  if (/bmw|벤츠|아우디/.test(brand)) totalScore += 250;

  return { score: Math.round(totalScore), matched };
}

async function main() {
  const args = process.argv.slice(2);
  const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) || 20 : 0;
  const unpublishedOnly = args.includes('--unpublished');

  const ssotFiles = (await readdir(path.join(ROOT, SSOT_DIR)).catch(() => []))
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  // 키워드 볼륨 캐시 로드
  const kvCache = await loadKeywordVolumeCache();
  const cachedDetail = cacheToVolumeDetail(kvCache);
  if (cachedDetail) KEYWORD_VOLUME = cachedDetail;

  console.log(`SSOT 파일: ${ssotFiles.length}개 스캔 중...\n`);

  const results = [];
  let publishedCount = 0;

  for (const f of ssotFiles) {
    const ssot = await loadJson(path.join(ROOT, SSOT_DIR, f), null);
    if (!ssot || ssot.isNotice) continue;

    const published = await exists(path.join(ROOT, PUBLISH_DIR, `${ssot.postId}.json`));
    if (published) publishedCount++;
    if (unpublishedOnly && published) continue;

    const { score, matched } = scorePost(ssot);
    const v = ssot.vehicle || {};
    const w = ssot.work || {};

    results.push({
      postId: ssot.postId,
      score,
      car: `${v.brand || ''} ${v.model || ''}`.trim(),
      work: w.type || '',
      parts: (w.parts || []).slice(0, 3).join(', '),
      matched: matched.map(m => m.keyword).join(', '),
      published,
    });
  }

  results.sort((a, b) => b.score - a.score);
  const display = topN ? results.slice(0, topN) : results;

  console.log('═══ 발행 우선순위 리포트 ═══');
  console.log(`총 ${results.length}건 | 발행 완료: ${publishedCount}건 | 미발행: ${results.length - publishedCount}건\n`);
  console.log(
    '순위'.padEnd(4) +
    '점수'.padStart(6) +
    '  상태  ' +
    '차종'.padEnd(18) +
    '작업'.padEnd(25) +
    '매칭 키워드'
  );
  console.log('─'.repeat(100));

  display.forEach((r, i) => {
    const status = r.published ? '발행' : '미발행';
    console.log(
      String(i + 1).padEnd(4) +
      String(r.score).padStart(6) +
      `  ${status.padEnd(4)}  ` +
      r.car.padEnd(18) +
      r.work.slice(0, 24).padEnd(25) +
      r.matched
    );
  });

  // 요약 통계
  const avgScore = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
  const highPriority = results.filter(r => r.score >= 1000 && !r.published);
  console.log(`\n═══ 요약 ═══`);
  console.log(`평균 점수: ${avgScore}`);
  console.log(`고우선순위 미발행 (1000점+): ${highPriority.length}건`);

  if (highPriority.length > 0) {
    console.log('\n추천 발행 순서 (상위 5건):');
    for (const r of highPriority.slice(0, 5)) {
      console.log(`  ${r.score}점 | ${r.car} ${r.work} | ${r.postId}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
