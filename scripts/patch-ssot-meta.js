#!/usr/bin/env node
/**
 * patch-ssot-meta.js
 * vehicle/work 메타가 비어있는 SSOT 파일을 찾아 Claude로 재추출 (패치)
 *
 * - originalText + title 을 Claude에 전달 → vehicle, work, keyPoints 등 추출
 * - 기존 SSOT의 다른 필드(images, originalUrl 등)는 보존
 * - 300자 미만도 Claude 호출 (기존 빌더의 300자 스킵 문제 수정)
 *
 * Usage:
 *   node scripts/patch-ssot-meta.js              # 전체 패치
 *   node scripts/patch-ssot-meta.js --dry-run    # 변경 없이 대상만 확인
 */
import { readFile, writeFile, readdir } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = process.cwd();
const SSOT_DIR = path.join(ROOT, 'data/ssot-posts');
const MODEL = process.env.SSOT_MODEL || 'haiku';
const CONCURRENCY = Number(process.env.SSOT_CONCURRENCY || 3);
const DRY_RUN = process.argv.includes('--dry-run');

const MODEL_MAP = {
  'sonnet':  'claude-sonnet-4-6-20250514',
  'haiku':   'claude-haiku-4-5-20251001',
  'opus':    'claude-opus-4-6-20250514',
};

const USE_API = !!process.env.ANTHROPIC_API_KEY;
let _anthropicClient = null;
if (USE_API) _anthropicClient = new Anthropic();

async function callClaude(prompt) {
  const modelId = MODEL.startsWith('claude-') ? MODEL : (MODEL_MAP[MODEL] || MODEL_MAP.haiku);

  let raw;
  if (USE_API) {
    const response = await _anthropicClient.messages.create({
      model: modelId,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } else {
    raw = await new Promise((resolve, reject) => {
      const proc = spawn('claude', ['--model', MODEL, '--print'], {
        shell: true, env: { ...process.env },
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.stdin.write(prompt);
      proc.stdin.end();
      const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 60000);
      proc.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`claude exit ${code}: ${stderr.slice(0, 100)}`));
        resolve(stdout);
      });
    });
  }

  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON 없음: ' + raw.slice(0, 100));
  try { return JSON.parse(match[0]); }
  catch (e) { throw new Error('JSON 파싱 실패: ' + e.message); }
}

function buildPrompt(title, bodyText) {
  return `당신은 자동차 브레이크 전문 정비소의 작업 기록을 정확히 구조화하는 데이터 추출기입니다.

[필수 규칙]
1. 모든 필드는 반드시 한국어로 작성. 영어 절대 금지.
2. 원문에 없는 정보는 반드시 null. 추측하지 마세요.
3. 부품명은 원문 그대로 옮기세요. 번역하거나 영어로 바꾸지 마세요.
4. "크로스 모델", "커스텀 솔루션", "토탈 솔루션" 같은 번역체 금지.
   → "타차종 이식", "맞춤 작업", "전체 작업"처럼 한국 자동차 업계에서 실제 사용하는 표현으로.
5. work.type은 한국 정비사가 쓰는 표현으로: "브레이크 패드 교체", "디스크 연마", "4P 캘리퍼 업그레이드" 등.
6. keyPoints는 원문에서 확인 가능한 사실만. 원문에 없는 장점이나 특징을 만들지 마세요.
7. 정규화: 원문의 구어체/축약어를 정제된 표현으로 변환하세요.
   → "4p4p" → "앞뒤 4피스톤(4P+4P) 풀세팅"
   → "빅4p" → "빅 4피스톤 캘리퍼"
   → "6p" → "6피스톤 캘리퍼"

[비작업 포스트 판별]
본문이 다음에 해당하면 isNotice: true:
→ 휴무/공지/인사/이벤트/일상
→ 브레이크 작업이 아닌 경우 (휠튜닝, 서스펜션, 마케팅 영상, 부품 리뷰만 있는 글)
→ 실제 시공/정비 내용이 없는 경우

isNotice: true일 때:
→ work.type: "공지", "휴무", "휠튜닝", "마케팅" 등 (해당하는 것으로, 영어 금지)

그 외 실제 브레이크 작업 글이면:
→ isNotice: false

제목: ${title}
본문: ${bodyText.slice(0, 3000)}

JSON으로만 답하세요:
{"vehicle":{"brand":"","model":"","note":""},"work":{"type":"","parts":["부품1","부품2"],"challenge":"","solution":"","duration":""},"cleanTitle":"","keyPoints":[],"difficulty":"","isNotice":false,"reviewNeeded":false}
※ parts는 반드시 문자열 배열. 객체 배열 금지.`;
}

async function main() {
  const files = (await readdir(SSOT_DIR))
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  // 패치 대상: brand+model 비어있는 파일
  const targets = [];
  for (const f of files) {
    try {
      const ssot = JSON.parse(await readFile(path.join(SSOT_DIR, f), 'utf8'));
      const brand = (ssot.vehicle && ssot.vehicle.brand) || '';
      const model = (ssot.vehicle && ssot.vehicle.model) || '';
      if (!brand && !model) targets.push(f);
    } catch { /* skip */ }
  }

  console.log(`패치 대상: ${targets.length}개 / 전체 SSOT: ${files.length}개`);
  if (DRY_RUN) {
    targets.forEach(f => console.log('  ' + f));
    return;
  }

  const stats = { ok: 0, failed: 0, notice: 0 };
  let idx = 0;

  async function worker() {
    while (idx < targets.length) {
      const f = targets[idx++];
      const filePath = path.join(SSOT_DIR, f);
      try {
        const ssot = JSON.parse(await readFile(filePath, 'utf8'));
        const title = ssot.title?.original || ssot.title?.clean || '';
        const bodyText = ssot.originalText || '';

        if (!title && !bodyText) {
          process.stdout.write('x');
          stats.failed++;
          continue;
        }

        const result = await callClaude(buildPrompt(title, bodyText));

        // 메타 필드만 업데이트 (나머지 보존)
        ssot.vehicle = result.vehicle || ssot.vehicle;
        ssot.work = result.work || ssot.work;
        ssot.isNotice = result.isNotice || false;
        ssot.keyPoints = result.keyPoints || ssot.keyPoints;
        ssot.difficulty = result.difficulty || ssot.difficulty;
        if (result.cleanTitle && ssot.title) {
          ssot.title.clean = result.cleanTitle;
        }
        ssot.validation = ssot.validation || {};
        ssot.validation.metaPatched = true;
        ssot.validation.patchedAt = new Date().toISOString();

        await writeFile(filePath, JSON.stringify(ssot, null, 2));

        if (result.isNotice) {
          process.stdout.write('n');
          stats.notice++;
        } else {
          process.stdout.write('.');
          stats.ok++;
        }
      } catch (err) {
        process.stdout.write('!');
        stats.failed++;
        console.error(`\n[ERR] ${f}: ${err.message}`);
      }

      if ((stats.ok + stats.failed + stats.notice) % 30 === 0) {
        process.stdout.write(` ${stats.ok + stats.failed + stats.notice}/${targets.length}\n`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\n\n═══ 메타 패치 완료 ═══`);
  console.log(`성공: ${stats.ok} | 공지: ${stats.notice} | 실패: ${stats.failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
