/**
 * 블로그 생성 품질 수정 검증 스크립트
 * API 호출 없이 프롬프트/CTA 출력만 확인
 *
 * 실행: node scripts/_test-blog-fixes.js
 */
import { CTA, buildMultiCTA } from './_content-shared.js';

// ── 테스트용 mock 함수 (content-generate-naver-blog.js 내부 함수 재현) ──

function buildImageContext(ssot) {
  const positions = ssot.images?.positions || [];
  const files = ssot.images?.files || [];
  const imgCount = ssot.images?.count || 0;
  const count = Math.max(positions.length, files.length, imgCount);
  if (count === 0) return '';
  const lines = [];
  for (let i = 0; i < count; i++) {
    const prev = positions[i]?.prevText;
    const desc = prev ? `— 관련 내용: "${prev}"` : '';
    lines.push(`[사진${i + 1}] ${desc}`);
  }
  return `\n━━━ 이미지 ${count}장 — 본문에 배치 ━━━\n${lines.join('\n')}\n`;
}

function buildImageBlock(imageContext) {
  if (imageContext) {
    return `<images>\n${imageContext}</images>\n<image_captions>캡션 지시...</image_captions>`;
  }
  return `<no_images>\n이 포스트에는 이미지가 없습니다. [사진N], 📷, ▲ 캡션 등 이미지 관련 마커를 절대 삽입하지 마세요.\n</no_images>`;
}

const CTA_LEADINS = {
  case_study: '비슷한 증상이라면 정확한 진단이 먼저입니다.',
};

function buildContextualCTA(postType, hasParts) {
  const leadin = CTA_LEADINS[postType] || CTA_LEADINS.case_study;
  let block = `${leadin}\n\n`;
  block += `📞 전화 문의 → ${CTA.phone}\n`;
  block += `네이버 톡톡 문의 → ${CTA.talk}\n`;
  block += `카카오톡 문의 → ${CTA.kakao}\n`;
  block += `📅 네이버 예약 → ${CTA.place}\n`;
  if (hasParts) block += `🛒 부품 구매 → ${CTA.store}\n`;
  return block;
}

// ══════════════════════════════════════
// 테스트 실행
// ══════════════════════════════════════
let pass = 0, fail = 0;

function assert(label, condition) {
  if (condition) { console.log(`  ✅ ${label}`); pass++; }
  else           { console.log(`  ❌ ${label}`); fail++; }
}

// ── 테스트 1: 이미지 0개 ──
console.log('\n═══ 테스트 1: 이미지 0개 ═══');
const ssot0 = { images: { count: 0, files: [], positions: [] } };
const ctx0 = buildImageContext(ssot0);
const block0 = buildImageBlock(ctx0);
assert('imageContext 빈 문자열', ctx0 === '');
assert('<no_images> 블록 생성', block0.includes('<no_images>'));
assert('절대 삽입하지 마세요 포함', block0.includes('절대 삽입하지 마세요'));
assert('[사진1] 마커 없음 (금지 안내문의 [사진N]은 OK)', !block0.includes('[사진1]'));

// ── 테스트 2: images 필드 자체가 없음 ──
console.log('\n═══ 테스트 2: images 필드 없음 ═══');
const ssotNone = {};
const ctxNone = buildImageContext(ssotNone);
assert('imageContext 빈 문자열', ctxNone === '');
assert('<no_images> 블록', buildImageBlock(ctxNone).includes('<no_images>'));

// ── 테스트 3: count=8, files/positions 비어있음 ──
console.log('\n═══ 테스트 3: count=8, files/positions 빈 배열 ═══');
const ssot8 = { images: { count: 8, files: [], positions: [] } };
const ctx8 = buildImageContext(ssot8);
const block8 = buildImageBlock(ctx8);
assert('imageContext 비어있지 않음', ctx8 !== '');
assert('8장 표기', ctx8.includes('8장'));
assert('[사진1] 존재', ctx8.includes('[사진1]'));
assert('[사진8] 존재', ctx8.includes('[사진8]'));
assert('[사진9] 없음', !ctx8.includes('[사진9]'));
assert('<images> 블록 생성', block8.includes('<images>'));
assert('<image_captions> 포함', block8.includes('<image_captions>'));

// ── 테스트 4: count=3, positions에 prevText 있음 ──
console.log('\n═══ 테스트 4: count=3 + positions ═══');
const ssot3 = { images: { count: 3, files: ['a.jpg','b.jpg'], positions: [{ prevText: '패드 교체' }] } };
const ctx3 = buildImageContext(ssot3);
assert('3장 (count 우선)', ctx3.includes('3장'));
assert('[사진1] 관련 내용 포함', ctx3.includes('관련 내용: "패드 교체"'));
assert('[사진2] 제네릭', ctx3.includes('[사진2]'));
assert('[사진3] 제네릭', ctx3.includes('[사진3]'));

// ── 테스트 5: Blog2 CTA — 테이블형 ──
console.log('\n═══ 테스트 5: Blog2 CTA 테이블형 ═══');
const ctaBlog2 = buildContextualCTA('case_study', true);
assert('📞 포함', ctaBlog2.includes('📞'));
assert('톡톡 URL 포함', ctaBlog2.includes(CTA.talk));
assert('카카오톡 포함', ctaBlog2.includes(CTA.kakao));
assert('📅 예약 포함', ctaBlog2.includes('📅'));
assert('🛒 부품 구매 포함 (hasParts=true)', ctaBlog2.includes('🛒'));

// ── 테스트 6: Blog2 CTA — 부품 없음 ──
console.log('\n═══ 테스트 6: Blog2 CTA 부품 없음 ═══');
const ctaNoParts = buildContextualCTA('case_study', false);
assert('🛒 없음 (hasParts=false)', !ctaNoParts.includes('🛒'));
assert('나머지 CTA는 있음', ctaNoParts.includes('📞') && ctaNoParts.includes('📅'));

// ── 테스트 7: buildMultiCTA — transactional fullCTA 테이블형 ──
console.log('\n═══ 테스트 7: buildMultiCTA transactional ═══');
const ssotTxn = { originalText: '브렘보 캘리퍼 장착', work: { type: '캘리퍼 장착', parts: ['브렘보 4P'] } };
const multiTxn = buildMultiCTA(ssotTxn, 'transactional');
assert('fullCTA에 📞 포함', multiTxn.fullCTA.includes('📞'));
assert('fullCTA에 카카오톡 포함', multiTxn.fullCTA.includes(CTA.kakao));
assert('fullCTA에 🛒 포함 (부품 있음)', multiTxn.fullCTA.includes('🛒'));
assert('softCTA 존재', multiTxn.softCTA.length > 0);
assert('midCTA에 톡톡 URL', multiTxn.midCTA.includes(CTA.talk));

// ── 테스트 8: buildMultiCTA — informational fullCTA ──
console.log('\n═══ 테스트 8: buildMultiCTA informational ═══');
const ssotInfo = { originalText: '브레이크 떨림 점검', work: { type: '점검', parts: [] } };
const multiInfo = buildMultiCTA(ssotInfo, 'informational');
assert('fullCTA에 📞 포함', multiInfo.fullCTA.includes('📞'));
assert('fullCTA에 🛒 없음 (부품 없음)', !multiInfo.fullCTA.includes('🛒'));

// ── 결과 ──
console.log(`\n══════════════════════════`);
console.log(`결과: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
