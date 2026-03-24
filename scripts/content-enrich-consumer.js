/**
 * content-enrich-consumer.js
 * 각 SSOT에 소비자 관점 분석 추가
 * - 이 글을 찾는 소비자는 누구인가
 * - 어떤 검색으로 도달하는가
 * - 직접 수요뿐 아니라 연관 수요층까지 추론
 */
import { readFile, writeFile, readdir, access } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';

const ROOT        = process.cwd();
const SSOT_DIR    = 'data/ssot-posts';
const CONCURRENCY = Number(process.env.CONSUMER_CONCURRENCY || 10);
const MODEL       = process.env.CONSUMER_MODEL || 'haiku';
const LIMIT       = Number(process.env.CONSUMER_LIMIT || 0);

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

    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 60000);
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

// 공지/휴무 포스트 판별
function isNoticePost(ssot) {
  if (ssot.isNotice) return true;
  if (ssot.work?.type && /공지|휴무|안내|이벤트/.test(ssot.work.type)) return true;
  return false;
}

function buildPrompt(ssot) {
  return `당신은 자동차 브레이크 업계의 소비자 행동 분석가입니다.
아래는 브레이크 전문샵 "투베이스(2BASS, 파주/일산)"의 작업 사례 글입니다.

[글 정보]
제목: ${ssot.title?.clean || ssot.title?.original || ''}
차종: ${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}
작업: ${ssot.work?.type || ''}
부품: ${(ssot.work?.parts || []).join(', ')}
난이도: ${ssot.difficulty || ''}
본문 요약: ${(ssot.originalText || '').slice(0, 1200)}

[분석 규칙]
1. directDemand: 원문에 나온 차종+작업+증상만 기반으로 작성. 원문에 증상 언급이 없으면 symptom: null.
2. expandedDemand: 최대 2개만. "같은 차종 다른 작업" 또는 "같은 작업 다른 차종" 정도만.
3. conversionHook: 이 글 원문에서 독자가 신뢰할 만한 구체적 포인트 1개만. "16년 경력" 같은 일반적 문구 금지 — 원문에 "16년"이 명시적으로 있을 때만 사용.
4. searchQueries: 네이버에서 실제 검색될 만한 한국어 키워드만. 영어 키워드 금지.
5. priceRange: 원문에 가격 언급이 없으면 반드시 "견적문의".
6. 모든 필드는 한국어로 작성. 원문에 근거 없는 내용 창작 금지.

JSON으로만 답하세요:
{
  "directDemand": {
    "who": "이 정확한 작업을 찾는 사람 (구체적으로)",
    "symptom": "원문에 언급된 증상/불만 (없으면 null)",
    "searchQueries": ["실제 네이버에 검색할 한국어 키워드 3-5개"]
  },
  "expandedDemand": [
    {
      "segment": "연관 수요층 이름",
      "reason": "왜 이 글에 관심을 가지는지",
      "searchQueries": ["이 층이 검색할 한국어 키워드 2-3개"]
    }
  ],
  "conversionHook": "원문에서 확인 가능한 신뢰 포인트 1개",
  "priceRange": "원문에 가격 언급 있으면 그대로, 없으면 '견적문의'",
  "urgency": "high/medium/low",
  "seasonality": "계절성이 있으면 언급, 없으면 null"
}`;
}

async function processFile(filePath) {
  const ssot = JSON.parse(await readFile(filePath, 'utf8'));

  // 이미 consumer 필드가 있으면 스킵
  if (ssot.consumer) return 'skipped';

  // 공지/휴무 포스트는 consumer 분석 스킵
  if (isNoticePost(ssot)) {
    ssot.consumer = { skipped: true, reason: 'notice_post' };
    await writeFile(filePath, JSON.stringify(ssot, null, 2));
    return 'ok';
  }

  let consumer;
  try {
    consumer = await callClaude(buildPrompt(ssot));
  } catch (err) {
    consumer = { error: err.message };
  }

  ssot.consumer = consumer;
  await writeFile(filePath, JSON.stringify(ssot, null, 2));
  return 'ok';
}

async function main() {
  console.log('소비자 관점 enrichment 시작...\n');

  const files = (await readdir(path.join(ROOT, SSOT_DIR)))
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(ROOT, SSOT_DIR, f));

  console.log(`대상: ${files.length}개 SSOT 파일\n`);

  const results = { ok: 0, skipped: 0, failed: 0 };
  let idx = 0;

  async function worker() {
    while (idx < files.length) {
      if (LIMIT && results.ok + results.skipped >= LIMIT) break;
      const file = files[idx++];
      try {
        const r = await processFile(file);
        if (r === 'ok') { results.ok++; process.stdout.write('.'); }
        else { results.skipped++; process.stdout.write('s'); }
      } catch {
        results.failed++;
        process.stdout.write('!');
      }
      if ((results.ok + results.skipped + results.failed) % 50 === 0) {
        process.stdout.write(` ${results.ok + results.skipped + results.failed}/${files.length}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log('\n\n=== 완료 ===');
  console.log(`enriched: ${results.ok}건, skipped: ${results.skipped}건, failed: ${results.failed}건`);
}

main().catch(err => { console.error(err); process.exit(1); });
