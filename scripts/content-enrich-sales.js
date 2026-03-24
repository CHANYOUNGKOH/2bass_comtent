/**
 * content-enrich-sales.js
 * SSOT에 salesContext 추가 — 매출 전환 극대화용
 *
 * Phase 1: 전체 집계 (차종별 시공횟수, 연관 포스트)
 * Phase 2: 개별 Claude 추출 (레퍼럴, 고객지역, AS, 스펙비교, 크로스셀 등)
 */
import { readFile, writeFile, readdir } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';

const ROOT        = process.cwd();
const SSOT_DIR    = 'data/ssot-posts';
const CONCURRENCY = Number(process.env.SALES_CONCURRENCY || 10);
const MODEL       = process.env.SALES_MODEL || 'haiku';
const LIMIT       = Number(process.env.SALES_LIMIT || 0);

async function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--model', MODEL, '--print'], {
      shell: true,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.stdin.write(prompt);
    proc.stdin.end();

    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 90000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${stderr.slice(0, 100)}`));
      const clean = stdout.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) return reject(new Error('JSON 없음: ' + stdout.slice(0, 100)));
      try { resolve(JSON.parse(match[0])); }
      catch (e) { reject(new Error('JSON 파싱 실패: ' + e.message)); }
    });
  });
}

// ─── Phase 1: 전체 집계 ───
function buildAggregates(allSsots) {
  // 차종별 시공 횟수
  const modelCount = {};
  // 차종별 포스트 목록
  const modelPosts = {};
  // 부품별 포스트 목록
  const partPosts = {};
  // 작업유형별 포스트 목록
  const workTypePosts = {};

  for (const ssot of allSsots) {
    const key = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
    if (key) {
      modelCount[key] = (modelCount[key] || 0) + 1;
      if (!modelPosts[key]) modelPosts[key] = [];
      modelPosts[key].push(ssot.postId);
    }

    const workType = ssot.work?.type || '';
    if (workType) {
      if (!workTypePosts[workType]) workTypePosts[workType] = [];
      workTypePosts[workType].push(ssot.postId);
    }

    for (const part of (ssot.work?.parts || [])) {
      if (typeof part !== 'string') continue;
      const pKey = part.replace(/\s+/g, ' ').trim();
      if (pKey) {
        if (!partPosts[pKey]) partPosts[pKey] = [];
        partPosts[pKey].push(ssot.postId);
      }
    }
  }

  return { modelCount, modelPosts, partPosts, workTypePosts };
}

function findRelatedPosts(ssot, agg) {
  const myId = ssot.postId;
  const related = new Set();

  // 같은 차종 다른 작업
  const key = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
  if (key && agg.modelPosts[key]) {
    for (const id of agg.modelPosts[key]) {
      if (id !== myId) related.add(id);
    }
  }

  // 같은 작업유형 다른 차종
  const workType = ssot.work?.type || '';
  if (workType && agg.workTypePosts[workType]) {
    for (const id of agg.workTypePosts[workType]) {
      if (id !== myId) related.add(id);
    }
  }

  // 같은 부품 사용
  for (const part of (ssot.work?.parts || [])) {
    if (typeof part !== 'string') continue;
    const pKey = part.replace(/\s+/g, ' ').trim();
    if (pKey && agg.partPosts[pKey]) {
      for (const id of agg.partPosts[pKey]) {
        if (id !== myId) related.add(id);
      }
    }
  }

  // 최대 10개로 제한 (가장 관련성 높은 것 우선 = 같은 차종)
  const sameModel = key && agg.modelPosts[key]
    ? agg.modelPosts[key].filter(id => id !== myId).slice(0, 5)
    : [];
  const others = [...related].filter(id => !sameModel.includes(id)).slice(0, 5);

  return {
    sameVehicle: sameModel,
    sameWorkOrParts: others,
  };
}

// 공지/휴무 포스트 판별
function isNoticePost(ssot) {
  if (ssot.isNotice) return true;
  if (ssot.work?.type && /공지|휴무|안내|이벤트/.test(ssot.work.type)) return true;
  return false;
}

// ─── Phase 2: Claude 추출 프롬프트 ───
function buildPrompt(ssot, modelCountForThis) {
  return `아래는 브레이크 전문샵 "투베이스(2BASS)"의 작업 사례 원문입니다.
