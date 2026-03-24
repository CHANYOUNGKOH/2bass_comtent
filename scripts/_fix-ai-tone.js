#!/usr/bin/env node
/**
 * _fix-ai-tone.js
 * 기존 V2 JSON body의 AI 느낌 후처리
 * - 안녕하세요 인사 제거
 * - ─── 구분선 ─── → ■ 섹션 통일
 * - ** strip
 * - 과장 형용사 완화
 * - 수사적 질문 도입 완화
 * - ~입니다/합니다 일부 → ~요/~죠/~거든요 전환 (안전한 패턴만)
 * - 투베이스 자기 언급 과다 정리
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const V2_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2');

function fixBody(body) {
  let text = body;

  // 1. Strip **bold**
  text = text.replace(/\*\*/g, '');

  // 2. ─── 구분선 ─── → ■ 헤더로 통일
  //    "─── 고객 상황 ───" → "■ 고객 상황"
  text = text.replace(/─{2,}\s*(.+?)\s*─{2,}/g, '■ $1');
  //    "━━ 제목 ━━" → "■ 제목"
  text = text.replace(/━{2,}\s*(.+?)\s*━{2,}/g, '■ $1');

  // 3. (안녕하세요 도입부 — 삭제 로직 제거됨, 브랜드 인지를 위해 유지)

  // 4. 과장 형용사 완화
  const adjReplacements = [
    [/완벽한 /g, ''],
    [/완벽하게 /g, '잘 '],
    [/탁월한 /g, '좋은 '],
    [/탁월합니다/g, '좋습니다'],
    [/뛰어난 성능/g, '좋은 성능'],
    [/뛰어납니다/g, '좋습니다'],
    [/최적의 /g, '알맞은 '],
    [/최고의 /g, '좋은 '],
    [/확실한 /g, ''],
    [/확실하게 /g, ''],
    [/철저한 /g, '꼼꼼한 '],
    [/철저하게 /g, '꼼꼼하게 '],
    [/압도적인 /g, '확실한 '],
    [/놀라운 /g, ''],
    [/극적으로 /g, '확실히 '],
  ];
  for (const [pat, rep] of adjReplacements) {
    text = text.replace(pat, rep);
  }

  // 5. 수사적 질문 도입부 완화
  //    "경험해보셨나요?" → "경험해보신 분들이 많습니다."
  //    "느껴보신 적 있으신가요?" → "느껴보신 적 있을 겁니다."
  text = text.replace(/경험해보셨나요\?/g, '경험해보신 분들이 꽤 있습니다.');
  text = text.replace(/느껴보신 적 있으신가요\?/g, '느껴보신 적 있을 겁니다.');
  text = text.replace(/알고 계셨나요\?/g, '알아두시면 좋습니다.');
  text = text.replace(/그렇지 않으신가요\?/g, '그런 분들이 많습니다.');

  // 6. (비활성화) ~입니다/합니다 → ~해요 혼합 변환 제거
  //    사용자 피드백: 문체 혼합(합니다↔해요)이 AI 느낌을 줌
  //    → ~합니다/입니다 체로 통일 유지

  // 6-1. 용어 교정: 브래킷 → 브라켓
  text = text.replace(/브래킷/g, '브라켓');

  // 7. 투베이스 과다 자기 PR 완화
  let tubaseCount = 0;
  text = text.replace(/저희 투베이스/g, () => {
    tubaseCount++;
    return tubaseCount > 2 ? '저희' : '저희 투베이스';
  });

  // 자기소개 패턴 제거 (다양한 형태)
  text = text.replace(/투베이스\(2BASS\)는[^.]*전문[^.]*샵입니다\.\s*\n?/g, '');
  text = text.replace(/투베이스\(2BASS\)는[^.]*튜닝을[^.]*입니다\.\s*\n?/g, '');
  // "~ 투베이스가 전국 각지에서 고객이 찾아오는 이유 중 하나입니다" 같은 PR 문장 완화
  text = text.replace(/투베이스가 전국[^.]*입니다\./g, '이런 부분이 전문점의 강점이죠.');

  // 8. 잔여 정리
  //    연속 빈줄 2개 이상 → 1개로
  text = text.replace(/\n{3,}/g, '\n\n');
  //    앞뒤 공백 정리
  text = text.trim();

  return text;
}

function fixTitle(title) {
  // 제목에서 — 대시 제거
  return title.replace(/\s*—\s*/g, ' | ').replace(/\s{2,}/g, ' ').trim();
}

function main() {
  const jsonFiles = fs.readdirSync(V2_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort();

  console.log(`V2 JSON ${jsonFiles.length}개 후처리 시작...\n`);

  let totalChanges = 0;

  for (const f of jsonFiles) {
    const filePath = path.join(V2_DIR, f);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const origBody = data.naver.body;
    const origTitle = data.naver.title;

    data.naver.body = fixBody(origBody);
    data.naver.title = fixTitle(origTitle);

    const bodyChanged = data.naver.body !== origBody;
    const titleChanged = data.naver.title !== origTitle;

    if (bodyChanged || titleChanged) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      totalChanges++;

      const changes = [];
      if (bodyChanged) {
        const diff = origBody.length - data.naver.body.length;
        changes.push(`body ${diff > 0 ? '-' : '+'}${Math.abs(diff)}자`);
      }
      if (titleChanged) changes.push('title');
      console.log(`  ✏️  ${data.postId} (${changes.join(', ')})`);
    } else {
      console.log(`  ⏭  ${data.postId} (변경 없음)`);
    }
  }

  console.log(`\n완료: ${totalChanges}/${jsonFiles.length}개 수정됨`);
}

main();
