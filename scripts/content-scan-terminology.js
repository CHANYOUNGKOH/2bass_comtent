#!/usr/bin/env node
/**
 * content-scan-terminology.js
 * SSOT 전체 번역체/영어 직역 용어 스캔 + 자동 치환
 *
 * Usage:
 *   node scripts/content-scan-terminology.js              # 리포트만 (dry-run)
 *   node scripts/content-scan-terminology.js --fix        # SSOT + 발행 JSON 자동 치환
 *   node scripts/content-scan-terminology.js --fix-ssot   # SSOT만 치환
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
const V2_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2');

// ── 번역체 → 자연스러운 한국어 매핑 ──
// severity: 'error' = 반드시 치환, 'warn' = 검토 필요
const TERM_MAP = [
  // ── error: 한국 자동차판에서 안 쓰는 번역체 ──
  { pattern: '크로스 모델', replace: '타차종', severity: 'error', note: '한국에서 "크로스 모델"은 안 씀' },
  { pattern: '크로스모델', replace: '타차종', severity: 'error', note: '붙여쓰기 변형' },
  { pattern: '크로스 피팅', replace: '타차종 장착', severity: 'error', note: '영어 직역' },
  { pattern: '크로스피팅', replace: '타차종 장착', severity: 'error', note: '영어 직역' },
  { pattern: '브레이킹 시스템', replace: '브레이크 시스템', severity: 'error', note: '"braking system" 직역' },
  { pattern: '하이퍼포먼스', replace: '고성능', severity: 'error', note: '"high performance" 직역' },
  { pattern: '하이 퍼포먼스', replace: '고성능', severity: 'error', note: '"high performance" 직역' },
  { pattern: '인터체인저블', replace: '호환', severity: 'error', note: '"interchangeable" 직역' },
  { pattern: '턴키', replace: '일괄', severity: 'error', note: '"turnkey" 직역 — 자동차판에서 안 씀' },
  { pattern: '레트로핏', replace: '개조 장착', severity: 'error', note: '"retrofit" 직역' },
  { pattern: '레트로 핏', replace: '개조 장착', severity: 'error', note: '"retrofit" 직역' },
  { pattern: '다이렉트 볼트', replace: '볼트온', severity: 'error', note: '"direct bolt" — 볼트온이 업계 표준' },
  { pattern: '다이렉트볼트', replace: '볼트온', severity: 'error', note: '"direct bolt" 직역' },
  { pattern: '다이렉트 피팅', replace: '바로 장착', severity: 'error', note: '"direct fitting" 직역' },
  { pattern: '다이렉트피팅', replace: '바로 장착', severity: 'error', note: '"direct fitting" 직역' },

  // ── warn: 번역체이나 문맥에 따라 OK일 수 있음 ──
  { pattern: '커스텀 솔루션', replace: '맞춤 작업', severity: 'warn', note: '"custom solution" — 맞춤 작업/맞춤 시공이 자연스러움' },
  { pattern: '토탈 솔루션', replace: '전체 작업', severity: 'warn', note: '"total solution" — 마케팅 용어' },
  { pattern: '맞춤형 솔루션', replace: '맞춤 작업', severity: 'warn', note: '"솔루션"이 번역체' },
  { pattern: '퍼포먼스 브레이크', replace: '고성능 브레이크', severity: 'warn', note: '"performance brake" — 업계에서 간혹 쓰긴 함' },
  { pattern: '인하우스', replace: '자체', severity: 'warn', note: '"in-house" — "자체 제작/현장 가공"이 자연스러움' },
  { pattern: '시스템 업그레이드', replace: '업그레이드', severity: 'warn', note: '"시스템"이 불필요한 경우 많음' },
  { pattern: '올인원', replace: '일체형', severity: 'warn', note: '문맥에 따라 다름' },
  { pattern: '풀 커스텀', replace: '전면 맞춤', severity: 'warn', note: '"full custom" — 맞춤 시공이 자연스러움' },
  { pattern: '풀커스텀', replace: '전면 맞춤', severity: 'warn', note: '붙여쓰기 변형' },
];

// ── 스캔 ──

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const hits = [];

  for (const term of TERM_MAP) {
    const re = new RegExp(term.pattern, 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      // 주변 컨텍스트 추출 (앞뒤 30자)
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      const context = text.substring(start, end).replace(/\n/g, ' ');
      hits.push({
        file: fileName,
        term: term.pattern,
        replace: term.replace,
        severity: term.severity,
        note: term.note,
        context,
      });
    }
  }
  return hits;
}

function fixFile(filePath, severities) {
  let text = fs.readFileSync(filePath, 'utf8');
  let changes = 0;

  for (const term of TERM_MAP) {
    if (!severities.includes(term.severity)) continue;
    const re = new RegExp(term.pattern, 'g');
    const count = (text.match(re) || []).length;
    if (count > 0) {
      text = text.replace(re, term.replace);
      changes += count;
    }
  }

  if (changes > 0) {
    fs.writeFileSync(filePath, text, 'utf8');
  }
  return changes;
}

// ── Main ──

function main() {
  const args = process.argv.slice(2);
  const doFix = args.includes('--fix');
  const doFixSsot = args.includes('--fix-ssot');
  const fixMode = doFix ? 'all' : doFixSsot ? 'ssot' : null;

  // Scan SSOT
  const ssotFiles = fs.readdirSync(SSOT_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => path.join(SSOT_DIR, f));

  console.log(`\n📋 SSOT 번역체 스캔: ${ssotFiles.length}개 파일\n`);

  const allHits = [];
  for (const f of ssotFiles) {
    const hits = scanFile(f);
    allHits.push(...hits);
  }

  if (allHits.length === 0) {
    console.log('✅ 번역체 없음!');
    return;
  }

  // 요약: 용어별 집계
  const summary = {};
  for (const h of allHits) {
    const key = h.term;
    if (!summary[key]) summary[key] = { ...h, count: 0, files: new Set() };
    summary[key].count++;
    summary[key].files.add(h.file);
  }

  console.log('═══ 번역체 용어 요약 ═══\n');
  console.log(`${'용어'.padEnd(20)} ${'→ 치환'.padEnd(16)} ${'건수'.padStart(5)} ${'파일수'.padStart(5)}  등급   비고`);
  console.log('─'.repeat(95));

  const sorted = Object.values(summary).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return b.count - a.count;
  });

  let errorCount = 0;
  let warnCount = 0;

  for (const s of sorted) {
    const icon = s.severity === 'error' ? '❌' : '⚠️';
    if (s.severity === 'error') errorCount += s.count;
    else warnCount += s.count;
    console.log(`${icon} ${s.term.padEnd(18)} → ${s.replace.padEnd(12)} ${String(s.count).padStart(5)} ${String(s.files.size).padStart(5)}  ${s.note}`);
  }

  console.log('─'.repeat(95));
  console.log(`합계: ❌ error ${errorCount}건 / ⚠️ warn ${warnCount}건 (총 ${allHits.length}건, ${new Set(allHits.map(h => h.file)).size}개 파일)\n`);

  // 샘플 컨텍스트 (error만 최대 10개)
  const errorHits = allHits.filter(h => h.severity === 'error').slice(0, 10);
  if (errorHits.length > 0) {
    console.log('═══ error 샘플 컨텍스트 ═══\n');
    for (const h of errorHits) {
      console.log(`  ${h.file}`);
      console.log(`    ...${h.context}...`);
      console.log(`    "${h.term}" → "${h.replace}"\n`);
    }
  }

  // Fix mode
  if (fixMode) {
    console.log(`\n🔧 치환 모드: ${fixMode === 'all' ? 'SSOT + 발행 JSON' : 'SSOT만'}`);
    console.log('   error 등급만 자동 치환합니다 (warn은 수동 검토 필요)\n');

    let totalFixed = 0;
    let filesFixed = 0;

    // Fix SSOT
    for (const f of ssotFiles) {
      const n = fixFile(f, ['error']);
      if (n > 0) {
        filesFixed++;
        totalFixed += n;
        console.log(`  ✅ ${path.basename(f)}: ${n}건 치환`);
      }
    }

    // Fix publish JSONs (naver-v2)
    if (fixMode === 'all' && fs.existsSync(V2_DIR)) {
      const v2Files = fs.readdirSync(V2_DIR)
        .filter(f => f.endsWith('.json') && !f.startsWith('_'))
        .map(f => path.join(V2_DIR, f));

      for (const f of v2Files) {
        const n = fixFile(f, ['error']);
        if (n > 0) {
          filesFixed++;
          totalFixed += n;
          console.log(`  ✅ ${path.basename(f)}: ${n}건 치환`);
        }
      }
    }

    console.log(`\n🎯 치환 완료: ${totalFixed}건 (${filesFixed}개 파일)`);
    console.log('⚠️  warn 등급은 수동 검토가 필요합니다. --fix 없이 다시 실행하여 확인하세요.\n');
  } else {
    console.log('💡 자동 치환: node scripts/content-scan-terminology.js --fix');
    console.log('   (error 등급만 치환, warn은 리포트만)\n');
  }
}

main();
