#!/usr/bin/env node
/**
 * content-generate-daangn.js
 * SSOT → 당근마켓 동네소식 JSON 생성 (Claude API)
 *
 * 출력: data/publish/daangn/{postId}.json
 *
 * Usage:
 *   node scripts/content-generate-daangn.js              # 전체 생성
 *   BLOG_LIMIT=5 node scripts/content-generate-daangn.js # 5개만 테스트
 */
import { mkdir, writeFile, readdir } from 'fs/promises';
import path from 'path';
import {
  CTA, loadJson, exists, callClaude,
  classifyPostType, buildFactSheet, selectAngle, validateGenerated,
} from './_content-shared.js';

const ROOT        = process.cwd();
const SSOT_DIR    = 'data/ssot-posts';
const PUBLISH_DIR = 'data/publish/daangn';
const LIMIT       = Number(process.env.BLOG_LIMIT || 0);
const CONCURRENCY = Number(process.env.BLOG_CONCURRENCY || 10);
const MODEL       = process.env.BLOG_MODEL || 'sonnet';

function buildDaangnPrompt(ssot, postType, factSheet) {
  const { facts, forbidden } = factSheet;

  const car = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
  const workType = ssot.work?.type || '';
  const duration = ssot.work?.duration || '';

  return `당신은 브레이크 전문 튜닝샵 "투베이스(2BASS)"의 당근마켓 소식 작성자입니다.
16년 경력, 일산(고양시) 소재.

아래 팩트시트를 바탕으로 당근마켓 비즈니스프로필 "동네소식"을 작성하세요.

━━━ 사용 가능한 팩트 (이것만 사용) ━━━
${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

━━━ 절대 금지 (날조 방지) ━━━
${forbidden.map(f => `❌ ${f}`).join('\n')}

━━━ 제목 ━━━
형식: "${car} ${workType} 시공 완료 (일산)"
20~40자, 차종+작업+지역 포함.

━━━ 본문 구조 (200~400자) ━━━
1. 작업 한줄 소개 (전문적이되 친근한 톤)
2. 차종 + 어떤 작업인지 (2~3문장)
3. 결과/포인트 (1~2문장)
4. ---
5. 📍 일산 투베이스 (2BASS)
6. ⏰ 작업시간: ${duration || '당일 완료'}
7. 💬 채팅 문의 주세요!

━━━ 작성 규칙 ━━━
1. 본문: 200~400자. 전문적이되 약간 친근 (~입니다 + ~요 혼합, 해요체).
2. 절대 금지 목록의 내용 포함 금지.
3. 고객 감정/반응 창작 금지.
4. 기술 용어 유지하되 어려운 건 간단히 부연.
5. 지역 강조: 일산 소재, 파주/일산/김포 서비스 지역 언급.
6. 해시태그 없음 (당근은 미사용).
7. CTA: 채팅 문의 유도.
8. 브랜드 한글 표기: AUDI→아우디, BMW→비엠더블유, Benz→벤츠 등.
9. 솔직하고 신뢰감 있는 톤. 과장 금지.

아래 JSON 형식으로 출력:
{
  "title": "제목 (20~40자)",
  "body": "본문 전체 (200~400자, \\n으로 단락 구분)",
  "location": "일산",
  "duration": "작업시간"
}`;
}

async function generateDaangnPost(ssotPath) {
  const ssot = await loadJson(ssotPath, null);
  if (!ssot) return { status: 'no_ssot' };

  const outPath = path.join(ROOT, PUBLISH_DIR, `${ssot.postId}.json`);
  if (await exists(outPath)) return { status: 'skipped' };

  const postType = classifyPostType(ssot);
  if (postType === 'skip') return { status: 'skipped_type', postType };

  const factSheet = buildFactSheet(ssot);
  const prompt = buildDaangnPrompt(ssot, postType, factSheet);

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
    daangn: {
      title: generated.title || '',
      body: generated.body || '',
      location: generated.location || '일산',
      duration: generated.duration || ssot.work?.duration || '당일 완료',
    },
    classification: {
      postType,
      warnings: warnings.length,
    },
    generatedAt: new Date().toISOString(),
  };

  await mkdir(path.join(ROOT, PUBLISH_DIR), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2));

  return { status: 'ok', postType, warnings: warnings.length };
}

async function main() {
  console.log('당근마켓 소식 생성 시작...');
  console.log(`모델: ${MODEL} | 동시성: ${CONCURRENCY} | 제한: ${LIMIT || '없음'}\n`);

  const ssotFiles = (await readdir(path.join(ROOT, SSOT_DIR)).catch(() => []))
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  console.log(`SSOT 파일: ${ssotFiles.length}개\n`);

  const stats = { ok: 0, skipped: 0, skippedType: 0, failed: 0 };

  const tasks = ssotFiles.map(f => async () => {
    if (LIMIT && stats.ok >= LIMIT) return;
    try {
      const r = await generateDaangnPost(path.join(ROOT, SSOT_DIR, f));
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

  console.log(`\n\n═══ 당근 소식 생성 완료 ═══`);
  console.log(`생성: ${stats.ok} | 스킵(기존): ${stats.skipped} | 스킵(유형): ${stats.skippedType} | 실패: ${stats.failed}`);
  console.log(`저장: ${PUBLISH_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
