/**
 * content-manual-pipeline.js
 * 수동 폼 JSON → SSOT enrichment → 블로그 글 생성까지 한번에
 *
 * 사용법:
 *   # 단일 파일 (SSOT 등록 + 블로그 생성)
 *   node scripts/content-manual-pipeline.js manual_abc123_post_01.json
 *
 *   # 디렉토리 일괄 처리
 *   node scripts/content-manual-pipeline.js data/work/inbox/manual/
 *
 *   # SSOT만 등록 (블로그 생성 스킵)
 *   node scripts/content-manual-pipeline.js file.json --ssot-only
 *
 *   # 이미 SSOT에 있는 manual 포스트의 블로그만 생성
 *   node scripts/content-manual-pipeline.js --publish-only
 *
 *   # 이미 SSOT에 있는 특정 포스트의 블로그 생성
 *   node scripts/content-manual-pipeline.js --publish-only manual_abc123_post_01
 *
 * 환경변수:
 *   MANUAL_MODEL=sonnet     enrichment + 블로그 생성 모델
 *   MANUAL_SKIP_ENRICH=1    enrichment 건너뛰기 (기본 SSOT만)
 */
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import {
  CTA, loadJson, exists, callClaude,
  classifyPostType, buildFactSheet, selectAngle, validateGenerated,
} from './_content-shared.js';

const ROOT        = process.cwd();
const SSOT_DIR    = path.join(ROOT, 'data/ssot-posts');
const PUBLISH_DIR = path.join(ROOT, 'data/publish/naver-v2');
const WARN_DIR    = path.join(ROOT, 'data/publish/naver-v2/_warnings');
const INBOX_DIR   = path.join(ROOT, 'data/work/inbox/manual');
const MODEL       = process.env.MANUAL_MODEL || 'sonnet';
const SKIP_ENRICH = process.env.MANUAL_SKIP_ENRICH === '1';

const args = process.argv.slice(2);
const SSOT_ONLY      = args.includes('--ssot-only');
const PUBLISH_ONLY   = args.includes('--publish-only');
const NO_DASHBOARD   = args.includes('--no-dashboard');
const targets = args.filter(a => !a.startsWith('--'));

// ═══════════════════════════════════════════════════
// Claude 호출 (enrichment용 — _content-shared의 것과 별도)
// ═══════════════════════════════════════════════════
function callClaudeRaw(prompt, model) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--model', model || MODEL, '--print'], {
      shell: true, env: { ...process.env },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.stdin.write(prompt);
    proc.stdin.end();
    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 120000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`exit ${code}: ${stderr.slice(0, 200)}`));
      const clean = stdout.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return reject(new Error('JSON 없음'));
      try { resolve(JSON.parse(m[0])); }
      catch (e) { reject(new Error('파싱: ' + e.message)); }
    });
  });
}

// ═══════════════════════════════════════════════════
// Step 1: 폼 JSON → 기본 SSOT 골격
// ═══════════════════════════════════════════════════
function buildBaseSsot(formData) {
  const hash = crypto.createHash('md5')
    .update(`${formData.vehicle?.brand}${formData.vehicle?.model}${formData.work?.type}${Date.now()}`)
    .digest('hex').slice(0, 12);

  // 이미 postId가 있으면 그대로 사용 (AI 응답 붙여넣기 경로)
  const postId = formData.postId && formData.postId.startsWith('manual_')
    ? formData.postId
    : `manual_${hash}_post_01`;

  const car = `${formData.vehicle?.brand || ''} ${formData.vehicle?.model || ''}`.trim();
  const workType = formData.work?.type || '';

  return {
    postId,
    contentId: postId.replace(/_post_\d+$/, ''),
    originalUrl: formData.originalUrl || null,
    publishedAt: formData.publishedAt || null,
    sourcePdf: null,
    pageRange: null,
    source: 'manual_input',
    createdAt: formData.createdAt || new Date().toISOString(),
    title: formData.title || { original: null, clean: `${car} ${workType}` },
    vehicle: formData.vehicle || {},
    work: formData.work || {},
    keyPoints: formData.keyPoints || [],
    difficulty: formData.difficulty || '중',
    originalText: formData.originalText || '',
    images: formData.images || { count: 0, dir: null, files: [] },
    validation: formData.validation || {
      partsVerified: true,
      partsFound: formData.work?.parts || [],
      reviewNeeded: false,
    },
    platforms: formData.platforms || { naverBlog: null, instagram: null, daangn: null },
    generatedAt: new Date().toISOString(),
    // 이미 consumer/salesContext가 있으면 유지 (GPT/Gemini 복붙 경로)
    consumer: formData.consumer || null,
    salesContext: formData.salesContext || null,
  };
}

