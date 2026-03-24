/**
 * content-build-ssot.js
 * Claude API로 포스트 구조화 SSOT 생성
 * - 원본 텍스트 정제 (중복 제거)
 * - 차종/브랜드/작업유형/부품 추출
 * - 전문성 검증 (알려진 브레이크 부품 DB 기준)
 * - data/ssot-posts/{postId}.json 저장
 */
import { mkdir, writeFile, readFile, access, unlink } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { normalizeBrand, normalizeModel } from './_content-shared.js';

const ROOT         = process.cwd();
const UNIQUE_PATH  = 'data/content/dedup/posts-unique.json';
const SEGMENT_DIR  = 'data/content/segmented';
const SSOT_DIR     = 'data/ssot-posts';
const IMAGE_MANIFEST = 'output/images/manifest.json';
const LIMIT        = Number(process.env.SSOT_LIMIT || 0); // 0=전체
const CONCURRENCY  = Number(process.env.SSOT_CONCURRENCY || 2);
const MODEL        = process.env.SSOT_MODEL || 'haiku';
const FORCE        = process.argv.includes('--force');

// 알려진 브레이크 부품/브랜드 DB (검증용)
const KNOWN_PARTS = [
  '브렘보','brembo','펠라','fela','니트로','nitro','네오테크','neotech',
  'sdbs','CTS-V','cts-v','체어맨','만도','mando','AP','ap racing',
  'RS1','S1','V6패턴','홍성','프리미엄골드','EQ900','EQ9004P',
  '트윈캘리퍼','허브링','허브연장','브라켓','디스크연마',
  '2P','4P','6P','4PS','6PS','8P','2p','4p','6p',
  '썬디스크','sundisk','프릭사','frexa','매쉬호스',
  '로터','디스크','캘리퍼','패드','알콘','alcon','에보',
];

// 듀얼 모드: ANTHROPIC_API_KEY 있으면 API, 없으면 Claude Code CLI
import Anthropic from '@anthropic-ai/sdk';

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
  catch(e) { throw new Error('JSON 파싱 실패: ' + e.message); }
}

async function loadJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

function dedupeMirrorText(s) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const half = Math.floor(t.length / 2);
  if (t.length % 2 === 0) {
    const l = t.slice(0, half).trim();
    const r = t.slice(half).trim();
    if (l === r) return l;
  }
  return t;
}

function cleanBodyLines(lines) {
  const seen = new Set();
  return (lines || [])
    .map(l => dedupeMirrorText(l))
    .filter(l => l && l.length > 3)
    .filter(l => {
      if (seen.has(l)) return false;
      seen.add(l); return true;
    });
}

function validateParts(text) {
  const lower = text.toLowerCase();
  const found = KNOWN_PARTS.filter(p => lower.includes(p.toLowerCase()));
  return { verified: found.length > 0, partsFound: found };
}

// 번역체 금지 용어 맵 (검증 + 프롬프트 양쪽에서 사용)
const BANNED_TERMS = [
  '크로스 모델', '크로스모델', '브레이킹 시스템', '하이퍼포먼스',
  '턴키', '커스텀 솔루션', '토탈 솔루션', '퍼포먼스 브레이크',
  '시스템 업그레이드', '프리미엄 퍼포먼스',
];

async function buildSsotWithClaude(post, bodyText) {
  const prompt = `당신은 자동차 브레이크 전문 정비소의 작업 기록을 정확히 구조화하는 데이터 추출기입니다.

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
   → "32T", "28T" → 그대로 유지 (스펙 표기)
   → work.type에도 정규화 적용: "브렘보 4P4P 풀세팅" → "브렘보 앞뒤 4피스톤 풀세팅"
   → cleanTitle에도 정규화 적용

[비작업 포스트 판별]
본문이 다음에 해당하면 isNotice: true:
→ 휴무/공지/인사/이벤트/일상
→ 브레이크 작업이 아닌 경우 (휠튜닝, 서스펜션, 마케팅 영상, 부품 리뷰만 있는 글)
→ 실제 시공/정비 내용이 없는 경우 (POV영상, 허브스페이서만, 단순 소개)

isNotice: true일 때:
→ work.type: "공지", "휴무", "휠튜닝", "마케팅" 등 (해당하는 것으로, 영어 금지)
→ work.parts: []
→ keyPoints: []
→ work.challenge, solution, duration: null

그 외 실제 브레이크 작업 글이면:
→ isNotice: false

제목: ${post.title}
본문: ${bodyText.slice(0, 3000)}

JSON으로만 답하세요:
{"vehicle":{"brand":"","model":"","note":""},"work":{"type":"","parts":["부품1 문자열","부품2 문자열"],"challenge":"","solution":"","duration":""},"cleanTitle":"","keyPoints":[],"difficulty":"","isNotice":false,"reviewNeeded":false}
※ parts는 반드시 문자열 배열. 객체 배열({position, caliper, rotor} 등) 금지.`;

  return callClaude(prompt);
}

