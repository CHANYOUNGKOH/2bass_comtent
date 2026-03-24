/**
 * 단일 SSOT → 블로그 글 생성 (테스트용)
 * Usage: node scripts/_gen-one.js <postId>
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';

const ROOT = process.cwd();
const SSOT_DIR = 'data/ssot-posts';
const PUBLISH_DIR = 'data/publish/naver';
const MODEL = process.env.BLOG_MODEL || 'sonnet';
const postId = process.argv[2];
if (!postId) { console.error('Usage: node _gen-one.js <postId>'); process.exit(1); }

const CTA = {
  place: 'https://naver.me/5YFTD6H0',
  talk: 'https://talk.naver.com/ct/w19vvqt?frm=mnmb&frm=nmb_detail#nafullscreen',
  kakao: 'https://pf.kakao.com/_wHxdZX',
  store: 'https://smartstore.naver.com/2bassbrake',
  phone: '010-4150-3199',
};

async function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--model', MODEL, '--print'], { shell: true, env: { ...process.env } });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.stdin.write(prompt);
    proc.stdin.end();
    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 90000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`exit ${code}: ${stderr.slice(0,100)}`));
      const clean = stdout.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return reject(new Error('no JSON'));
      try { resolve(JSON.parse(m[0])); } catch(e) { reject(e); }
    });
  });
}

const ssot = JSON.parse(await readFile(path.join(ROOT, SSOT_DIR, `${postId}.json`), 'utf8'));
const v = ssot.vehicle || {};
const w = ssot.work || {};
const c = ssot.consumer || {};
const s = ssot.salesContext || {};
const dd = c.directDemand || {};
const ed = c.expandedDemand || [];

const consumerKeywords = [...(dd.searchQueries||[]), ...ed.flatMap(e=>e.searchQueries||[])].slice(0,8);
const expandedSegments = ed.map(e=>`- ${e.segment}: ${e.reason}`).join('\n');
const referralText = s.referral?.hasReferral ? `소개 경로: ${s.referral.source}${s.referral.sourceVehicle?' (차종: '+s.referral.sourceVehicle+')':''}` : '';
const specText = s.specComparison ? `순정: ${s.specComparison.before||'?'} → 튜닝: ${s.specComparison.after||'?'} / 체감: ${s.specComparison.improvement||''}` : '';
const crossSellText = (s.crossSell||[]).join(', ');
const freeServicesText = (s.freeServices||[]).join(', ');
const trustText = Array.isArray(s.trustSignal) ? s.trustSignal.join(' / ') : (s.trustSignal||'');

const prompt = `당신은 브레이크 전문 튜닝샵 "투베이스(2BASS)"의 블로그 마케터입니다.
16년 경력의 브레이크 전문점이 일산(고양시)에 있으며, 전국에서 고객이 찾아옵니다.

아래 작업 사례를 바탕으로 네이버 블로그 포스트를 새로 작성하세요.

[작업 정보]
- 차량: ${v.brand||''} ${v.model||''} ${v.note||''}
- 작업유형: ${w.type||''}
- 사용부품: ${(w.parts||[]).join(', ')}
- 고객 문제: ${w.challenge||''}
- 해결방법: ${w.solution||''}
- 작업시간: ${w.duration||''}
- 핵심포인트: ${(ssot.keyPoints||[]).join(' / ')}

[소비자 분석]
- 직접 수요: ${dd.who||''}
- 소비자 증상/불만: ${dd.symptom||''}
- 검색 키워드: ${consumerKeywords.join(', ')}
- 전환 포인트: ${c.conversionHook||''}
- 긴급도: ${c.urgency||''}
- 가격대: ${c.priceRange||''}
${expandedSegments?`- 확장 수요층:\n${expandedSegments}`:''}

[매출 전환 컨텍스트]
- 이 차종 투베이스 시공 횟수: ${s.modelCount||'?'}회 (전문성 증거로 활용)
${referralText?`- ${referralText} (입소문 신뢰 스토리로 활용)`:''}
${s.customerRegion?`- 고객 출발지: ${s.customerRegion} (전국구 신뢰)`:''}
${s.warranty?`- AS 보증: ${s.warranty} (안심 요소)`:''}
${specText?`- 스펙 비교: ${specText}`:''}
${crossSellText?`- 후속 작업 기회: ${crossSellText} (글 말미에 자연스럽게 언급)`:''}
${freeServicesText?`- 무료 서비스: ${freeServicesText} (가성비 어필)`:''}
${s.urgencySignal?`- 긴급성: ${s.urgencySignal}`:''}
${s.emotionalTrigger?`- 고객 감정: ${s.emotionalTrigger}`:''}
${trustText?`- 신뢰 요소: ${trustText}`:''}
${s.uniqueSellingPoint?`- 투베이스만의 차별점: ${s.uniqueSellingPoint}`:''}

[원본 본문 (참고용)]
${ssot.originalText?.slice(0,1500)||''}

[작성 규칙]
1. 제목: SEO 최적화. 소비자 검색 키워드 포함. "[차종] [증상/작업] - 일산 브레이크 전문 투베이스" 형식. 60자 이내.
2. 도입부(2-3문단): 소비자 증상/불만에서 시작. 공감 유도. 확장 수요층도 읽을 수 있게 보편적 문제의식.
3. 고객 상황: 왜 방문했는지. "나도 이런 상황인데" 공감. ${referralText?'입소문 스토리 포함.':''} (1-2문단)
4. 작업 내용: 기술 상세 설명. 순정 vs 튜닝 스펙 비교 포함. 일반 타이어샵과 차이점 부각. (2-3문단)
5. 결과: 개선 체감 + 고객 감정/반응. ${s.warranty?'AS 보증 언급.':''} (1문단)
6. 전문성 강조: ${s.modelCount?`"이 차종만 ${s.modelCount}회 시공"`:''} 실적 데이터 + "${c.conversionHook||'16년 전문'}" (1문단)
7. ${crossSellText?`후속 작업: "${crossSellText}" 자연스럽게 언급하여 재방문 유도.`:''}
8. CTA (하단 고정):
---CTA시작---
📞 전화 문의 → ${CTA.phone}
네이버 톡톡 문의 → ${CTA.talk}
카카오톡 문의 → ${CTA.kakao}
📅 네이버 예약 → ${CTA.place}
🛒 부품 구매 → ${CTA.store}
---CTA끝---
9. 해시태그: 최대 30개, 전체 합산 100자 이내 (네이버 제한). #브레이크튜닝 #파주브레이크 #일산브레이크 #투베이스 #2bass 필수. SEO 키워드는 본문에 자연어로 최대한 녹이고, 본문에 녹이지 못한 키워드만 해시태그로 추가.
10. 본문 600-1200자. 매출 전환 요소를 자연스럽게.
  - 단락 가독성: 2-3문장을 한 단락으로 묶고, 단락 사이에 빈 줄(\n\n) 하나. 문장 중간에 줄바꿈하지 말 것. 한 단락이 100자를 넘으면 빈 줄로 나눌 것.
11. 말투: ~합니다/입니다 체로 통일. 해요체 혼합 금지. 친근+전문적. 광고 지양. 실제 작업자 느낌.
12. 용어 표기: 브래킷(X) → 브라켓(O).
13. "처음", "첫 시공", "첫 번째" 등 경험 부족을 암시하는 표현 금지. 16년 경력 전문점이므로 모든 차종에 대해 자신감 있게 서술.

JSON으로만 출력:
{"title":"","body":"","cta":"","hashtags":[],"seoKeywords":[]}`;

console.log('생성 중...');
const generated = await callClaude(prompt);

await mkdir(path.join(ROOT, PUBLISH_DIR), { recursive: true });
const output = {
  postId: ssot.postId, originalUrl: ssot.originalUrl, vehicle: ssot.vehicle, work: ssot.work,
  naver: generated, generatedAt: new Date().toISOString(),
};
const outPath = path.join(ROOT, PUBLISH_DIR, `${postId}.json`);
await writeFile(outPath, JSON.stringify(output, null, 2));
console.log('완료:', outPath);