// ═══════════════════════════════════════════════════
// Step 2: Claude enrichment (consumer + salesContext)
// ═══════════════════════════════════════════════════
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

JSON으로만 답하세요:
{
  "directDemand": {
    "who": "이 정확한 작업을 찾는 사람 (구체적으로)",
    "symptom": "이 사람이 겪고 있을 증상/불만",
    "searchQueries": ["실제 네이버/구글에 검색할 키워드 3-5개"]
  },
  "expandedDemand": [
    { "segment": "연관 수요층", "reason": "왜 관심을 가지는지", "searchQueries": ["키워드 2-3개"] }
  ],
  "conversionHook": "투베이스에 연락하게 만드는 핵심 포인트",
  "priceRange": "예상 가격대 (모르면 '견적문의')",
  "urgency": "high/medium/low",
  "seasonality": "계절성 (없으면 null)"
}
expandedDemand는 2~4개.`;
}

function buildSalesPrompt(ssot, modelCount) {
  return `아래는 브레이크 전문샵 "투베이스(2BASS)"의 작업 사례입니다.
매출 전환에 활용할 수 있는 정보를 추출하세요.

[작업 정보]
차종: ${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}
작업: ${ssot.work?.type || ''}
부품: ${(ssot.work?.parts || []).join(', ')}
고객문제: ${ssot.work?.challenge || '없음'}
해결방법: ${ssot.work?.solution || '없음'}
작업시간: ${ssot.work?.duration || '없음'}
이 차종 시공 횟수: ${modelCount}회

[작업자 메모]
${ssot.originalText || '(없음)'}