원문에서 매출 전환에 활용할 수 있는 정보를 추출하세요.

[원문]
${ssot.originalText?.slice(0, 2000) || ''}

[이미 알고 있는 정보]
- 차종: ${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}
- 작업: ${ssot.work?.type || ''}
- 부품: ${(ssot.work?.parts || []).join(', ')}
- 이 차종 투베이스 총 시공 횟수: ${modelCountForThis}회

[필수 규칙]
1. 모든 필드는 한국어로 작성. 영어 절대 금지.
2. 아래 "추출 필드"는 원문에 있는 것만 적고, 없으면 반드시 null.
3. "추론 허용 필드"도 원문 팩트 기반으로만. 원문에 없는 팩트를 만들지 마세요.
4. "16년 경력", "전문성" 같은 일반적 보일러플레이트 문구 금지 — 원문에 명시적으로 있을 때만.
5. 번역체 금지: "커스텀 솔루션"→"맞춤 작업", "토탈 솔루션"→"전체 작업", "시스템 업그레이드"→"업그레이드", "퍼포먼스 브레이크"→"고성능 브레이크". 한국 정비사가 실제 쓰는 표현으로.

[추출 필드 — 원문에 있는 것만, 없으면 null]
- referral, customerRegion, warranty, specComparison, priceHint, freeServices, returnVisit

[추론 허용 필드 — 원문 팩트 기반으로만]
- urgencySignal: 원문에 나온 증상/문제를 기반으로 "방치 시 위험" 1문장. 원문에 증상이 없으면 null.
- emotionalTrigger: 원문에 고객 반응/감정이 명시된 경우만. 없으면 null.
- trustSignal: 원문에서 확인 가능한 신뢰 요소만 (예: "재방문", "소개", "당일완료"). 일반 문구 금지.
- uniqueSellingPoint: 원문에서 일반 정비소가 못하는 작업이 구체적으로 드러난 경우만. 없으면 null.