// 빌드 직후 인라인 검증
function quickValidate(ssot) {
  const warnings = [];
  const text = ssot.originalText || '';

  // 영어 필드 체크
  if (ssot.work?.type && /^[A-Za-z\s,]+$/.test(ssot.work.type)) {
    warnings.push(`work.type이 영어: "${ssot.work.type}"`);
  }

  // 번역체 체크
  const json = JSON.stringify(ssot);
  for (const term of BANNED_TERMS) {
    if (json.includes(term)) {
      warnings.push(`번역체 발견: "${term}"`);
    }
  }

  // 보일러플레이트 체크
  if (ssot.consumer?.conversionHook?.includes('16년') && !text.includes('16년')) {
    warnings.push('conversionHook에 원문에 없는 "16년" 삽입');
  }

  // parts 스키마 검증 — 문자열 배열이어야 함
  const parts = ssot.work?.parts;
  if (parts && Array.isArray(parts)) {
    const hasObject = parts.some(p => typeof p === 'object' && p !== null);
    if (hasObject) {
      warnings.push('work.parts에 객체 포함 — 문자열 배열이어야 함');
    }
  } else if (parts && !Array.isArray(parts)) {
    warnings.push('work.parts가 배열이 아님');
  }

  // difficulty 빈 문자열 → null 보정
  if (ssot.difficulty === '') {
    ssot.difficulty = null;
  }

  // vehicle.brand 원문 검증
  if (ssot.vehicle?.brand && text && !text.includes(ssot.vehicle.brand)) {
    // 영어 브랜드의 한글 변환도 체크
    const brandAliases = {
      'BMW': ['bmw','비엠더블유'], 'Audi': ['아우디','audi'], 'Benz': ['벤츠','benz','메르세데스'],
      'Hyundai': ['현대','hyundai'], 'Kia': ['기아','kia'], 'Genesis': ['제네시스','genesis'],
      'Infiniti': ['인피니티','infiniti'], 'Chevrolet': ['쉐보레','chevrolet'],
    };
    const aliases = brandAliases[ssot.vehicle.brand] || [ssot.vehicle.brand.toLowerCase()];
    const textLow = text.toLowerCase();
    if (!aliases.some(a => textLow.includes(a.toLowerCase()))) {
      warnings.push(`vehicle.brand "${ssot.vehicle.brand}" 원문에서 미발견`);
    }
  }

  return warnings;
}