[JSON으로만 답하세요]
{
  "referral": { "hasReferral": true/false, "source": null, "sourceVehicle": null },
  "customerRegion": null,
  "warranty": null,
  "specComparison": { "before": null, "after": null, "improvement": null },
  "crossSell": [],
  "returnVisit": { "mentioned": false, "reason": null },
  "freeServices": [],
  "urgencySignal": "이 작업을 미루면 생기는 위험",
  "emotionalTrigger": "고객 만족 포인트",
  "trustSignal": "신뢰 요소",
  "priceHint": null,
  "uniqueSellingPoint": "투베이스만의 차별점"
}
원문에 없는 정보는 null.`;
}

async function enrichSsot(ssot) {
  // consumer
  if (!ssot.consumer) {
    process.stdout.write('  consumer...');
    try {
      ssot.consumer = await callClaudeRaw(buildConsumerPrompt(ssot));
      process.stdout.write('OK ');
    } catch (e) {
      ssot.consumer = { error: e.message };
      process.stdout.write('FAIL ');
    }
  } else {
    process.stdout.write('  consumer(기존) ');
  }

  // salesContext
  if (!ssot.salesContext || ssot.salesContext.error) {
    process.stdout.write('sales...');
    try {
      const agg = await loadJson(path.join(SSOT_DIR, '_aggregate-summary.json'), {});
      const vehicleKey = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
      const modelCount = (agg.modelCount || {})[vehicleKey] || 0;

      const extracted = await callClaudeRaw(buildSalesPrompt(ssot, modelCount));

      // 연관 포스트 찾기
      const related = { sameVehicle: [], sameWorkOrParts: [] };
      try {
        const files = (await readdir(SSOT_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
        for (const f of files.slice(0, 300)) {
          const p = JSON.parse(await readFile(path.join(SSOT_DIR, f), 'utf8'));
          const pKey = `${p.vehicle?.brand || ''} ${p.vehicle?.model || ''}`.trim();
          if (vehicleKey && pKey === vehicleKey && p.postId !== ssot.postId) {
            related.sameVehicle.push(p.postId);
            if (related.sameVehicle.length >= 5) break;
          }
        }
      } catch { /* ignore */ }

      ssot.salesContext = {
        modelCount,
        relatedPosts: related,
        ...extracted,
      };
      process.stdout.write('OK');
    } catch (e) {
      ssot.salesContext = { error: e.message };
      process.stdout.write('FAIL');
    }
  } else {
    process.stdout.write('sales(기존)');
  }
  console.log();
}

// ═══════════════════════════════════════════════════
// Step 3: 블로그 글 생성 (content-generate-naver-blog.js 로직 재사용)
// ═══════════════════════════════════════════════════
const STRUCTURE_TEMPLATES = {
  case_study:          '도입(앵글) → 차량/상황 소개 → 작업 과정 상세 → 결과 → 마무리',
  parts_comparison:    '도입(앵글) → 순정 vs 교체 부품 분석 → 장착 과정 → 체감 변화 → 적합 차종 안내',
  maintenance_guide:   '도입(교육적 앵글) → 작업 소개 → 과정 → 주의사항 → 점검 주기',
  customer_story:      '도입(소개 경위) → 고객 니즈 → 솔루션 → 결과 → 재방문/만족',
  technical_deep_dive: '도입(왜 어려운지) → 기술적 배경 → 상세 과정 → 성과 → 해당 차종 안내',
};

const ANGLE_INSTRUCTIONS = {
  symptom:       '소비자의 증상/불편에 공감으로 시작',
  vehicle_story: '이 차량의 특성이나 매력에서 시작',
  before_after:  '순정 vs 튜닝 비교로 시작',
  value:         '가성비나 무료 서비스 어필로 시작',
  expertise:     '전문점 필요성 강조로 시작',
  community:     '동호회/입소문 언급으로 시작',
  urgency:       '시즌이나 긴급 상황 공감으로 시작',
  education:     '기술 교육 톤으로 시작',
};

const CTA_LEADINS = {
  case_study:          '비슷한 증상이라면 정확한 진단이 먼저입니다.',
  parts_comparison:    '내 차에 맞는 사양이 궁금하시면 편하게 문의하세요.',
  maintenance_guide:   '교체 시기가 궁금하시면 무료 점검 가능합니다.',
  technical_deep_dive: '일반 샵에서 거절당한 작업도 상담 가능합니다.',
  customer_story:      '주변 분들의 소개로 많이 찾아주십니다.',
};

function buildBlogPrompt(ssot, postType, angle, factSheet, ctaBlock) {
  const { facts, forbidden } = factSheet;
  const structure = STRUCTURE_TEMPLATES[postType] || STRUCTURE_TEMPLATES.case_study;
  const angleInst = ANGLE_INSTRUCTIONS[angle.id] || ANGLE_INSTRUCTIONS.symptom;
  const consumerKw = [
    ...(ssot.consumer?.directDemand?.searchQueries || []),
    ...(ssot.consumer?.expandedDemand || []).flatMap(e => e.searchQueries || []),
  ].slice(0, 8);

  return `당신은 브레이크 전문 튜닝샵 "투베이스(2BASS)"의 블로그 마케터입니다.
16년 경력, 파주/일산 소재, 전국에서 고객이 찾아옵니다.

