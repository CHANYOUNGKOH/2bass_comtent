/**
 * content-register-manual-post.js
 * 폼에서 내보낸 JSON → Claude enrichment → data/ssot-posts/ 저장
 *
 * 사용법:
 *   node scripts/content-register-manual-post.js <json-file-or-dir>
 *   node scripts/content-register-manual-post.js data/work/inbox/manual/
 *   node scripts/content-register-manual-post.js downloads/new_m1abc.json
 *
 * 환경변수:
 *   MANUAL_MODEL=sonnet   (consumer/sales enrichment 모델)
 *   MANUAL_SKIP_ENRICH=1  (enrichment 건너뛰고 기본 SSOT만 저장)
 */
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';

const ROOT     = process.cwd();
const SSOT_DIR = path.join(ROOT, 'data/ssot-posts');
const MODEL    = process.env.MANUAL_MODEL || 'sonnet';
const SKIP     = process.env.MANUAL_SKIP_ENRICH === '1';

// ─── Claude 호출 ───
function callClaude(prompt) {
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

    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 120000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${stderr.slice(0, 200)}`));
      const clean = stdout.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return reject(new Error('JSON 없음: ' + stdout.slice(0, 200)));
      try { resolve(JSON.parse(m[0])); }
      catch (e) { reject(new Error('JSON 파싱 실패: ' + e.message)); }
    });
  });
}

// ─── 기본 SSOT 골격 생성 (LLM 불필요) ───
function buildBaseSsot(formData) {
  const hash = crypto.createHash('md5')
    .update(`${formData.vehicle?.brand}${formData.vehicle?.model}${formData.work?.type}${Date.now()}`)
    .digest('hex').slice(0, 12);
  const postId = `manual_${hash}_post_01`;

  const car = `${formData.vehicle?.brand || ''} ${formData.vehicle?.model || ''}`.trim();
  const workType = formData.work?.type || '';

  return {
    postId,
    contentId: `manual_${hash}`,
    originalUrl: null,
    publishedAt: null,
    sourcePdf: null,
    pageRange: null,
    source: 'manual_input',
    createdAt: formData.createdAt || new Date().toISOString(),

    title: {
      original: null,
      clean: `${car} ${workType}`,
    },

    vehicle: formData.vehicle || {},
    work: formData.work || {},
    keyPoints: formData.keyPoints || [],
    difficulty: formData.difficulty || '중',
    originalText: formData.originalText || '',

    images: {
      count: formData.images?.count || 0,
      dir: formData.images?.dir || null,
      files: formData.images?.files || [],
      positions: formData.images?.positions || [],
    },

    validation: {
      partsVerified: true,
      partsFound: (formData.work?.parts || []),
      reviewNeeded: false,
    },

    platforms: {
      naverBlog: null,
      instagram: null,
      daangn: null,
    },

    generatedAt: new Date().toISOString(),
  };
}

// ─── Consumer enrichment 프롬프트 ───
function buildConsumerPrompt(ssot) {
  return `당신은 자동차 브레이크 업계의 소비자 행동 분석가입니다.
아래는 브레이크 전문샵 "투베이스(2BASS, 파주/일산, 16년 경력)"의 작업 사례입니다.

[글 정보]
제목: ${ssot.title?.clean || ''}
차종: ${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}
작업: ${ssot.work?.type || ''}
부품: ${(ssot.work?.parts || []).join(', ')}
난이도: ${ssot.difficulty || ''}
본문: ${(ssot.originalText || '').slice(0, 800)}

[분석 요청]
이 글을 인터넷에서 찾아서 읽게 될 소비자를 분석하세요.
직접적인 수요뿐 아니라, 연관된 잠재 수요층까지 넓게 추론하세요.

JSON으로만 답하세요:
{
  "directDemand": {
    "who": "이 정확한 작업을 찾는 사람 (구체적으로)",
    "symptom": "이 사람이 겪고 있을 증상/불만",
    "searchQueries": ["실제 네이버/구글에 검색할 키워드 3-5개"]
  },
  "expandedDemand": [
    {
      "segment": "연관 수요층 이름",
      "reason": "왜 이 글에 관심을 가지는지",
      "searchQueries": ["이 층이 검색할 키워드 2-3개"]
    }
  ],
  "conversionHook": "이 글을 읽은 소비자가 투베이스에 연락하게 만드는 핵심 포인트",
  "priceRange": "이 작업의 예상 가격대 (모르면 '견적문의')",
  "urgency": "high/medium/low - 소비자가 얼마나 급하게 찾는 작업인지",
  "seasonality": "계절성이 있으면 언급, 없으면 null"
}

expandedDemand는 2~4개, 같은 차종 다른 니즈 / 다른 차종 같은 작업 / 지역 검색 / 부품 비교 검색 등 다양하게.`;
}

// ─── SalesContext enrichment 프롬프트 ───
function buildSalesPrompt(ssot, modelCount) {
  return `아래는 브레이크 전문샵 "투베이스(2BASS)"의 작업 사례입니다.
이 사례에서 매출 전환에 활용할 수 있는 정보를 최대한 추출하세요.

[작업 정보]
차종: ${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}
작업: ${ssot.work?.type || ''}
부품: ${(ssot.work?.parts || []).join(', ')}
고객문제: ${ssot.work?.challenge || '없음'}
해결방법: ${ssot.work?.solution || '없음'}
작업시간: ${ssot.work?.duration || '없음'}
난이도: ${ssot.difficulty || '중'}
이 차종 투베이스 총 시공 횟수: ${modelCount}회

[작업자 메모]
${ssot.originalText || '(없음)'}

[추출 요청 - JSON으로만 답하세요]
{
  "referral": {
    "hasReferral": true/false,
    "source": "소개해준 사람/경로 (없으면 null)",
    "sourceVehicle": "소개한 사람의 차종 (있으면)"
  },
  "customerRegion": "고객 출발 지역 (없으면 null)",
  "warranty": "AS/보증 조건 (없으면 null)",
  "specComparison": {
    "before": "교체 전 순정 스펙",
    "after": "교체 후 스펙",
    "improvement": "체감 개선점"
  },
  "crossSell": ["추가로 필요하거나 언급된 후속 작업들"],
  "returnVisit": {
    "mentioned": true/false,
    "reason": "재방문 사유"
  },
  "freeServices": ["무료로 제공된 서비스 (시운전, 하체점검 등)"],
  "urgencySignal": "이 작업을 미루면 생기는 위험",
  "emotionalTrigger": "고객이 느낀 감정/만족 포인트",
  "trustSignal": "신뢰를 주는 요소",
  "priceHint": "가격 관련 언급 (없으면 null)",
  "uniqueSellingPoint": "일반 타이어샵이 못하는 투베이스만의 차별점"
}

원문에 명시적으로 없는 정보는 null로. 추론이 가능한 것만 채우세요.`;
}

// ─── 집계 로드 ───
async function loadAggregates() {
  try {
    const summary = JSON.parse(await readFile(path.join(SSOT_DIR, '_aggregate-summary.json'), 'utf8'));
    return summary.modelCount || {};
  } catch {
    return {};
  }
}

// ─── 연관 포스트 찾기 ───
async function findRelatedPosts(ssot) {
  const related = { sameVehicle: [], sameWorkOrParts: [] };
  try {
    const files = (await readdir(SSOT_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    const vehicleKey = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim().toLowerCase();
    const workType = (ssot.work?.type || '').toLowerCase();

    for (const f of files.slice(0, 500)) {
      const p = JSON.parse(await readFile(path.join(SSOT_DIR, f), 'utf8'));
      const pVehicle = `${p.vehicle?.brand || ''} ${p.vehicle?.model || ''}`.trim().toLowerCase();
      if (vehicleKey && pVehicle === vehicleKey) {
        related.sameVehicle.push(p.postId);
        if (related.sameVehicle.length >= 5) break;
      }
    }

    for (const f of files.slice(0, 500)) {
      const p = JSON.parse(await readFile(path.join(SSOT_DIR, f), 'utf8'));
      const pWork = (p.work?.type || '').toLowerCase();
      if (workType && pWork === workType && !related.sameVehicle.includes(p.postId)) {
        related.sameWorkOrParts.push(p.postId);
        if (related.sameWorkOrParts.length >= 5) break;
      }
    }
  } catch { /* ignore */ }
  return related;
}

// ─── 메인 처리 ───
async function processOne(formData) {
  const ssot = buildBaseSsot(formData);
  const car = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();

  console.log(`\n[${ssot.postId}] ${car} — ${ssot.work?.type || ''}`);

  // salesHints → salesContext 초기값
  if (formData.salesHints) {
    ssot.salesHints = undefined; // 폼의 salesHints는 제거
  }

  if (SKIP) {
    console.log('  → enrichment 스킵 (MANUAL_SKIP_ENRICH=1)');
    ssot.consumer = null;
    ssot.salesContext = null;
  } else {
    // Consumer enrichment
    process.stdout.write('  → consumer 분석 중...');
    try {
      ssot.consumer = await callClaude(buildConsumerPrompt(ssot));
      console.log(' OK');
    } catch (err) {
      console.log(` 실패: ${err.message}`);
      ssot.consumer = { error: err.message };
    }

    // SalesContext enrichment
    process.stdout.write('  → salesContext 추출 중...');
    try {
      const modelCounts = await loadAggregates();
      const vehicleKey = car;
      const modelCount = modelCounts[vehicleKey] || 0;
      const related = await findRelatedPosts(ssot);

      const extracted = await callClaude(buildSalesPrompt(ssot, modelCount));

      ssot.salesContext = {
        modelCount,
        relatedPosts: related,
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
      console.log(' OK');
    } catch (err) {
      console.log(` 실패: ${err.message}`);
      ssot.salesContext = { error: err.message };
    }
  }

  // 저장
  const outPath = path.join(SSOT_DIR, `${ssot.postId}.json`);
  await writeFile(outPath, JSON.stringify(ssot, null, 2));
  console.log(`  → 저장됨: ${outPath}`);
  return ssot.postId;
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: node scripts/content-register-manual-post.js <json-file-or-dir>');
    process.exit(1);
  }

  const absTarget = path.resolve(ROOT, target);
  const info = await stat(absTarget);
  let files = [];

  if (info.isDirectory()) {
    const entries = await readdir(absTarget);
    files = entries.filter(f => f.endsWith('.json')).map(f => path.join(absTarget, f));
  } else {
    files = [absTarget];
  }

  if (files.length === 0) {
    console.log('처리할 JSON 파일이 없습니다.');
    return;
  }

  console.log(`=== 수동 포스트 등록 (${files.length}건) ===`);
  console.log(`모델: ${MODEL}, enrichment: ${SKIP ? '건너뜀' : '활성'}\n`);

  const results = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await readFile(f, 'utf8'));
      // 배열이면 각각 처리 (전체 내보내기 파일)
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const id = await processOne(item);
        results.push(id);
      }
    } catch (err) {
      console.error(`파일 처리 실패 (${f}): ${err.message}`);
    }
  }

  console.log(`\n=== 완료: ${results.length}건 등록 ===`);
  results.forEach(id => console.log(`  ${id}`));
}

main().catch(err => { console.error(err); process.exit(1); });