async function processPost(uniquePost, segmentMap, imageManifest) {
  const k = uniquePost.keep;
  const outPath = path.join(ROOT, SSOT_DIR, `${k.postId}.json`);

  // 기존 파일 존재 시: force 모드가 아니면 skip, force면 이미지 데이터 보존
  let existingImages = null;
  if (await exists(outPath)) {
    if (!FORCE) return { status: 'skipped' };
    try {
      const existing = JSON.parse(await readFile(outPath, 'utf8'));
      existingImages = existing.images;
    } catch { /* ignore */ }
  }

  // segmented 데이터에서 원본 본문 가져오기
  const segData = segmentMap[k.contentId];
  const segPost = segData?.posts?.find(p => p.postId === k.postId);
  if (!segPost) return { status: 'no_segment' };

  const cleanLines = cleanBodyLines(segPost.bodyLines);
  const bodyText = cleanLines.join('\n');
  const titleClean = dedupeMirrorText(k.title);

  // 전문성 검증 (로컬)
  const validation = validateParts(bodyText + ' ' + titleClean);

  // 최소 콘텐츠 길이 검증 — 300자 미만이면 Claude 호출 스킵
  let structured;
  if (bodyText.length < 300) {
    structured = {
      vehicle: { brand: '', model: '', note: '' },
      work: { type: '짧은 글', parts: [], challenge: null, solution: null, duration: null },
      cleanTitle: titleClean,
      keyPoints: [],
      difficulty: null,
      isNotice: true,
      reviewNeeded: false,
    };
    process.stderr.write(`\n  ⓘ ${k.postId}: 본문 ${bodyText.length}자 — Claude 스킵`);
  } else {
    // Claude API로 구조화
    try {
      structured = await buildSsotWithClaude({ title: titleClean }, bodyText);
    } catch (err) {
      structured = { error: err.message };
    }
  }

  // 브랜드/차종 정규화
  if (structured.vehicle) {
    if (structured.vehicle.brand) structured.vehicle.brand = normalizeBrand(structured.vehicle.brand);
    if (structured.vehicle.model) structured.vehicle.model = normalizeModel(structured.vehicle.model);
  }

  // 이미지 목록
  const imgInfo = imageManifest[k.postId] || { done: false, count: 0, images: [] };

  const ssot = {
    postId:      k.postId,
    contentId:   k.contentId,
    originalUrl: uniquePost.url,
    publishedAt: k.publishedAt,
    sourcePdf:   k.sourceName,
    pageRange:   k.pageRange,
    title: {
      original: k.title,
      clean:    structured.cleanTitle || titleClean,
    },
    vehicle:    structured.vehicle    || {},
    work:       structured.work       || {},
    isNotice:   structured.isNotice   || false,
    keyPoints:  structured.keyPoints  || [],
    difficulty: structured.difficulty || '',
    originalText: bodyText,
    images: {
      count:     segPost.counts?.imageBlocks || existingImages?.count || 0,
      extracted: imgInfo.count || existingImages?.extracted || 0,
      dir:       imgInfo.done ? `output/images/${k.postId}` : (existingImages?.dir || null),
      files:     (imgInfo.images?.map(i => i.file) || []).length > 0
                 ? imgInfo.images.map(i => i.file)
                 : (existingImages?.files || []),
      positions: (segPost.imageBlocks || []).length > 0
                 ? segPost.imageBlocks
                 : (existingImages?.positions || []),
    },
    validation: {
      partsVerified: validation.verified,
      partsFound:    validation.partsFound,
      reviewNeeded:  structured.reviewNeeded || !validation.verified,
    },
    platforms: {
      naverBlog:  null,
      instagram:  null,
      daangn:     null,
    },
    generatedAt: new Date().toISOString(),
  };

  // 인라인 검증
  const warnings = quickValidate(ssot);
  if (warnings.length > 0) {
    ssot.validation.buildWarnings = warnings;
    process.stderr.write(`\n  ⚠ ${k.postId}: ${warnings.join('; ')}`);
  }

  await mkdir(path.join(ROOT, SSOT_DIR), { recursive: true });
  await writeFile(outPath, JSON.stringify(ssot, null, 2));
  return { status: 'ok' };
}

async function runBatch(items, concurrency) {
  const results = { ok: 0, skipped: 0, failed: 0, reviewNeeded: 0 };
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      if (LIMIT && results.ok + results.skipped >= LIMIT) break;
      const item = items[idx++];
      try {
        const r = await item();
        if (r.status === 'ok') { results.ok++; process.stdout.write('.'); }
        else if (r.status === 'skipped') { results.skipped++; process.stdout.write('s'); }
        else { results.failed++; process.stdout.write('?'); }
      } catch (err) {
        results.failed++;
        process.stdout.write('!');
      }
      if ((results.ok + results.skipped) % 50 === 0) {
        process.stdout.write(` ${results.ok + results.skipped}/${items.length}\n`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('SSOT 구조화 시작...\n');

  const uniqueData    = await loadJson(path.join(ROOT, UNIQUE_PATH), { uniquePosts: [] });
  const imageManifest = await loadJson(path.join(ROOT, IMAGE_MANIFEST), {});

  // segmented 파일 모두 로드 (메모리 캐시)
  console.log('segmented 데이터 로딩...');
  const segmentMap = {};
  const segFiles = await import('fs').then(fs =>
    fs.readdirSync(path.join(ROOT, SEGMENT_DIR)).filter(f => f.endsWith('.json'))
  );
  for (const f of segFiles) {
    const d = await loadJson(path.join(ROOT, SEGMENT_DIR, f), null);
    if (d) segmentMap[d.contentId] = d;
  }
  console.log(`${segFiles.length}개 PDF 세그먼트 로드 완료\n`);

  const posts = uniqueData.uniquePosts || [];
  const tasks = posts.map(p => () => processPost(p, segmentMap, imageManifest));

  const results = await runBatch(tasks, CONCURRENCY);

  console.log('\n\n=== 완료 ===');
  console.log(`생성: ${results.ok}건, 스킵: ${results.skipped}건, 실패: ${results.failed}건`);
  console.log(`저장 위치: ${SSOT_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