━━━ 사용 가능한 팩트 (이것만 사용) ━━━
${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

━━━ 절대 금지 (날조 방지) ━━━
${forbidden.map(f => `❌ ${f}`).join('\n')}

━━━ 원본 메모 (참고용) ━━━
${(ssot.originalText || '').slice(0, 1500)}

━━━ 글 구조: ${postType} ━━━
${structure}

━━━ 도입부 앵글: ${angle.label} ━━━
${angleInst}

━━━ 소비자 검색 키워드 (SEO 참고) ━━━
${consumerKw.join(', ') || '없음'}

━━━ CTA (하단 고정) ━━━
${ctaBlock}

━━━ 작성 규칙 ━━━
1. 제목: 3개 추천. 60자 이내. SEO 최적화.
2. 본문: 600-1200자. 친근+전문. "■ 섹션제목" 형식 3-5개.
3. 단락: 2-3문장씩, 단락 사이 빈 줄.
4. 절대 금지 목록 내용 본문 포함 불가.
5. 고객 감정/반응은 원문에 있는 것만.
6. 해시태그: 최대 30개, 합산 100자 이내. #브레이크튜닝 #파주브레이크 #일산브레이크 #투베이스 #2bass 필수.
7. 말투: ~합니다/입니다 체. 해요체 혼합 금지.
8. "처음", "첫 시공" 등 경험 부족 암시 표현 금지.

JSON 출력:
{
  "titles": ["제목1", "제목2", "제목3"],
  "body": "본문 (\\n으로 단락 구분, ■ 섹션 헤더 포함)",
  "cta": "CTA 블록",
  "hashtags": ["#태그1", ...],
  "seoKeywords": ["키워드1", ...]
}`;
}

function buildContextualCTA(postType, hasParts) {
  const leadin = CTA_LEADINS[postType] || CTA_LEADINS.case_study;
  let block = `${leadin}\n\n`;
  block += `📞 전화 문의 → ${CTA.phone}\n`;
  block += `💬 네이버 톡톡 문의 → ${CTA.talk}\n`;
  block += `💬 카카오톡 문의 → ${CTA.kakao}\n`;
  block += `📅 네이버 예약 → ${CTA.place}\n`;
  if (hasParts) block += `🛒 부품 구매 → ${CTA.store}\n`;
  return block;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function generateBlog(ssot) {
  const outPath = path.join(PUBLISH_DIR, `${ssot.postId}.json`);
  if (await exists(outPath)) {
    console.log(`  블로그: 이미 존재 (${ssot.postId})`);
    return 'skipped';
  }

  const postType = classifyPostType(ssot);
  if (postType === 'skip') { console.log('  블로그: skip 유형'); return 'skipped'; }

  const factSheet = buildFactSheet(ssot);
  const angle = selectAngle(ssot, factSheet.verified);
  const hasParts = (ssot.work?.parts || []).length > 0;
  const ctaBlock = buildContextualCTA(postType, hasParts);
  const prompt = buildBlogPrompt(ssot, postType, angle, factSheet, ctaBlock);

  process.stdout.write('  블로그 생성 중...');
  const generated = await callClaude(prompt, MODEL);
  const warnings = validateGenerated(generated, factSheet, ssot);

  if (generated.body) generated.body = generated.body.replace(/\*\*/g, '');

  const output = {
    postId: ssot.postId,
    originalUrl: ssot.originalUrl,
    publishedAt: ssot.publishedAt,
    vehicle: ssot.vehicle,
    work: ssot.work,
    images: { dir: ssot.images?.dir, files: ssot.images?.files || [], count: ssot.images?.count || 0 },
    meta: {
      postType, angle: angle.id,
      factsUsed: factSheet.facts.length,
      forbidden: factSheet.forbidden.length,
      warnings: warnings.length,
    },
    naver: {
      titles: generated.titles || (generated.title ? [generated.title] : []),
      title: (generated.titles || [])[0] || generated.title || '',
      body: generated.body,
      cta: generated.cta,
      hashtags: generated.hashtags,
      seoKeywords: generated.seoKeywords,
    },
    validation: ssot.validation,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(PUBLISH_DIR, { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2));

  if (warnings.length) {
    await mkdir(WARN_DIR, { recursive: true });
    await writeFile(path.join(WARN_DIR, `${ssot.postId}.txt`),
      warnings.map((w, i) => `${i + 1}. ${w}`).join('\n'));
  }

  console.log(` OK (${postType}/${angle.id}, warn:${warnings.length})`);
  return 'ok';
}

// ═══════════════════════════════════════════════════
// Step 4: 대시보드 재빌드
// ═══════════════════════════════════════════════════
function rebuildDashboard() {
  return new Promise((resolve, reject) => {
    console.log('\n대시보드 재빌드 중...');
    const proc = spawn('node', [path.join(ROOT, 'scripts/naver-blog-publish-html.js')], {
      cwd: ROOT, stdio: 'inherit', shell: true,
    });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`대시보드 빌드 exit ${code}`));
      console.log('대시보드 재빌드 완료');
      resolve();
    });
    proc.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════
async function main() {
  console.log('━━━ 수동 포스트 파이프라인 ━━━');
  console.log(`모델: ${MODEL} | enrichment: ${SKIP_ENRICH ? 'OFF' : 'ON'} | ssot-only: ${SSOT_ONLY} | publish-only: ${PUBLISH_ONLY}\n`);

  // ── publish-only 모드: 이미 SSOT에 있는 manual 포스트의 블로그만 생성 ──
  if (PUBLISH_ONLY) {
    const allFiles = (await readdir(SSOT_DIR)).filter(f => f.startsWith('manual_') && f.endsWith('.json'));
    let targetFiles = allFiles;

    if (targets.length > 0) {
      const ids = new Set(targets.map(t => t.endsWith('.json') ? t.replace('.json', '') : t));
      targetFiles = allFiles.filter(f => ids.has(f.replace('.json', '')));
    }

    console.log(`블로그 생성 대상: ${targetFiles.length}개 manual 포스트\n`);

    let ok = 0, skip = 0, fail = 0;
    for (const f of targetFiles) {
      const ssot = JSON.parse(await readFile(path.join(SSOT_DIR, f), 'utf8'));
      try {
        const r = await generateBlog(ssot);
        if (r === 'ok') ok++; else skip++;
      } catch (e) {
        console.log(`  블로그 실패: ${e.message}`);
        fail++;
      }
    }
    console.log(`\n완료: 생성 ${ok} | 스킵 ${skip} | 실패 ${fail}`);

    if (!NO_DASHBOARD && ok > 0) {
      try { await rebuildDashboard(); } catch (e) { console.error('대시보드 재빌드 실패:', e.message); }
    }
    return;
  }

  // ── 일반 모드: 폼 JSON → SSOT → 블로그 ──
  let inputFiles = [];

  if (targets.length === 0) {
    // inbox/manual 디렉토리에서 읽기
    try {
      const entries = await readdir(INBOX_DIR);
      inputFiles = entries.filter(f => f.endsWith('.json')).map(f => path.join(INBOX_DIR, f));
    } catch {
      console.log(`inbox 디렉토리 없음: ${INBOX_DIR}`);
      console.log('사용법: node scripts/content-manual-pipeline.js <json-file-or-dir>');
      return;
    }
  } else {
    for (const t of targets) {
      const abs = path.resolve(ROOT, t);
      try {
        const info = await stat(abs);
        if (info.isDirectory()) {
          const entries = await readdir(abs);
          inputFiles.push(...entries.filter(f => f.endsWith('.json')).map(f => path.join(abs, f)));
        } else {
          inputFiles.push(abs);
        }
      } catch {
        // postId로 해석 시도
        const ssotFile = path.join(SSOT_DIR, t.endsWith('.json') ? t : t + '.json');
        if (await exists(ssotFile)) inputFiles.push(ssotFile);
        else console.log(`파일 없음: ${abs}`);
      }
    }
  }

  if (inputFiles.length === 0) {
    console.log('처리할 파일이 없습니다.');
    return;
  }

  console.log(`입력 파일: ${inputFiles.length}개\n`);
  await mkdir(SSOT_DIR, { recursive: true });

  let registered = 0, blogOk = 0, blogSkip = 0, blogFail = 0;

  for (const f of inputFiles) {
    try {
      const raw = JSON.parse(await readFile(f, 'utf8'));
      const items = Array.isArray(raw) ? raw : [raw];

      for (const item of items) {
        // Step 1: SSOT 골격
        const ssot = buildBaseSsot(item);
        const car = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
        console.log(`\n[${ssot.postId}] ${car} — ${ssot.work?.type || ''}`);

        // Step 2: Enrichment
        if (!SKIP_ENRICH) {
          await enrichSsot(ssot);
        }

        // Step 2.5: SSOT 저장
        const ssotPath = path.join(SSOT_DIR, `${ssot.postId}.json`);
        await writeFile(ssotPath, JSON.stringify(ssot, null, 2));
        console.log(`  SSOT 저장: ${ssot.postId}.json`);
        registered++;

        // Step 3: 블로그 생성
        if (!SSOT_ONLY) {
          try {
            const r = await generateBlog(ssot);
            if (r === 'ok') blogOk++; else blogSkip++;
          } catch (e) {
            console.log(`  블로그 생성 실패: ${e.message}`);
            blogFail++;
          }
        }
      }
    } catch (err) {
      console.error(`파일 오류 (${f}): ${err.message}`);
    }
  }

  console.log('\n━━━ 완료 ━━━');
  console.log(`SSOT 등록: ${registered}건`);
  if (!SSOT_ONLY) {
    console.log(`블로그 생성: ${blogOk}건 | 스킵: ${blogSkip}건 | 실패: ${blogFail}건`);
  }
  console.log(`\nSSOT: data/ssot-posts/`);
  console.log(`블로그: data/publish/naver-v2/`);

  if (!NO_DASHBOARD && (registered > 0 || blogOk > 0)) {
    try { await rebuildDashboard(); } catch (e) { console.error('대시보드 재빌드 실패:', e.message); }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
