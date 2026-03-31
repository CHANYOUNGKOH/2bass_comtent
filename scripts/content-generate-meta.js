#!/usr/bin/env node
/**
 * content-generate-meta.js
 * SSOT → IG/FB 플랫폼별 캡션 JSON 생성 (Claude API, 1회 호출로 2벌)
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
  loadKeywordVolumeCache,
} from './_content-shared.js';

const ROOT        = process.cwd();
const SSOT_DIR    = 'data/ssot-posts';
const PUBLISH_DIR = 'data/publish/meta';
const LIMIT       = Number(process.env.BLOG_LIMIT || 0);
const CONCURRENCY = Number(process.env.BLOG_CONCURRENCY || 10);
const MODEL       = process.env.BLOG_MODEL || 'sonnet';

// ── 앵글별 서술 지시 (SSOT selectAngle 결과에 따라 분기) ──
const ANGLE_DIRECTIVES = {
  symptom: `[문제해결 앵글]
고객이 느꼈던 증상(소리, 떨림, 밀림 등)으로 시작해서 → 원인 → 해법 순으로 서술.
"나도 이 증상인데?" 하고 멈추게 만드는 공감형 훅.
부품은 해법 설명에 꼭 필요한 1~2개만, 왜 이 조합인지 이유 1문장.`,
  vehicle_story: `[차종 특화 앵글]
"이 차는 원래 ___가 약점인데" 로 시작 — 해당 차종 오너만 공감하는 디테일.
같은 차 탄 사람이 "맞아 내 차도 그래" 하고 저장하게 만드는 구조.
차종 커뮤니티에서 공유될 만한 실용 정보 포함.`,
  before_after: `[비포/애프터 앵글]
순정 상태 vs 작업 후 체감 차이를 감각적으로 대비.
스펙이 아니라 운전석에서 느끼는 차이를 묘사 ("밟는 순간 확 잡히는 느낌", "고속에서 한 발에 딱").
수치보다 체감, 스펙보다 감각.`,
  value: `[가성비/혜택 앵글]
비용 대비 효과, 무료 서비스, 합리적 세팅을 강조.
"이 가격에 이 세팅?" 하는 서프라이즈 포인트로 훅.`,
  expertise: `[엔지니어링 앵글]
이 작업이 왜 까다로운지, 아무 데서나 못 하는 이유를 설명.
기술자가 디테일 하나에 집중해서 "이게 포인트거든요" 하고 알려주는 톤.
특수 제작, 커스텀, 정밀 작업의 behind-the-scene.`,
  community: `[레퍼런스 앵글]
동호회/커뮤니티 소속 고객 건이면 → 같은 커뮤니티 사람들이 공유할 만한 레퍼런스 관점.
"○○ 동호회에서 오신 분" 식 멘션 → 소속감 자극.`,
  urgency: `[긴급/시즌 앵글]
계절(여름 장마, 겨울 빙판) 또는 긴급 상황(갑자기 밀림, 경고등)을 훅으로 활용.
"지금 이 증상이면 미루지 마세요" 식 시의성 강조.`,
  education: `[기술 교육 앵글]
"많이들 모르시는데" "오해가 많은 부분인데" 로 시작 → 정보 공유형.
배워가는 느낌의 콘텐츠 → 저장 유도에 최적.`,
  misdiagnosis: `[증상 오해 교정 앵글]
"이거 ○○ 문제 아닙니다" 로 시작 → 흔한 오해 깨기.
진짜 원인이 뭔지 밝히는 구조. 정보성 높아서 공유 잘 됨.`,
};

function buildMetaPrompt(ssot, postType, angle, factSheet, highVolKeywords) {
  const { facts, forbidden } = factSheet;

  const symptomRaw = ssot.consumer?.directDemand?.symptom;
  const symptom = Array.isArray(symptomRaw) ? symptomRaw.join(', ') : (symptomRaw || '');
  const car = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();

  const angleDirective = ANGLE_DIRECTIVES[angle.id] || ANGLE_DIRECTIVES.symptom;

  const hashtagHint = highVolKeywords.length
    ? `참고 키워드 풀: ${highVolKeywords.slice(0, 8).join(', ')}`
    : '';

  return `너는 브레이크 전문 튜닝샵 "투베이스(2BASS)" 사장이 직접 치는 SNS 글을 대필하는 작가야.
일산/파주 소재, 16년 경력 현장 기술자.

━━━ 사장님 말투 (이 톤을 반드시 지켜) ━━━
- 존댓말이지만 힘 빠진 편한 톤: "~거든요", "~이에요", "~했습니다" (보고서체 X)
- 현장 기술자가 작업 끝나고 툭툭 던지듯 쓰는 느낌
- 광고 카피라이터처럼 세련되면 안 됨. 약간 투박하고 솔직한 게 맞음
- "우리 샵" "저희" 같은 1인칭 자연스럽게 사용
- 문장 사이 줄바꿈 자유롭게 (인스타 가독성)

━━━ AI 금지 표현 (하나라도 쓰면 탈락) ━━━
"확연히 달라진" / "이상 없이 마무리" / "풀셋 인스톨" / "~작업입니다" /
"호소하던" / "~까지 완료" / "정밀 장착" / "완벽한 마무리" /
"확연히 다른 제동력" / "만족스러운 결과" / "안전한 주행" / "꼼꼼한 작업" /
"~를 진행하였습니다" / "~에 대한 작업" / "최적의 세팅" / "차량 오너분"
→ 이런 식의 매끈한 보고서 문구 전부 금지.
→ 대신 구어체+감각 표현: "밟는 순간 확 잡히는 느낌", "고속에서 한 발에 딱", "이전이랑 비교가 안 돼요"

━━━ 사용 가능한 팩트 (이것만 사용) ━━━
${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

━━━ 절대 금지 (날조 방지) ━━━
${forbidden.map(f => `❌ ${f}`).join('\n')}

━━━ 이 포스트 앵글: ${angle.label} ━━━
${angleDirective}

━━━ 공통 규칙 ━━━
- 절대 금지 목록의 내용은 어떤 형태로든 포함 금지
- 고객 감정/반응 창작 금지. 원문에 있는 것만 인용
- 브랜드 한글 표기: AUDI→아우디, BMW→비엠더블유, Benz→벤츠 등
- 이모지 2~3개만 (과하면 AI 티 남)
- 부품 전체 나열 금지! 핵심 1~2개만 + "왜 이 조합인지" 이유 1문장
- 매 포스트 구조가 달라야 함. 훅→나열→결과→CTA 패턴 반복 금지
- 검색 키워드를 본문에 자연스럽게 녹일 것

━━━ 톤/말투 (IG·FB 공통, 반드시 준수) ━━━
- 일산 브레이크 전문점 정비사(16년 경력)가 직접 쓴 것처럼.
- ~합니다/입니다 체로 통일. 해요체(~해요/~이에요/~거든요/~있어요) 혼합 절대 금지. 문체가 바뀌면 AI 느낌이 남.
- 남성 차주가 주 고객. 담백하고 건조한 톤. 감성적/친근한 척 하는 말투 금지.
- 권장 표현: "이번에 들어온 차량은", "작업 들어갑니다", "이런 경우가 많습니다"
- 금지 표현: "알고 계셨어요?", "~분 계세요?", "저장해두세요", "공유해주세요" 같은 유튜브/인스타 클리셰
- "~인 거 아시죠?", "~하면 큰일납니다" 같은 과장도 금지.

━━━ Instagram 캡션 ━━━
- 200~400자 (해시태그 제외)
- 첫 줄(~125자)이 피드에서 보이는 전부 — 부품명 NO, 훅 YES
  ${symptom ? `증상/상황 활용: "${symptom}"` : `차량/작업 관련 호기심 자극`}
- 본문은 위 앵글(${angle.label})에 맞게 전개. 스토리텔링.
- 끝에 저장/공유 유도 없이 작업 결과로 마무리. "참고하세요", "저장해두세요" 같은 클리셰 금지.
- CTA: "📍 프로필 링크에서 예약" 또는 "💬 DM 문의" (별도 cta 필드)
- 해시태그 정확히 5개:
  지역 1개 필수 (#일산튜닝 #파주브레이크 #고양브레이크 #일산브레이크 중)
  나머지 4개: 이 포스트의 소구점 기준으로 자유 조합
    후보 풀 — 차종(#${car.replace(/\s/g, '')} #${(ssot.vehicle?.brand || '').replace(/\s/g, '')}튜닝),
    증상(#브레이크떨림 #제동밀림 #브레이크소음),
    부품(#브렘보 #캘리퍼교체 #디스크교체 #빅브레이크),
    감성(#제동력체감 #드라이빙 #안전운전),
    커뮤니티(#${car.replace(/\s/g, '')}동호회 #${(ssot.vehicle?.brand || '').replace(/\s/g, '')}오너)
  ${hashtagHint}
  ★ "이 글이 누구에게 공유될까" 기준으로 고르기. 매번 같은 세트 금지.

━━━ Facebook 캡션 ━━━
- 100~250자. 짧되 합니다체 유지. 정비사가 작업 후기 올리는 톤.
- 스펙 최소, 상황/결과 위주. 담백하게.
- 해시태그 없음 (FB에서 해시태그는 도달에 무의미)
- ⚠ URL을 캡션 본문에 넣지 마. 외부 링크는 FB 도달률을 40~55% 떨어뜨림.
- 대신 반드시 "댓글에 링크 남겨둘게요" / "댓글에 링크 달아둘게요" / "프로필에서 상담 가능해요" 중 하나를 캡션에 포함. 이 문장이 없으면 실패로 간주.
- 마지막 문장은 작업 사실로 끝내거나, 짧은 한 줄 코멘트. "~있으세요?" "~겪어보셨나요?" 식 질문 금지.
- CTA: "댓글 링크 확인" 또는 "프로필에서 상담" (별도 cta 필드)

아래 JSON 형식으로만 출력 (다른 텍스트 없이):
{
  "ig": {
    "caption": "IG 캡션 본문 (해시태그 미포함)",
    "hashtags": "#태그1 #태그2 #태그3 #태그4 #태그5",
    "cta": "프로필 링크 or DM 유도 문구"
  },
  "fb": {
    "caption": "FB 캡션 본문 (URL 미포함, 댓글 유도)",
    "cta": "상담: ${CTA.talk}\\n예약: ${CTA.place}"
  }
}`;
}

async function generateMetaPost(ssotPath, kvCache) {
  const ssot = await loadJson(ssotPath, null);
  if (!ssot) return { status: 'no_ssot' };

  const outPath = path.join(ROOT, PUBLISH_DIR, `${ssot.postId}.json`);
  if (await exists(outPath)) return { status: 'skipped' };

  const postType = classifyPostType(ssot);
  if (postType === 'skip') return { status: 'skipped_type', postType };

  const factSheet = buildFactSheet(ssot);
  const angle = selectAngle(ssot, factSheet.verified);

  // 키워드 캐시에서 이 포스트와 관련된 고볼륨 키워드 추출
  const highVolKeywords = pickHighVolKeywords(ssot, kvCache);
  const prompt = buildMetaPrompt(ssot, postType, angle, factSheet, highVolKeywords);

  const generated = await callClaude(prompt, MODEL);
  const warnings = validateGenerated(generated, factSheet, ssot);

  // 2벌 출력(ig/fb) 또는 기존 1벌(caption/hashtags/cta) 모두 수용
  const ig = generated.ig || {
    caption: generated.caption || '',
    hashtags: generated.hashtags || '',
    cta: generated.cta || '📍 프로필 링크에서 예약 / 💬 DM 문의',
  };
  const fb = generated.fb || {
    caption: ig.caption,
    cta: `상담: ${CTA.talk}\n예약: ${CTA.place}`,
  };

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
      ig: {
        caption: ig.caption || '',
        hashtags: ig.hashtags || '',
        cta: ig.cta || '📍 프로필 링크에서 예약 / 💬 DM 문의',
      },
      fb: {
        caption: fb.caption || '',
        cta: fb.cta || `상담: ${CTA.talk}\n예약: ${CTA.place}`,
      },
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

// 키워드 캐시에서 ssot 관련 고볼륨 키워드 추출
function pickHighVolKeywords(ssot, kvCache) {
  if (!kvCache?.keywords) return [];
  const parts = (ssot.work?.parts || []).join(' ').toLowerCase();
  const wtype = (ssot.work?.type || '').toLowerCase();
  const brand = (ssot.vehicle?.brand || '').toLowerCase();
  const model = (ssot.vehicle?.model || '').toLowerCase();
  const searchText = `${parts} ${wtype} ${brand} ${model}`;

  const matched = [];
  for (const [kw, data] of Object.entries(kvCache.keywords)) {
    if (searchText.includes(kw.toLowerCase())) {
      matched.push({ kw, vol: data.total || 0 });
    }
  }
  matched.sort((a, b) => b.vol - a.vol);
  return matched.map(m => m.kw);
}

// 단일 postId CLI 인자 지원
const SINGLE_POST_ID = process.argv[2] || '';

async function main() {
  console.log('Meta(IG+FB) 캡션 생성 시작...');
  console.log(`모델: ${MODEL} | 동시성: ${CONCURRENCY} | 제한: ${LIMIT || '없음'}\n`);

  // 키워드 볼륨 캐시 로드
  const kvCache = await loadKeywordVolumeCache();

  let ssotFiles;
  if (SINGLE_POST_ID) {
    // 단일 포스트 모드
    const singleFile = `${SINGLE_POST_ID}.json`;
    const singlePath = path.join(ROOT, SSOT_DIR, singleFile);
    if (await exists(singlePath)) {
      ssotFiles = [singleFile];
      console.log(`단일 포스트 모드: ${SINGLE_POST_ID}\n`);
    } else {
      console.error(`SSOT 파일 없음: ${singlePath}`);
      process.exit(1);
    }
  } else {
    ssotFiles = (await readdir(path.join(ROOT, SSOT_DIR)).catch(() => []))
      .filter(f => f.endsWith('.json') && !f.startsWith('_'));
  }

  console.log(`SSOT 파일: ${ssotFiles.length}개\n`);

  const stats = { ok: 0, skipped: 0, skippedType: 0, failed: 0 };

  const tasks = ssotFiles.map(f => async () => {
    if (LIMIT && stats.ok >= LIMIT) return;
    try {
      const r = await generateMetaPost(path.join(ROOT, SSOT_DIR, f), kvCache);
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

  console.log(`\n\n═══ Meta(IG+FB) 생성 완료 ═══`);
  console.log(`생성: ${stats.ok} | 스킵(기존): ${stats.skipped} | 스킵(유형): ${stats.skippedType} | 실패: ${stats.failed}`);
  console.log(`저장: ${PUBLISH_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