[JSON으로만 답하세요]
{
  "referral": {
    "hasReferral": true/false,
    "source": "소개 경로 (없으면 null)",
    "sourceVehicle": "소개자 차종 (있으면)"
  },
  "customerRegion": "고객 지역 (없으면 null)",
  "warranty": "AS/보증 (없으면 null)",
  "specComparison": {
    "before": "교체 전 스펙 (없으면 null)",
    "after": "교체 후 스펙 (없으면 null)",
    "improvement": "체감 개선점 (없으면 null)"
  },
  "crossSell": ["원문에 언급된 후속 작업 (없으면 빈 배열)"],
  "returnVisit": {
    "mentioned": true/false,
    "reason": "재방문 사유 (없으면 null)"
  },
  "freeServices": ["원문에 언급된 무료 서비스 (없으면 빈 배열)"],
  "urgencySignal": "방치 시 위험 (원문 증상 기반, 없으면 null)",
  "emotionalTrigger": "고객 감정/만족 (원문에 있을 때만, 없으면 null)",
  "trustSignal": "원문 확인 가능한 신뢰 요소 (없으면 null)",
  "priceHint": "가격 언급 (없으면 null)",
  "uniqueSellingPoint": "구체적 차별점 (없으면 null)"
}`;
}

// ─── 메인 프로세스 ───
async function main() {
  console.log('매출 컨텍스트 enrichment 시작...\n');

  // 전체 SSOT 로드
  const files = (await readdir(path.join(ROOT, SSOT_DIR)))
    .filter(f => f.endsWith('.json'));

  console.log(`Phase 1: ${files.length}개 SSOT 집계 중...`);
  const allSsots = [];
  for (const f of files) {
    const ssot = JSON.parse(await readFile(path.join(ROOT, SSOT_DIR, f), 'utf8'));
    ssot._file = f;
    allSsots.push(ssot);
  }

  const agg = buildAggregates(allSsots);

  // 차종별 시공 통계 출력
  const topModels = Object.entries(agg.modelCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  console.log('\n차종별 시공 횟수 TOP 15:');
  for (const [model, count] of topModels) {
    console.log(`  ${model}: ${count}회`);
  }

  console.log(`\nPhase 2: Claude 추출 시작 (CONCURRENCY=${CONCURRENCY})...\n`);

  const results = { ok: 0, skipped: 0, failed: 0 };
  let idx = 0;

  async function worker() {
    while (idx < allSsots.length) {
      if (LIMIT && results.ok + results.skipped >= LIMIT) break;
      const ssot = allSsots[idx++];

      // 이미 salesContext가 있으면 스킵
      if (ssot.salesContext) {
        results.skipped++;
        process.stdout.write('s');
        if ((results.ok + results.skipped + results.failed) % 50 === 0) {
          process.stdout.write(` ${results.ok + results.skipped + results.failed}/${allSsots.length}\n`);
        }
        continue;
      }

      // 공지/휴무 포스트는 salesContext 스킵
      if (isNoticePost(ssot)) {
        ssot.salesContext = { skipped: true, reason: 'notice_post' };
        const toSave = { ...ssot };
        delete toSave._file;
        await writeFile(
          path.join(ROOT, SSOT_DIR, ssot._file),
          JSON.stringify(toSave, null, 2)
        );
        results.ok++;
        process.stdout.write('n');
        if ((results.ok + results.skipped + results.failed) % 50 === 0) {
          process.stdout.write(` ${results.ok + results.skipped + results.failed}/${allSsots.length}\n`);
        }
        continue;
      }

      try {
        const vehicleKey = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
        const modelCountForThis = agg.modelCount[vehicleKey] || 0;

        // Claude 추출
        const extracted = await callClaude(buildPrompt(ssot, modelCountForThis));

        // 집계 데이터 병합
        const related = findRelatedPosts(ssot, agg);

        ssot.salesContext = {
          // 집계 기반
          modelCount: modelCountForThis,
          relatedPosts: related,
          // Claude 추출
          referral: extracted.referral || null,
          customerRegion: extracted.customerRegion || null,
          warranty: extracted.warranty || null,
          specComparison: extracted.specComparison || null,
          crossSell: extracted.crossSell || [],
          returnVisit: extracted.returnVisit || null,
          freeServices: extracted.freeServices || [],
          urgencySignal: extracted.urgencySignal || null,
          emotionalTrigger: extracted.emotionalTrigger || null,
          trustSignal: extracted.trustSignal || null,
          priceHint: extracted.priceHint || null,
          uniqueSellingPoint: extracted.uniqueSellingPoint || null,
        };

        // 파일에 저장 (_file 제거)
        const toSave = { ...ssot };
        delete toSave._file;
        await writeFile(
          path.join(ROOT, SSOT_DIR, ssot._file),
          JSON.stringify(toSave, null, 2)
        );

        results.ok++;
        process.stdout.write('.');
      } catch {
        results.failed++;
        process.stdout.write('!');
      }

      if ((results.ok + results.skipped + results.failed) % 50 === 0) {
        process.stdout.write(` ${results.ok + results.skipped + results.failed}/${allSsots.length}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log('\n\n=== 완료 ===');
  console.log(`enriched: ${results.ok}건, skipped: ${results.skipped}건, failed: ${results.failed}건`);

  // 집계 요약 저장
  const summary = {
    totalPosts: allSsots.length,
    modelCount: agg.modelCount,
    topModels: topModels.map(([model, count]) => ({ model, count })),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(ROOT, SSOT_DIR, '_aggregate-summary.json'),
    JSON.stringify(summary, null, 2)
  );
  console.log('집계 요약: data/ssot-posts/_aggregate-summary.json');
}

main().catch(err => { console.error(err); process.exit(1); });
