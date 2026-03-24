/**
 * content-validate-ssot.js
 * SSOT 파일의 핵심 필드값이 originalText에 실제 등장하는지 검증
 * 허위/과장된 SSOT 데이터(fabrication) 탐지용
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
const OUTPUT_PATH = path.join(ROOT, 'data', 'publish', 'ssot-validation-report.json');
const QUICK_MODE = process.argv.includes('--quick');

// ---------------------------------------------------------------------------
// 제외할 조사/접속사 (단독 토큰으로 걸러낼 단어들)
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  '의', '을', '를', '이', '가', '에', '에서', '으로', '로', '는', '은',
  '도', '와', '과', '및', '또는', '그리고', '하는', '하여', '위한', '통해',
  '대한', '있는', '없는', '위해', '통한', '하고', '하며', '하면', '있어',
  '없어', '되는', '된다', '하다', '됩니다', '합니다', '입니다', '습니다',
  '같은', '이런', '저런', '이후', '이전', '경우', '때문', '따라', '관련',
  '기반', '방식', '수준', '정도', '부분', '상황', '내용', '기준', '적인',
]);

// ---------------------------------------------------------------------------
// 기본 자동차 분류 용어 — originalText에 없어도 OK (카테고리 표현)
// ---------------------------------------------------------------------------
const ALLOWED_ABSENT = new Set([
  '브레이크', '캘리퍼', '디스크', '패드', '로터', '교체', '업그레이드',
  '장착', '시공', '튜닝', '인스톨', '설치', '작업', '수리', '점검',
  '부품', '차량', '자동차', '서비스', '전문', '전문점', '전문샵',
]);

// ---------------------------------------------------------------------------
// 토크나이저: 필드값 → 핵심 명사 후보 추출
// ---------------------------------------------------------------------------

/**
 * 텍스트를 핵심 명사구 후보 배열로 변환
 * 전략:
 *   1. 원문 전체를 하나의 후보로 추가 (단, 너무 긴 경우 제외)
 *   2. 구두점·공백으로 분절 후 2자 이상 한국어/영숫자 토큰 추출
 *   3. STOP_WORDS 제거
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];

  const candidates = new Set();

  // 구두점 및 공백으로 분리
  const chunks = text.split(/[\s,·\-+/()（）【】「」『』《》<>:：;；。、！!？?~·•·\n\t]+/);

  for (const chunk of chunks) {
    const t = chunk.trim();
    if (!t) continue;

    // 길이 2~15자이고 STOP_WORDS가 아니며 순수 숫자만은 아닌 것
    if (t.length >= 2 && t.length <= 15 && !STOP_WORDS.has(t) && !/^\d+$/.test(t)) {
      candidates.add(t);
    }

    // 한글 연속 시퀀스 추출 (2자 이상)
    const korMatches = t.match(/[가-힣]{2,}/g) || [];
    for (const m of korMatches) {
      if (!STOP_WORDS.has(m) && m.length >= 2 && m.length <= 15) {
        candidates.add(m);
      }
    }

    // 영문+숫자 혼합 토큰 (예: 4P, 355mm, EQ900)
    const engMatches = t.match(/[A-Za-z0-9]{2,}/g) || [];
    for (const m of engMatches) {
      if (m.length >= 2) candidates.add(m);
    }
  }

  // 원문 자체도 후보로 추가 (10자 이내일 때만 — 짧은 USP 키워드)
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length >= 2 && cleaned.length <= 20 && !STOP_WORDS.has(cleaned)) {
    candidates.add(cleaned);
  }

  return [...candidates];
}

// ---------------------------------------------------------------------------
// 필드 추출: SSOT JSON → { phrase, field }[] 목록
// ---------------------------------------------------------------------------
function extractPhrases(ssot) {
  const result = [];

  function add(phrase, field) {
    const p = phrase?.trim();
    if (!p || p.length < 2) return;
    result.push({ phrase: p, field });
  }

  // work.type
  if (ssot.work?.type) {
    for (const t of tokenize(ssot.work.type)) add(t, 'work.type');
  }

  // work.detail (현재 데이터에 없지만 미래 호환)
  if (ssot.work?.detail) {
    for (const t of tokenize(ssot.work.detail)) add(t, 'work.detail');
  }

  // work.parts (배열, 각 항목은 문자열 또는 { name } 객체)
  const workParts = ssot.work?.parts || [];
  for (const p of workParts) {
    const partStr = typeof p === 'string' ? p : p?.name;
    if (partStr) {
      for (const t of tokenize(partStr)) add(t, 'work.parts');
    }
  }

  // parts[].name (최상위 parts 배열 — 미래 호환)
  const topParts = ssot.parts || [];
  for (const p of topParts) {
    const partStr = typeof p === 'string' ? p : p?.name;
    if (partStr) {
      for (const t of tokenize(partStr)) add(t, 'parts[].name');
    }
  }

  // salesContext.uniqueSellingPoint
  if (ssot.salesContext?.uniqueSellingPoint) {
    for (const t of tokenize(ssot.salesContext.uniqueSellingPoint)) {
      add(t, 'salesContext.uniqueSellingPoint');
    }
  }

  // salesContext.trustSignal[]
  const trust = ssot.salesContext?.trustSignal;
  if (Array.isArray(trust)) {
    for (const item of trust) {
      if (typeof item === 'string') {
        for (const t of tokenize(item)) add(t, 'salesContext.trustSignal');
      }
    }
  } else if (typeof trust === 'string') {
    for (const t of tokenize(trust)) add(t, 'salesContext.trustSignal');
  }

  // consumer.conversionHook
  if (ssot.consumer?.conversionHook) {
    for (const t of tokenize(ssot.consumer.conversionHook)) {
      add(t, 'consumer.conversionHook');
    }
  }

  // consumer.segment (미래 호환)
  if (ssot.consumer?.segment) {
    for (const t of tokenize(ssot.consumer.segment)) add(t, 'consumer.segment');
  }

  // marketing.angle (미래 호환)
  if (ssot.marketing?.angle) {
    for (const t of tokenize(ssot.marketing.angle)) add(t, 'marketing.angle');
  }

  return result;
}

// ---------------------------------------------------------------------------
// 단일 파일 검증
// ---------------------------------------------------------------------------
function validateFile(ssot) {
  const originalText = ssot.originalText || '';

  const allPhrases = extractPhrases(ssot);

  // 중복 제거 (phrase+field 조합 기준)
  const seen = new Set();
  const unique = allPhrases.filter(({ phrase, field }) => {
    const key = `${field}::${phrase}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const ungrounded = [];
  let groundedCount = 0;

  for (const { phrase, field } of unique) {
    // ALLOWED_ABSENT는 기본 분류 용어 — fabrication으로 치지 않음
    if (ALLOWED_ABSENT.has(phrase)) {
      groundedCount++;
      continue;
    }

    if (originalText.includes(phrase)) {
      groundedCount++;
    } else {
      ungrounded.push({ phrase, field });
    }
  }

  const total = unique.length;
  const ungroundedCount = ungrounded.length;
  const ratio = total > 0 ? ungroundedCount / total : 0;

  return {
    postId: ssot.postId,
    vehicle: `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim(),
    totalPhrases: total,
    ungroundedCount,
    fabricationRatio: ratio,
    ungrounded,
  };
}

// ---------------------------------------------------------------------------
// Quick 검증: 번역체/영어/보일러플레이트만 빠르게 체크
// ---------------------------------------------------------------------------
const BANNED_TERMS = [
  '크로스 모델', '크로스모델', '브레이킹 시스템', '하이퍼포먼스',
  '턴키', '커스텀 솔루션', '토탈 솔루션', '퍼포먼스 브레이크',
  '시스템 업그레이드', '프리미엄 퍼포먼스',
];

function quickValidateFile(ssot) {
  const warnings = [];
  const text = ssot.originalText || '';
  const json = JSON.stringify(ssot);

  // 영어 work.type 체크
  if (ssot.work?.type && /^[A-Za-z\s,]+$/.test(ssot.work.type)) {
    warnings.push({ type: 'english_field', field: 'work.type', value: ssot.work.type });
  }

  // 영어 work.parts 체크
  for (const part of (ssot.work?.parts || [])) {
    const p = typeof part === 'string' ? part : part?.name;
    if (p && /^[A-Za-z\s,]+$/.test(p)) {
      warnings.push({ type: 'english_field', field: 'work.parts', value: p });
    }
  }

  // 번역체 체크
  for (const term of BANNED_TERMS) {
    if (json.includes(term)) {
      warnings.push({ type: 'banned_term', term });
    }
  }

  // 보일러플레이트 체크
  if (ssot.consumer?.conversionHook?.includes('16년') && !text.includes('16년')) {
    warnings.push({ type: 'boilerplate', field: 'consumer.conversionHook', detail: '원문에 없는 "16년"' });
  }
  if (ssot.salesContext?.trustSignal) {
    const ts = typeof ssot.salesContext.trustSignal === 'string'
      ? ssot.salesContext.trustSignal
      : JSON.stringify(ssot.salesContext.trustSignal);
    if (ts.includes('16년') && !text.includes('16년')) {
      warnings.push({ type: 'boilerplate', field: 'salesContext.trustSignal', detail: '원문에 없는 "16년"' });
    }
  }

  return warnings;
}

function runQuickMode(files) {
  console.log('=== SSOT Quick 검증 (번역체/영어/보일러플레이트) ===\n');

  let totalWarnings = 0;
  const fileWarnings = [];

  for (const file of files) {
    const filePath = path.join(SSOT_DIR, file);
    let ssot;
    try { ssot = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { continue; }

    const warnings = quickValidateFile(ssot);
    if (warnings.length > 0) {
      totalWarnings += warnings.length;
      fileWarnings.push({ postId: ssot.postId || file, warnings });
    }
  }

  console.log(`검사 파일: ${files.length}개`);
  console.log(`문제 파일: ${fileWarnings.length}개`);
  console.log(`총 경고: ${totalWarnings}건\n`);

  for (const { postId, warnings } of fileWarnings.slice(0, 50)) {
    console.log(`  ${postId}:`);
    for (const w of warnings) {
      if (w.type === 'english_field') console.log(`    [영어] ${w.field}: "${w.value}"`);
      else if (w.type === 'banned_term') console.log(`    [번역체] "${w.term}"`);
      else if (w.type === 'boilerplate') console.log(`    [보일러플레이트] ${w.field}: ${w.detail}`);
    }
  }

  if (fileWarnings.length > 50) {
    console.log(`\n  ... 외 ${fileWarnings.length - 50}개 파일`);
  }

  console.log('\n=== Quick 검증 완료 ===');
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== SSOT 검증 시작 ===\n');

  // SSOT 디렉토리 확인
  if (!fs.existsSync(SSOT_DIR)) {
    console.error(`오류: SSOT 디렉토리를 찾을 수 없습니다 → ${SSOT_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SSOT_DIR).filter(f => f.endsWith('.json'));
  console.log(`파일 수: ${files.length}개\n`);

  // --quick 모드: 경량 검증만 수행
  if (QUICK_MODE) {
    runQuickMode(files);
    return;
  }

  const results = [];
  let parseErrors = 0;

  for (const file of files) {
    const filePath = path.join(SSOT_DIR, file);
    let ssot;
    try {
      ssot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      parseErrors++;
      continue;
    }

    if (!ssot.originalText) continue; // originalText 없으면 검증 불가

    const result = validateFile(ssot);
    results.push(result);
  }

  if (results.length === 0) {
    console.error('검증 가능한 파일이 없습니다.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 통계 계산
  // ---------------------------------------------------------------------------
  const totalFiles = results.length;
  const avgRatio = results.reduce((s, r) => s + r.fabricationRatio, 0) / totalFiles;

  // 분포 버킷
  const buckets = { '0%': 0, '1-20%': 0, '21-40%': 0, '41-60%': 0, '61-80%': 0, '81-100%': 0 };
  for (const r of results) {
    const pct = r.fabricationRatio * 100;
    if (pct === 0) buckets['0%']++;
    else if (pct <= 20) buckets['1-20%']++;
    else if (pct <= 40) buckets['21-40%']++;
    else if (pct <= 60) buckets['41-60%']++;
    else if (pct <= 80) buckets['61-80%']++;
    else buckets['81-100%']++;
  }

  // 가장 fabrication 비율 높은 50개
  const top50 = [...results]
    .sort((a, b) => b.fabricationRatio - a.fabricationRatio)
    .slice(0, 50);

  // 전체에서 가장 자주 등장하는 ungrounded 구문 30개
  const phraseFreq = new Map();
  for (const r of results) {
    for (const { phrase, field } of r.ungrounded) {
      const key = phrase;
      if (!phraseFreq.has(key)) phraseFreq.set(key, { phrase, count: 0, fields: new Set() });
      phraseFreq.get(key).count++;
      phraseFreq.get(key).fields.add(field);
    }
  }
  const top30Phrases = [...phraseFreq.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
    .map(({ phrase, count, fields }) => ({ phrase, count, fields: [...fields] }));

  // ---------------------------------------------------------------------------
  // 콘솔 출력
  // ---------------------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  요약 통계');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  검증 파일 수  : ${totalFiles.toLocaleString()}개`);
  console.log(`  파싱 오류     : ${parseErrors}개`);
  console.log(`  평균 fabrication 비율 : ${(avgRatio * 100).toFixed(1)}%`);
  console.log('\n  비율 분포:');
  for (const [label, count] of Object.entries(buckets)) {
    const bar = '█'.repeat(Math.round(count / totalFiles * 40));
    console.log(`    ${label.padEnd(10)} ${String(count).padStart(5)}개  ${bar}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Fabrication 상위 50개 파일');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (let i = 0; i < top50.length; i++) {
    const r = top50[i];
    const pct = (r.fabricationRatio * 100).toFixed(0);
    console.log(`\n  [${String(i + 1).padStart(2)}] ${r.postId}`);
    console.log(`       차량: ${r.vehicle || '알 수 없음'}`);
    console.log(`       비율: ${pct}%  (미근거 ${r.ungroundedCount}/${r.totalPhrases})`);
    if (r.ungrounded.length > 0) {
      // 필드별로 그룹핑해서 출력
      const byField = new Map();
      for (const { phrase, field } of r.ungrounded) {
        if (!byField.has(field)) byField.set(field, []);
        byField.get(field).push(phrase);
      }
      for (const [field, phrases] of byField) {
        const preview = phrases.slice(0, 8).join(', ') + (phrases.length > 8 ? ` 외 ${phrases.length - 8}개` : '');
        console.log(`       [${field}] ${preview}`);
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  시스템적으로 자주 발생하는 미근거 구문 TOP 30');
  console.log('  (SSOT 빌더의 과장/추론 패턴 지표)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (let i = 0; i < top30Phrases.length; i++) {
    const { phrase, count, fields } = top30Phrases[i];
    console.log(`  ${String(i + 1).padStart(2)}. "${phrase}"  ${count}건  [${fields.join(', ')}]`);
  }

  // ---------------------------------------------------------------------------
  // JSON 리포트 저장
  // ---------------------------------------------------------------------------
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalFiles,
      parseErrors,
      avgFabricationRatio: avgRatio,
      distribution: buckets,
    },
    top50MostFabricated: top50,
    top30CommonUngroundedPhrases: top30Phrases,
    allResults: results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n  상세 결과 저장 → ${OUTPUT_PATH}`);
  console.log('\n=== 검증 완료 ===');
}

main().catch(err => {
  console.error('오류:', err);
  process.exit(1);
});
