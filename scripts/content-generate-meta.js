#!/usr/bin/env node
/**
 * content-generate-meta.js
 * SSOT → 인스타그램 캡션 JSON 생성 (Claude API)
 *
 * 출력: data/publish/meta/{postId}.json
 *
 * Usage:
 *   node scripts/content-generate-meta.js              # 전체 생성
 *   BLOG_LIMIT=5 node scripts/content-generate-meta.js # 5개만 테스트
 */
import { mkdir, writeFile, readdir } from 'fs/promises';
import path from 'path';
import {
  CTA, loadJson, exists, callClaude,
  classifyPostType, buildFactSheet, selectAngle, validateGenerated,
} from './_content-shared.js';

const ROOT        = process.cwd();
const SSOT_DIR    = 'data/ssot-posts';
const PUBLISH_DIR = 'data/publish/meta';
const LIMIT       = Number(process.env.BLOG_LIMIT || 0);
const CONCURRENCY = Number(process.env.BLOG_CONCURRENCY || 10);
const MODEL       = process.env.BLOG_MODEL || 'sonnet';

function buildMetaPrompt(ssot, postType, angle, factSheet) {
  const { facts, forbidden } = factSheet;

  const symptom = ssot.consumer?.directDemand?.symptom || '';
  const keyPoints = (ssot.keyPoints || []).slice(0, 2).join(', ');
  const car = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
  const workType = ssot.work?.type || '';

  return `당신은 브레이크 전문 튜닝샵 "투베이스(2BASS)"의 인스타그램 마케터입니다.
16년 경력, 파주/일산 소재.

아래 팩트시트를 바탕으로 인스타그램 캡션을 작성하세요.

━━━ 사용 가능한 팩트 (이것만 사용) ━━━
${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

━━━ 절대 금지 (날조 방지) ━━━
${forbidden.map(f => `❌ ${f}`).join('\n')}

━━━ 캡션 구조 (200~400자 이내) ━━━
1. [한줄 훅] — 증상/문제 공감 또는 임팩트 있는 한줄 (${symptom || '작업 관련'})
2. [차량 + 작업 핵심] — ${car} ${workType} 1~2문장
3. [결과/포인트] — ${keyPoints || '핵심 결과'} 1~2문장
4. [CTA] — "📍 프로필 링크에서 예약" 또는 "💬 DM 문의"

━━━ 해시태그 (20~25개) ━━━
필수: #브레이크튜닝 #파주브레이크 #일산브레이크 #투베이스 #2bass #브레이크전문점
추가: 차종 관련, 작업 관련, 메타 트렌드 (#차스타그램 #카스타그램 #드라이브 #자동차튜닝 등)

━━━ 작성 규칙 ━━━
1. 캡션: 200~400자 (해시태그 제외). 전문적이되 인스타에 맞게 짧고 임팩트 있게.
2. 절대 금지 목록의 내용은 어떤 형태로든 포함 금지.
3. 고객 감정/반응 창작 금지. 원문에 있는 것만 사용.
4. 해시태그: 20~25개, #단위. 메타 트렌드 반영.
5. CTA: "📍 프로필 링크에서 예약/문의" + "💬 DM으로 상담" 중 택1 또는 둘 다.
6. 브랜드 한글 표기: AUDI→아우디, BMW→비엠더블유, Benz→벤츠 등.
7. 이모지 적절히 활용 (과하지 않게, 2~3개).

아래 JSON 형식으로 출력:
{
  "caption": "캡션 전체 (200~400자, 해시태그 미포함)",
  "hashtags": "#브레이크튜닝 #파주브레이크 #일산브레이크 ... (20~25개 공백구분)",
  "cta": "📍 프로필 링크 예약 / 💬 DM 문의"
}`;
}

async function generateMetaPost(ssotPath) {
  const ssot = await loadJson(ssotPath, null);
  if (!ssot) return { status: 'no_ssot' };

  const outPath = path.join(ROOT, PUBLISH_DIR, `${ssot.postId}.json`);
  if (await exists(outPath)) return { status: 'skipped' };

  const postType = classifyPostType(ssot);
  if (postType === 'skip') return { status: 'skipped_type', postType };

  const factSheet = buildFactSheet(ssot);
  const angle = selectAngle(ssot, factSheet.verified);
  const prompt = buildMetaPrompt(ssot, postType, angle, factSheet);

  const generated = await callClaude(prompt, MODEL);
  const warnings = validateGenerated(generated, factSheet, ssot);

  const output = {
    postId: ssot.postId,
    originalUrl: ssot.originalUrl,
    vehicle: ssot.vehicle,
    work: ssot.work,
    images: {
      dir: ssot.images?.dir,
      files: ssot.images?.files || [],
      count: ssot.images?.count || 0,
    },
    meta: {
      caption: generated.caption || '',
      hashtags: generated.hashtags || '',
      cta: generated.cta || '📍 프로필 링크에서 예약 / 💬 DM 문의',
    },
    classification: {
      postType,
      angle: angle.id,
      warnings: warnings.length,
    },
    generatedAt: new Date().toISOString(),
  };

  await mkdir(path.join(ROOT, PUBLISH_DIR), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2));

  return { status: 'ok', postType, angle: angle.id, warnings: warnings.length };
}

async function main() {
  console.log('인스타그램 캡션 생성 시작...');
  console.log(`모델: ${MODEL} | 동시성: ${CONCURRENCY} | 제한: ${LIMIT || '없음'}\n`);

  const ssotFiles = (await readdir(path.join(ROOT, SSOT_DIR)).catch(() => []))
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  console.log(`SSOT 파일: ${ssotFiles.length}개\n`);

  const stats = { ok: 0, skipped: 0, skippedType: 0, failed: 0 };

  const tasks = ssotFiles.map(f => async () => {
    if (LIMIT && stats.ok >= LIMIT) return;
    try {
      const r = await generateMetaPost(path.join(ROOT, SSOT_DIR, f));
      if (r.status === 'ok') { stats.ok++; process.stdout.write('.'); }
      else if (r.status === 'skipped') { stats.skipped++; process.stdout.write('s'); }
      else if (r.status === 'skipped_type') { stats.skippedType++; process.stdout.write('-'); }
      else { stats.failed++; process.stdout.write('!'); }
    } catch (err) {
      stats.failed++;
      process.stdout.write('!');
      console.error(`\n[ERR] ${f}: ${err.message}`);
    }
  });

  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < tasks.length) { await tasks[idx++](); }
  });
  await Promise.all(workers);

  console.log(`\n\n═══ 인스타 생성 완료 ═══`);
  console.log(`생성: ${stats.ok} | 스킵(기존): ${stats.skipped} | 스킵(유형): ${stats.skippedType} | 실패: ${stats.failed}`);
  console.log(`저장: ${PUBLISH_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
