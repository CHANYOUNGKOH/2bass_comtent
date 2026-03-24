/**
 * content-generate-naver-blog.js  (V2)
 * SSOT → 네이버 블로그 발행용 글 생성 (Claude API)
 *
 * V2 핵심 변경:
 * - 팩트 기반: 원문에 없는 필드는 forbidden 목록 → Claude에 "절대 언급 금지"
 * - 다양성: 6개 포스트 유형 × 8개 도입부 앵글 × 6개 제목 패턴
 * - 지역 SEO: hashCode 기반 결정적 순환 (해시태그 세트/본문 지역명/마을명/랜드마크)
 * - 매출 전환: 유형별 CTA 리드인 + 부품 글에만 스마트스토어 링크
 * - 생성 후 검증: forbidden 키워드 침투 / 감정 창작 감지 → warning 리포트
 *
 * 출력: data/publish/naver-v2/
 */
import { mkdir, writeFile, readdir } from 'fs/promises';
import path from 'path';
import {
  CTA, loadJson, exists, hashCode, callClaude,
  classifyPostType, buildFactSheet, selectAngle, validateGenerated,
  selectLocalSEO, classifySearchIntent, buildMultiCTA,
  loadKeywordVolumeCache, cacheToVolumeMap,
} from './_content-shared.js';

const ROOT        = process.cwd();
const SSOT_DIR    = 'data/ssot-posts';
const PUBLISH_DIR = 'data/publish/naver-v2';
const WARN_DIR    = 'data/publish/naver-v2/_warnings';
const LIMIT       = Number(process.env.BLOG_LIMIT || 0);
const CONCURRENCY = Number(process.env.BLOG_CONCURRENCY || 10);
const MODEL       = process.env.BLOG_MODEL || 'sonnet';  // Anthropic API (ANTHROPIC_API_KEY 필요)
const FORCE       = process.argv.includes('--force');
const BLOG2_MODE  = process.argv.includes('--blog2');
const PRIORITIZE  = process.argv.includes('--prioritize');
const TARGET_IDS  = process.argv.filter(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);

// ═══════════════════════════════════════════════════
// 키워드 볼륨 기반 우선순위 점수
// ═══════════════════════════════════════════════════
const KEYWORD_VOLUME_MAP_FALLBACK = {
  // 하드코딩 fallback (캐시 없을 때)
  '브레이크디스크': 2580, '브레이크패드교체': 1600, '브렘보캘리퍼': 420,
  '디스크연마': 200, '브레이크튜닝': 300,
  '브레이크떨림': 1200, '브레이크소음': 800, '브레이크밀림': 400,
  '브레이크쏠림': 200, '핸들떨림': 600, '고속떨림': 500,
  '그랜저브레이크': 150, '소나타브레이크': 180, 'K5브레이크': 120,
  '쏘렌토브레이크': 100, 'BMW브레이크': 200, '벤츠브레이크': 180,
};
let KEYWORD_VOLUME_MAP = KEYWORD_VOLUME_MAP_FALLBACK;

// 경쟁도 역수 (낮은 경쟁 = 높은 점수)
const COMP_MULTIPLIER = { '높음': 0.7, '중간': 1.0, '낮음': 1.3 };

function calcPriorityScore(ssot) {
  const w = ssot.work || {};
  const v = ssot.vehicle || {};
  const parts = (w.parts || []).join(' ').toLowerCase();
  const wtype = (w.type || '').toLowerCase();
  const model = (v.model || '').replace(/\s/g, '').toLowerCase();
  const brand = (v.brand || '').replace(/\s/g, '').toLowerCase();
  const symptomRaw = ssot.consumer?.directDemand?.symptom;
  const symptom = (Array.isArray(symptomRaw) ? symptomRaw.join(' ') : (symptomRaw || '')).toLowerCase();
  const searchText = `${parts} ${wtype} ${model} ${brand} ${symptom}`;

  let score = 0;
  for (const [kw, vol] of Object.entries(KEYWORD_VOLUME_MAP)) {
    const kwLow = kw.toLowerCase();
    if (searchText.includes(kwLow) || parts.includes(kwLow) || wtype.includes(kwLow)) {
      score += vol;
    }
  }

  // 증상 키워드 보너스 (정보형 콘텐츠 잠재력)
  if (/떨림|소음|밀림|쏠림|편마모/.test(searchText)) score += 300;

  // 차종 인기도 보너스
  if (/그랜저|쏘나타|k5|k7|스포티지|투싼|싼타페/.test(model)) score += 200;
  if (/bmw|벤츠|아우디|benz|audi/.test(brand.toLowerCase())) score += 250;

  return score;
}

// ═══════════════════════════════════════════════════
// Phase D: 프롬프트 조립
// ═══════════════════════════════════════════════════
const STRUCTURE_TEMPLATES = {
  case_study:          '도입(앵글) → 차량/상황 소개 → 작업 과정 상세 → 결과 → 마무리',
  parts_comparison:    '도입(앵글) → 순정 vs 교체 부품 분석 → 장착 과정 → 체감 변화 → 적합 차종 안내',
  maintenance_guide:   '도입(교육적 앵글) → 작업 소개 → 과정(쉬운 설명) → 주의사항 → 점검 주기 안내',
  customer_story:      '도입(소개 경위) → 고객 니즈 → 솔루션 → 결과 → 재방문/만족',
  technical_deep_dive: '도입(왜 어려운지) → 기술적 배경 → 상세 과정 → 성과 → 해당 차종 안내',
};

// Blog1 정보형 구조 (검색 유입 극대화)
const BLOG1_INFO_STRUCTURE = `1. 핵심 답변 (첫 2문장에 검색 질문의 답을 바로 제시 — 네이버 스니펫 노출 목적)
2. 원인 분석 (교육적 톤, "왜 이런 증상이 생기는지" 설명)
3. 해결 과정 (SSOT 팩트 기반, 실제 사례로 풀어서)
4. 체크리스트 또는 비교표 (체류시간 증가 — "✅ 이런 경우 점검 필요" 등)
5. CTA`;

// Blog2 거래형 구조 (전환 극대화)
const BLOG2_TXN_STRUCTURE = `1. 차량 소개 + 고객 상황 (어떤 차, 어떤 문제)
2. 작업 과정 (사진 중심, 부품명 구체적)
3. 전후 비교 (체감 변화, 스펙 차이)
4. CTA (중간 + 끝)`;

const ANGLE_INSTRUCTIONS = {
  symptom:       '도입부에서 소비자의 증상/불편에 공감으로 시작하세요 (공포 조성이 아닌 공감). 예: "브레이크를 밟을 때마다 끝까지 밀리는 느낌, 불안하시죠?"',
  vehicle_story: '이 차량의 특성이나 매력에서 자연스럽게 시작하세요. 예: "세월이 지나도 매력적인 그랜저 TG, 제동력만 보강하면 완벽합니다"',
  before_after:  '순정 상태와 튜닝 후 변화를 극적으로 비교하며 시작하세요. 스펙 수치를 활용하되 원문 근거 팩트만 사용.',
  value:         '무료 점검, 정밀 진단 같은 전문점 혜택을 자연스럽게 어필하며 시작하세요. 구체적 가격/금액 언급 금지.',
  expertise:     '일반 샵에서는 하기 어려운 작업임을 강조하며 시작하세요. 왜 전문점이 필요한지 설명.',
  community:     '동호회/커뮤니티에서의 신뢰와 입소문을 자연스럽게 언급하며 시작하세요.',
  urgency:       '시즌이나 긴급한 상황을 공감적으로 언급하며 시작하세요 (과도한 공포 금지).',
  education:     '기술적 지식을 쉽게 전달하는 교육적 톤으로 시작하세요. "알고 계셨나요?" 스타일.',
  misdiagnosis:  '"하체가 떨린다", "타이어 문제인 줄 알았다" → 실제 원인은 브레이크였다는 관점으로 시작하세요. 소비자가 다른 부위 문제로 오해했지만 실제 원인은 브레이크였던 사례로 접근. "타이어 교체해도 계속 떨림 → 디스크 편마모가 원인" 같은 진단 과정 강조. 핵심 메시지: "정확한 원인 진단이 먼저입니다" (다른 업장 비방 절대 금지, 자기 전문성만 강조).',
};

// ═══════════════════════════════════════════════════
// Blog2: 유형/앵글 차별화 매핑
// ═══════════════════════════════════════════════════
const BLOG2_TYPE_MAP = {
  case_study:          'technical_deep_dive',
  customer_story:      'parts_comparison',
  parts_comparison:    'case_study',
  maintenance_guide:   'technical_deep_dive',
  technical_deep_dive: 'customer_story',
};

const BLOG2_DIFFERENTIATION = {
  technical_deep_dive: '이 글은 기술적 전문성/공정 과정에 초점을 맞추세요. 고객 스토리나 감성적 표현보다 기술적 디테일에 집중.',
  parts_comparison:    '이 글은 부품 스펙 비교와 실제 체감 차이에 집중하세요. 고객 감정보다 객관적 성능 데이터를 강조.',
  case_study:          '이 글은 실제 시공 과정과 문제 해결에 초점을 맞추세요. 기술적 배경보다 현장 경험 중심으로 서술.',
  customer_story:      '이 글은 고객의 니즈와 만족 포인트에 집중하세요. 기술적 설명보다 고객 관점의 가치를 강조.',
  maintenance_guide:   '이 글은 교육적/안내 톤으로 작성하세요. 점검 주기와 주의사항을 쉽게 전달하는 데 집중.',
};

// ═══════════════════════════════════════════════════
// 증상 기반 SEO: 소비자가 실제 검색하는 증상 키워드
// ═══════════════════════════════════════════════════
const SYMPTOM_TAGS = [
  '#하체떨림', '#타이어떨림', '#휠떨림', '#핸들떨림',
  '#브레이크떨림', '#브레이크소음', '#제동불량', '#브레이크밀림',
  '#고속떨림', '#제동시떨림', '#브레이크끼익', '#브레이크쏠림',
];

const SYMPTOM_PATTERNS = [
  /떨림|떨리|진동/,
  /소음|끼익|끽|소리/,
  /밀림|밀리|제동불량/,
  /쏠림|쏠리|한쪽/,
  /고착|잠김/,
  /편마모/,
];

function matchSymptomTags(ssot) {
  const text = ((ssot.work?.type || '') + ' ' + (ssot.originalText || '').slice(0, 500)).toLowerCase();
  const matched = [];
  for (const tag of SYMPTOM_TAGS) {
    const keyword = tag.replace('#', '');
    if (text.includes(keyword)) matched.push(tag);
  }
  // 패턴 매칭으로 추가 (최대 3개)
  if (matched.length === 0) {
    for (const pat of SYMPTOM_PATTERNS) {
      if (pat.test(text)) {
        // 패턴에 매칭되면 관련 증상 태그 추가
        if (/떨림|떨리|진동/.test(text)) { matched.push('#브레이크떨림'); break; }
        if (/소음|끼익/.test(text)) { matched.push('#브레이크소음'); break; }
        if (/밀림|밀리/.test(text)) { matched.push('#브레이크밀림'); break; }
        if (/쏠림|쏠리/.test(text)) { matched.push('#브레이크쏠림'); break; }
      }
    }
  }
  return matched.slice(0, 3);
}

function selectBlog2Angle(ssot, factSheet, blog1AngleId) {
  // blog1이 사용한 앵글을 제외하고 다른 앵글 선택
  const allAngleIds = Object.keys(ANGLE_INSTRUCTIONS);
  const available = allAngleIds.filter(id => id !== blog1AngleId);
  const h = hashCode(ssot.postId + '_blog2');
  const picked = available[h % available.length];
  return { id: picked, label: picked };
}

function buildImageContext(ssot) {
  const positions = ssot.images?.positions || [];
  const files = ssot.images?.files || [];
  if (positions.length === 0 && files.length === 0) return '';

  const count = Math.max(positions.length, files.length);
  const lines = [];
  for (let i = 0; i < count; i++) {
    const prev = positions[i]?.prevText;
    const desc = prev ? `— 관련 내용: "${prev}"` : '';
    lines.push(`[사진${i + 1}] ${desc}`);
  }

  return `\n━━━ 이미지 ${count}장 — 본문에 배치 ━━━
${lines.join('\n')}
위 [사진N] 마커를 본문 중 가장 관련 있는 위치에 삽입하세요.
마커는 단독 줄에 작성하고, 순서는 바꿔도 됩니다.\n`;
}

function buildSystemPrompt() {
  return `<role>
당신은 일산(경기 고양시 일산동구) 브레이크 전문 튜닝샵 "투베이스(2BASS)"의 정비사입니다.
16년 경력, 전국에서 고객이 찾아오는 브레이크 전문점.
투베이스 소재지는 일산입니다. "파주 투베이스"는 틀린 표현입니다.
</role>

<tone>
- 일산 브레이크 전문점 정비사가 직접 쓴 것처럼
- "~습니다" 존댓말 기본, "알고 계셨나요?" 같은 교과서 톤 금지
- 말투: ~합니다/입니다 체로 통일. 해요체 혼합 금지.
- 권장 표현: "이번에 들어온 차량은", "작업 들어갑니다", "이런 경우가 많은데"
- 첫 문장에 차종+증상 바로 언급 (서론 없이)
</tone>

<forbidden_expressions>
"세월이 무색하게", "발군의", "오늘은 ~를 소개해 드리겠습니다", "한 단계 업그레이드",
"처음", "첫 시공", "첫 번째" 등 경험 부족 암시 표현, 가격/비용 정보 일체
</forbidden_expressions>

<positioning>
- 브레이크 전문점 전문성을 자연스럽게 보여주기 (다른 업장 비방/비교 절대 금지)
- "브레이크 전문 장비로 정밀 진단", "수천 건의 브레이크 시공 경험" 등 자기 강점 중심
- 절대 금지: 다른 정비소/샵 언급, 비교, 비방, "못 잡는", "못 하는" 등의 표현
- 허용: "정확한 원인 진단이 중요합니다", "브레이크는 안전과 직결되는 부분이라" 등 사실 기반
</positioning>

<location_rules>
- 투베이스 소재지: 일산(경기 고양시 일산동구). "일산 투베이스" 또는 "투베이스" 사용.
- "파주 투베이스", "파주에 위치한 투베이스"는 틀린 표현 — 절대 사용 금지.
- 파주/일산/김포는 인근 서비스 지역으로 언급 가능. 전국에서 찾아오는 전문점.
- 좋은 예: "일산에서 브레이크만 전문으로 작업하는 투베이스", "파주/김포에서 오시는 분들도 많습니다"
- 나쁜 예: "파주 투베이스", "파주에서 작업하는 저희 투베이스는"
- 지역명은 문맥에 맞을 때만 사용. 억지스러우면 차라리 빼세요.
- 오프라인 방문을 유도하는 톤은 유지.
- 해시태그에 지역 키워드를 추가하지 마세요. 필수 해시태그에 이미 포함되어 있습니다.
</location_rules>`;
}

function buildUserPrompt(ssot, postType, angle, factSheet, ctaBlock, localSeo, { searchIntent, multiCTA } = {}) {
  const { facts, forbidden } = factSheet;
  const structure = STRUCTURE_TEMPLATES[postType] || STRUCTURE_TEMPLATES.case_study;
  const angleInst = ANGLE_INSTRUCTIONS[angle.id] || ANGLE_INSTRUCTIONS.symptom;

  const consumerKw = [
    ...(ssot.consumer?.directDemand?.searchQueries || []),
    ...(ssot.consumer?.expandedDemand || []).flatMap(e => e.searchQueries || []),
  ].slice(0, 8);

  const imageContext = buildImageContext(ssot);

  const hashtags = [...localSeo.fixedHashtags, ...localSeo.rotatingHashtags, ...(localSeo.highVolTag ? [localSeo.highVolTag] : []), ...(localSeo.longTailTag ? [localSeo.longTailTag] : [])].filter(Boolean).join(' ');

  return `<source_document>
${(ssot.originalText || '').slice(0, 1500)}
</source_document>

<facts>
${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}
</facts>

<forbidden_facts>
${forbidden.map(f => `- ${f}`).join('\n')}
</forbidden_facts>

<task>
위 팩트시트를 바탕으로 네이버 블로그 포스트를 작성하세요.
</task>

<structure>
포스트 유형: ${postType}
구조: ${structure}
도입부 앵글: ${angle.label} — ${angleInst}
</structure>

<seo_keywords>
${consumerKw.join(', ') || '없음'}
</seo_keywords>

<volume_guide>
- 팩트시트에 제공된 팩트를 빠짐없이 활용하세요. SSOT 팩트 활용률이 핵심 기준입니다.
- 부품 3개 교체 작업이면 3개 모두 설명, 단순 패드 교체면 자연히 짧아져도 됩니다.
- 섹션 수: 팩트 양에 따라 자연스럽게 결정 (3~7개)
- 각 섹션: 팩트가 풍부하면 충분히 서술, 적으면 간결하게
- 소비자가 "이 정도면 믿고 맡기겠다"고 느낄 만큼 구체적으로 쓰세요.
- 얇은 글보다 근거 있는 글이 매출 전환율이 높습니다.
</volume_guide>

${imageContext ? `<images>\n${imageContext}</images>\n` : ''}<image_captions>
- 각 [사진N] 마커 바로 아래에 한 줄 캡션을 작성하세요.
- 캡션은 이미지 내용을 설명하면서 SEO 키워드를 자연스럽게 포함.
- 형식: "▲ 캡션 텍스트"
- 예: "▲ 브렘보 4P 캘리퍼 프론트 장착 완료 모습"
- 예: "▲ 썬디스크 355mm 로터와 순정 디스크 크기 비교"
- 캡션이 없는 이미지도 괜찮습니다. 설명이 자연스러운 이미지에만 작성.
</image_captions>

<cta>
${ctaBlock}
</cta>

${multiCTA ? `<multi_cta>
본문에 CTA를 3곳에 배치하세요:
1. 도입부 끝 (소프트 CTA): "${multiCTA.softCTA}"
2. 작업 설명 후 중간 (맥락 CTA): "${multiCTA.midCTA}"
3. 글 끝 (풀 CTA): 아래 블록 그대로 사용
${multiCTA.fullCTA}

소프트/맥락 CTA는 본문에 자연스럽게 녹이세요 (별도 섹션이 아닌 문단 끝에).
</multi_cta>` : ''}

<local_seo_hashtags>
필수: ${hashtags}
위 필수 태그 외에 추가 지역 해시태그를 넣지 마세요.
</local_seo_hashtags>

${searchIntent === 'informational' ? `<dia_optimization>
네이버 D.I.A + C-Rank 최적화 규칙:
1. 스니펫 최적화: 첫 2문장에 검색 질문의 핵심 답변을 바로 제시. 예: "브레이크 떨림의 주요 원인은 디스크 편마모입니다."
2. 소제목(■)에 검색 키워드 삽입: "■ 브레이크 떨림, 왜 생기나요?" 형태로 소비자 검색어 포함.
3. 이미지-텍스트 교차: 2~3문단마다 [사진N] 배치. 텍스트만 길게 이어지지 않도록.
4. 체류시간 요소: 비교표(순정 vs 교체), 체크리스트(✅), "정비사 팁" 같은 요소를 1개 이상 포함.
5. 글 길이: 1500~2000자 목표 (정보형은 충분한 설명이 검색 노출에 유리).
</dia_optimization>` : ''}

${searchIntent === 'transactional' ? `<dia_optimization>
네이버 D.I.A + C-Rank 최적화 규칙:
1. 작업 결과를 먼저 보여주고, 과정은 사진 중심으로 간결하게.
2. 소제목(■ 또는 ▸)에 차종+작업명 포함: "■ 그랜저 TG 브렘보 4P 장착" 형태.
3. 전후 비교를 구체적으로 (순정 스펙 → 튜닝 스펙, 체감 차이).
4. 글 길이: 800~1200자 목표 (거래형은 핵심만 간결하게).
</dia_optimization>` : ''}

<writing_rules>
1. 제목: 3개 추천. 각각 60자 이내. SEO 최적화. 소비자가 실제 검색하는 키워드 포함. 스타일 다르게.
   - 제목에 "파주 투베이스" 사용 금지. "투베이스" 또는 "일산 투베이스"로.
${searchIntent === 'informational' ? '   - 정보형 제목 패턴: "[증상/부품] 원인과 해결 — [차종] 실제 사례"' : '   - 거래형 제목 패턴: "[차종] [작업] 시공 후기 — 일산 투베이스"'}
2. 본문: SSOT 팩트를 충분히 활용하여 구체적으로 서술. 정비사가 실제 경험을 바탕으로 쓴 것처럼. 부품명, 작업 과정, 결과를 빠짐없이.
3. 본문 구조: 반드시 "■ 섹션제목" 형식으로 섹션 헤더를 사용하여 구조화. 예: "■ 작업 배경", "■ 시공 과정", "■ 체감 변화" 등. 섹션 수는 내용에 따라 3~7개. 섹션 헤더 없이 글만 나열하지 말 것.
   - 소제목에 검색 키워드를 자연스럽게 포함시키세요.
   - 단락 가독성: 2-3문장을 한 단락으로 묶고, 단락 사이에 빈 줄(\\n\\n) 하나. 문장 중간에 줄바꿈하지 말 것. 한 단락이 100자를 넘으면 빈 줄로 나눌 것.
4. "절대 금지" 목록의 내용은 어떤 형태로든 본문에 포함하지 마세요.
5. 고객 감정/반응은 원문에 명시적으로 나온 것만 사용. 창작 금지.
6. 해시태그: 최대 30개, 전체 합산 100자 이내 (네이버 제한). 나머지 해시태그는 차종명, 작업명, 부품명 등 작업 관련 키워드로 채우세요. SEO 키워드는 본문에 자연어로 최대한 녹이고, 본문에 녹이지 못한 키워드만 해시태그로 추가.
7. 지나친 광고 문구 지양. 팩트 기반으로 신뢰감 있게.
8. 브랜드 한글 표기: AUDI→아우디, BMW→비엠더블유(또는 BMW), Benz→벤츠, Infiniti→인피니티, Toyota→토요타, Chevrolet→쉐보레, Hyundai→현대, Kia→기아. 절대 "오디" 같은 잘못된 표기 사용 금지.
9. 말투: ~합니다/입니다 체로 통일. 해요체(~해요/~이에요/~거든요) 혼합 금지. 문체가 바뀌면 AI 느낌이 남.
10. 용어 표기: 브래킷(X) → 브라켓(O).
11. "처음", "첫 시공", "첫 번째" 등 경험 부족을 암시하는 표현 금지. 16년 경력 전문점이므로 모든 차종에 대해 자신감 있게 서술.
12. 이미지 배치: 위에 [사진N] 마커가 제공된 경우, 본문 중 해당 이미지 내용과 가장 관련 있는 위치에 마커를 단독 줄로 삽입. 마커가 없으면 이미지 관련 표기 생략. 단, 본문 첫 줄은 반드시 텍스트 문장이어야 함 — [사진N]으로 시작 금지.
13. 가격/비용 정보 절대 금지. 구체적 금액, "~만원", "가성비", "합리적 가격" 등 가격 관련 표현 일체 사용하지 마세요. 가격은 문의를 통해 안내합니다.
</writing_rules>

<output_format>
아래 JSON 형식으로 출력:
{
  "titles": ["제목 후보1", "제목 후보2", "제목 후보3"],
  "body": "본문 전체 (\\n으로 단락 구분, ■ 섹션 헤더 포함)",
  "cta": "CTA 블록",
  "hashtags": ["#태그1", "#태그2", ...],
  "seoKeywords": ["키워드1", "키워드2", ...],
  "imageAlts": ["이미지1 설명 (SEO 키워드 포함)", "이미지2 설명", ...]
}
imageAlts에서도 "파주 투베이스" 사용 금지. "투베이스" 또는 "일산 투베이스"로.
</output_format>`;
}

function buildMessages(ssot, postType, angle, factSheet, ctaBlock, localSeo, opts = {}) {
  return {
    system: buildSystemPrompt(),
    user: buildUserPrompt(ssot, postType, angle, factSheet, ctaBlock, localSeo, opts),
  };
}

// ═══════════════════════════════════════════════════
// Phase E: 컨텍스트 CTA
// ═══════════════════════════════════════════════════
const CTA_LEADINS = {
  case_study:          '비슷한 증상이라면 정확한 진단이 먼저입니다.',
  parts_comparison:    '내 차에 맞는 사양이 궁금하시면 편하게 문의하세요.',
  maintenance_guide:   '교체 시기가 궁금하시면 무료 점검 가능합니다.',
  technical_deep_dive: '일반 샵에서 거절당한 작업도 상담 가능합니다.',
  customer_story:      '주변 분들의 소개로 많이 찾아주십니다.',
};

function buildContextualCTA(postType, hasParts, isBlog2 = false) {
  const leadin = CTA_LEADINS[postType] || CTA_LEADINS.case_study;

  if (isBlog2) {
    // Blog2: 인라인 텍스트형 CTA
    let block = `${leadin}\n\n`;
    block += `궁금하신 점은 전화(${CTA.phone})나 네이버 톡톡(${CTA.talk})으로 편하게 문의해 주세요.\n`;
    block += `네이버 예약도 가능합니다 → ${CTA.place}`;
    return block;
  }

  let block = `${leadin}\n\n`;
  block += `📞 전화 문의 → ${CTA.phone}\n`;
  block += `네이버 톡톡 문의 → ${CTA.talk}\n`;
  block += `카카오톡 문의 → ${CTA.kakao}\n`;
  block += `📅 네이버 예약 → ${CTA.place}\n`;
  if (hasParts) {
    block += `🛒 부품 구매 → ${CTA.store}\n`;
  }
  return block;
}

// ═══════════════════════════════════════════════════
// Phase: 제목 다양화 (6패턴 로테이션)
// ═══════════════════════════════════════════════════
function suggestTitlePattern(ssot, localSeo) {
  const h = hashCode(ssot.postId) % 6;
  const v = ssot.vehicle || {};
  const w = ssot.work || {};
  const car = `${v.brand || ''} ${v.model || ''}`.trim() || '차량';
  const rawSymptom = ssot.consumer?.directDemand?.symptom;
  const symptom = (Array.isArray(rawSymptom) ? rawSymptom[0] : rawSymptom?.split(',')[0])?.trim() || w.type || '브레이크 작업';
  const part = (w.parts || [])[0] || '브레이크';
  const workType = w.type || '브레이크 작업';

  const patterns = [
    `[${car}] ${symptom} 해결 사례 - 투베이스`,
    `${part} 장착 후기 | ${car} 브레이크 튜닝`,
    `${car} 오너가 알아야 할 ${workType} 포인트`,
    `일산 ${car} ${workType} 전문 시공`,
    `${localSeo.bodyRegion} ${car} ${workType} | 투베이스`,
    `${car} ${workType} 전문점 — ${localSeo.bodyRegion} 인근`,
  ];
  return patterns[h];
}

// Blog1 정보형 제목 패턴 (증상/부품 중심)
function suggestBlog1TitlePattern(ssot, localSeo) {
  const h = hashCode(ssot.postId + '_b1') % 6;
  const v = ssot.vehicle || {};
  const w = ssot.work || {};
  const car = `${v.brand || ''} ${v.model || ''}`.trim() || '차량';
  const rawSymptom = ssot.consumer?.directDemand?.symptom;
  const symptom = (Array.isArray(rawSymptom) ? rawSymptom[0] : rawSymptom?.split(',')[0])?.trim() || '브레이크 이상';
  const part = (w.parts || [])[0] || '브레이크';
  const workType = w.type || '브레이크 작업';

  const patterns = [
    `${symptom} 원인과 해결 — ${car} 실제 사례`,
    `${car} ${symptom}, 원인은? 정비사가 알려드립니다`,
    `${part} 교체 시기와 점검 포인트 — ${car}`,
    `${symptom} 해결법 | ${car} 브레이크 점검 사례`,
    `${car} ${workType} 전 꼭 알아야 할 것`,
    `${symptom} 방치하면? ${car} 실제 정비 사례로 확인`,
  ];
  return patterns[h];
}

// Blog2 거래형 제목 패턴 (차종+작업 조합)
function suggestBlog2TitlePattern(ssot, localSeo) {
  const h = hashCode(ssot.postId + '_b2') % 6;
  const v = ssot.vehicle || {};
  const w = ssot.work || {};
  const car = `${v.brand || ''} ${v.model || ''}`.trim() || '차량';
  const part = (w.parts || [])[0] || '브레이크';
  const workType = w.type || '브레이크 작업';

  const patterns = [
    `${car} ${workType} 시공 후기 — 일산 투베이스`,
    `${car} ${part} 장착 완료 | 투베이스`,
    `${car} 브레이크 튜닝 | ${workType} 시공기`,
    `일산 ${car} ${part} 장착 사례`,
    `${car} ${workType} — ${localSeo.bodyRegion} 인근 전문점`,
    `${car} ${part} 교체 후기 | 일산 투베이스`,
  ];
  return patterns[h];
}

// ═══════════════════════════════════════════════════
// 메인 생성 로직
// ═══════════════════════════════════════════════════
async function generateBlogPost(ssotPath) {
  const ssot = await loadJson(ssotPath, null);
  if (!ssot) return { status: 'no_ssot' };

  const outPath = path.join(ROOT, PUBLISH_DIR, `${ssot.postId}.json`);
  if (!FORCE && await exists(outPath)) return { status: 'skipped' };

  // Phase A: 포스트 분류
  const postType = classifyPostType(ssot);
  if (postType === 'skip') return { status: 'skipped_type', postType };

  // 검색의도 분류 (Blog1 = 정보형 우선)
  const searchIntent = 'informational';

  // Phase B: 팩트시트
  const factSheet = buildFactSheet(ssot);

  // Phase C: 앵글 선택
  const angle = selectAngle(ssot, factSheet.verified);

  // Phase E: 다중 CTA
  const hasParts = (ssot.work?.parts || []).length > 0;
  const ctaBlock = buildContextualCTA(postType, hasParts);
  const multiCTA = buildMultiCTA(ssot, searchIntent);

  // 지역 SEO 순환 (ssot 전달 → 동적 부품+지역 해시태그 생성)
  const localSeo = selectLocalSEO(ssot.postId, ssot);

  // 제목 힌트 — Blog1 정보형 패턴
  const titleHint = suggestBlog1TitlePattern(ssot, localSeo);

  // 증상 기반 SEO 해시태그 매칭
  const symptomTags = matchSymptomTags(ssot);

  // Phase D: 프롬프트 조립 + Claude 호출
  const messages = buildMessages(ssot, postType, angle, factSheet, ctaBlock, localSeo, { searchIntent, multiCTA });
  if (symptomTags.length) messages.user += `\n\n<symptom_hashtags>\n${symptomTags.join(' ')}\n위 증상 해시태그를 반드시 포함하세요.\n</symptom_hashtags>`;
  messages.user += `\n\n<title_hint>\n참고 제목 패턴 (이 패턴을 기반으로 자연스럽게 변형): ${titleHint}\n</title_hint>`;

  // Blog1 정보형 구조 지시
  messages.user += `\n\n<blog1_structure>
이 글은 정보형(검색 유입 극대화) 글입니다.
${BLOG1_INFO_STRUCTURE}

제목에 증상/부품 키워드를 넣고, 본문 첫 2문장에서 검색 질문에 대한 핵심 답변을 바로 제시하세요.
교육적이면서도 실제 사례 기반으로 신뢰감 있게 작성하세요.
</blog1_structure>`;

  const generated = await callClaude(messages, MODEL);

  // Phase F: 검증
  const warnings = validateGenerated(generated, factSheet, ssot);

  // Strip markdown bold markers (**) — AI 느낌 제거
  if (generated.body) generated.body = generated.body.replace(/\*\*/g, '');

  // imageAlts → SEO 파일명 변환
  const seoFileNames = (generated.imageAlts || []).map((alt, i) => {
    const clean = alt.replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-');
    const truncated = clean.slice(0, 50);
    return `${truncated || `투베이스-작업사진-${i + 1}`}.jpg`;
  });

  const output = {
    postId:      ssot.postId,
    originalUrl: ssot.originalUrl,
    publishedAt: ssot.publishedAt,
    vehicle:     ssot.vehicle,
    work:        ssot.work,
    images: {
      dir:   ssot.images?.dir,
      files: ssot.images?.files || [],
      count: ssot.images?.count || 0,
      positions: ssot.images?.positions || [],
      seoFileNames,
      imageAlts: generated.imageAlts || [],
    },
    meta: {
      postType,
      searchIntent,
      angle:     angle.id,
      titleHint,
      factsUsed:  factSheet.facts.length,
      forbidden:  factSheet.forbidden.length,
      warnings:   warnings.length,
      localSeo: {
        rotatingHashtags: localSeo.rotatingHashtags,
        highVolTag: localSeo.highVolTag,
        longTailTag: localSeo.longTailTag,
        bodyRegion: localSeo.bodyRegion,
        village: localSeo.village,
        landmark: localSeo.landmark,
      },
    },
    naver: {
      titles:      generated.titles || (generated.title ? [generated.title] : []),
      title:       (generated.titles || [])[0] || generated.title || '',
      body:        generated.body,
      cta:         generated.cta,
      hashtags:    generated.hashtags,
      seoKeywords: generated.seoKeywords,
    },
    validation:  ssot.validation,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(path.join(ROOT, PUBLISH_DIR), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2));

  // warning이 있으면 리포트 저장
  if (warnings.length) {
    await mkdir(path.join(ROOT, WARN_DIR), { recursive: true });
    const warnPath = path.join(ROOT, WARN_DIR, `${ssot.postId}.txt`);
    const report = [
      `postId: ${ssot.postId}`,
      `postType: ${postType}`,
      `angle: ${angle.id}`,
      `warnings: ${warnings.length}`,
      '',
      ...warnings,
      '',
      `생성된 제목: ${generated.title}`,
    ].join('\n');
    await writeFile(warnPath, report);
  }

  return { status: 'ok', postType, angle: angle.id, warnings: warnings.length };
}

// ═══════════════════════════════════════════════════
// Blog2 생성 로직
// ═══════════════════════════════════════════════════
async function generateBlog2Post(ssotPath) {
  const ssot = await loadJson(ssotPath, null);
  if (!ssot) return { status: 'no_ssot' };

  const blog1Path = path.join(ROOT, PUBLISH_DIR, `${ssot.postId}.json`);
  if (!await exists(blog1Path)) return { status: 'no_blog1' }; // blog1 필수

  const outPath = path.join(ROOT, PUBLISH_DIR, `${ssot.postId}_blog2.json`);
  if (!FORCE && await exists(outPath)) return { status: 'skipped' };

  // blog1 데이터 로드
  const blog1 = await loadJson(blog1Path, null);
  if (!blog1) return { status: 'no_blog1' };

  const blog1Type = blog1.meta?.postType || classifyPostType(ssot);
  const blog1AngleId = blog1.meta?.angle || 'symptom';
  const blog1Title = blog1.naver?.title || (blog1.naver?.titles || [])[0] || '';

  // Blog2 유형: blog1과 다른 유형 강제
  const postType = BLOG2_TYPE_MAP[blog1Type] || 'technical_deep_dive';
  if (postType === 'skip') return { status: 'skipped_type', postType };

  // 검색의도: Blog2 = 거래형
  const searchIntent = 'transactional';

  // 팩트시트
  const factSheet = buildFactSheet(ssot);

  // Blog2 앵글: blog1과 다른 앵글
  const angle = selectBlog2Angle(ssot, factSheet, blog1AngleId);

  // 다중 CTA (거래형)
  const hasParts = (ssot.work?.parts || []).length > 0;
  const ctaBlock = buildContextualCTA(postType, hasParts, true);
  const multiCTA = buildMultiCTA(ssot, searchIntent);

  // 지역 SEO
  const localSeo = selectLocalSEO(ssot.postId, ssot);

  // 제목 힌트 — Blog2 거래형 패턴
  const titleHint = suggestBlog2TitlePattern(ssot, localSeo);

  // 차별화 지시문
  const diffInstruction = BLOG2_DIFFERENTIATION[postType] || BLOG2_DIFFERENTIATION.technical_deep_dive;

  // 증상 기반 SEO 해시태그 매칭
  const symptomTags = matchSymptomTags(ssot);

  // 프롬프트 조립 + Blog2 차별화 추가
  const messages = buildMessages(ssot, postType, angle, factSheet, ctaBlock, localSeo, { searchIntent, multiCTA });
  if (symptomTags.length) messages.user += `\n\n<symptom_hashtags>\n${symptomTags.join(' ')}\n위 증상 해시태그를 반드시 포함하세요.\n</symptom_hashtags>`;
  messages.user += `\n\n<title_hint>\n참고 제목 패턴 (이 패턴을 기반으로 자연스럽게 변형): ${titleHint}\n</title_hint>`;

  // Blog2 거래형 구조 지시
  messages.user += `\n\n<blog2_structure>
이 글은 거래형(전환 극대화) 글입니다.
${BLOG2_TXN_STRUCTURE}

제목에 차종+작업명을 넣고, 시공 결과와 체감 변화에 집중하세요.
</blog2_structure>`;

  // Blog2 차별화 블록
  messages.user += `\n\n<blog2_differentiation>
${diffInstruction}
</blog2_differentiation>

<blog2_format>
- 섹션 구분: ■ 대신 ▸ 사용
- 이미지: 핵심 결과 사진을 상단에 배치하되, 본문 첫 줄은 반드시 텍스트 문장으로 시작. [사진N]으로 시작 금지.
- 사진 설명: 기술 스펙이 아닌 체감 차이 중심으로 작성
- CTA: 테이블 대신 본문 마지막 단락에 자연스럽게 녹여서
  예) "궁금하신 점은 전화(010-4150-3199)나 톡톡으로 편하게 문의해 주세요."
- 강조: 볼드 대신 「인용」 스타일
- 구조: 결과/변화 먼저 → 작업 과정 → 왜 필요했는지 (역시간순)
- 도입부: 결과/체감 변화를 바로 서술. "~보여드립니다", "~기록부터" 같은 메타 표현 금지.
  좋은 예: "브렘보 4P4P 풀세팅 후 노즈다운이 확 줄었습니다."
  좋은 예: "작업 끝나고 시운전하니 제동감이 완전히 달라졌습니다."
  나쁜 예: "완료 기록부터 보여드립니다." (블로그 구조를 설명하는 메타 발언)
  나쁜 예: "먼저 결과부터 말씀드리겠습니다." (마찬가지)
- 해시태그 차별화: Blog1과 겹치는 태그를 최소화. 필수 태그(지역/브랜드) 외에는 증상 키워드(#떨림, #소음, #밀림 등), 체감 키워드(#제동력향상, #노즈다운개선 등), 롱테일 키워드 위주로 채우세요.

Blog 1과 문장/표현을 공유하지 마세요. 같은 팩트를 다른 관점에서 서술하세요.
</blog2_format>`;

  if (blog1Title) {
    messages.user += `\n\n<blog1_title_reference>
아래 Blog 1 제목과 완전히 다른 톤의 제목을 작성하세요:
Blog 1 제목: "${blog1Title}"
</blog1_title_reference>`;
  }

  const generated = await callClaude(messages, MODEL);

  // 검증
  const warnings = validateGenerated(generated, factSheet, ssot);

  // Strip markdown bold
  if (generated.body) generated.body = generated.body.replace(/\*\*/g, '');

  // imageAlts → SEO 파일명
  const seoFileNames = (generated.imageAlts || []).map((alt, i) => {
    const clean = alt.replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-');
    const truncated = clean.slice(0, 50);
    return `${truncated || `투베이스-작업사진-${i + 1}`}.jpg`;
  });

  const output = {
    postId:      ssot.postId,
    originalUrl: ssot.originalUrl,
    publishedAt: ssot.publishedAt,
    vehicle:     ssot.vehicle,
    work:        ssot.work,
    images: {
      dir:   ssot.images?.dir,
      files: ssot.images?.files || [],
      count: ssot.images?.count || 0,
      positions: ssot.images?.positions || [],
      seoFileNames,
      imageAlts: generated.imageAlts || [],
    },
    meta: {
      postType,
      searchIntent,
      angle:     angle.id,
      variant:   'blog2',
      blog1Type,
      blog1Angle: blog1AngleId,
      titleHint,
      factsUsed:  factSheet.facts.length,
      forbidden:  factSheet.forbidden.length,
      warnings:   warnings.length,
      localSeo: {
        rotatingHashtags: localSeo.rotatingHashtags,
        highVolTag: localSeo.highVolTag,
        longTailTag: localSeo.longTailTag,
        bodyRegion: localSeo.bodyRegion,
        village: localSeo.village,
        landmark: localSeo.landmark,
      },
    },
    naver: {
      titles:      generated.titles || (generated.title ? [generated.title] : []),
      title:       (generated.titles || [])[0] || generated.title || '',
      body:        generated.body,
      cta:         generated.cta,
      hashtags:    generated.hashtags,
      seoKeywords: generated.seoKeywords,
    },
    validation:  ssot.validation,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(path.join(ROOT, PUBLISH_DIR), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2));

  // warning 리포트
  if (warnings.length) {
    await mkdir(path.join(ROOT, WARN_DIR), { recursive: true });
    const warnPath = path.join(ROOT, WARN_DIR, `${ssot.postId}_blog2.txt`);
    const report = [
      `postId: ${ssot.postId} (blog2)`,
      `postType: ${postType} (blog1: ${blog1Type})`,
      `angle: ${angle.id} (blog1: ${blog1AngleId})`,
      `warnings: ${warnings.length}`,
      '',
      ...warnings,
      '',
      `생성된 제목: ${generated.title}`,
    ].join('\n');
    await writeFile(warnPath, report);
  }

  return { status: 'ok', postType, angle: angle.id, warnings: warnings.length };
}

// ═══════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════
async function main() {
  const modeLabel = BLOG2_MODE ? 'Blog2' : 'V2';
  console.log(`네이버 블로그 글 생성 ${modeLabel} 시작...`);
  console.log(`모델: ${MODEL} | 동시성: ${CONCURRENCY} | 제한: ${LIMIT || '없음'}${BLOG2_MODE ? ' | --blog2 모드' : ''}\n`);

  // 키워드 볼륨 캐시 로드
  const kvCache = await loadKeywordVolumeCache();
  const cachedMap = cacheToVolumeMap(kvCache);
  if (cachedMap) KEYWORD_VOLUME_MAP = cachedMap;

  let ssotFiles = (await readdir(path.join(ROOT, SSOT_DIR)).catch(() => []))
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  // 타겟 postId 지정 시 해당 파일만 처리
  if (TARGET_IDS.length > 0) {
    const idSet = new Set(TARGET_IDS);
    ssotFiles = ssotFiles.filter(f => idSet.has(f.replace('.json', '')));
    console.log(`타겟 모드: ${TARGET_IDS.join(', ')} (${ssotFiles.length}개)${FORCE ? ' [--force]' : ''}\n`);
  } else {
    console.log(`SSOT 파일: ${ssotFiles.length}개${FORCE ? ' [--force]' : ''}\n`);
  }

  // 키워드 볼륨 기반 우선순위 정렬
  if (PRIORITIZE && TARGET_IDS.length === 0) {
    console.log('키워드 볼륨 기반 우선순위 정렬 중...');
    const scored = [];
    for (const f of ssotFiles) {
      const ssot = await loadJson(path.join(ROOT, SSOT_DIR, f), null);
      const score = ssot ? calcPriorityScore(ssot) : 0;
      scored.push({ file: f, score });
    }
    scored.sort((a, b) => b.score - a.score);
    ssotFiles = scored.map(s => s.file);

    // 상위 10건 미리보기
    const top10 = scored.slice(0, 10);
    console.log('\n상위 10건 우선순위:');
    for (const { file, score } of top10) {
      console.log(`  ${score.toString().padStart(5)}점 | ${file}`);
    }
    console.log('');
  }

  const stats = { ok: 0, skipped: 0, skippedType: 0, failed: 0 };
  const typeDist  = {};
  const angleDist = {};
  let warnTotal = 0;

  const generateFn = BLOG2_MODE ? generateBlog2Post : generateBlogPost;

  const tasks = ssotFiles.map(f => async () => {
    if (LIMIT && stats.ok + stats.skipped >= LIMIT) return;
    try {
      const r = await generateFn(path.join(ROOT, SSOT_DIR, f));
      if (r.status === 'ok') {
        stats.ok++;
        typeDist[r.postType]  = (typeDist[r.postType] || 0) + 1;
        angleDist[r.angle]    = (angleDist[r.angle] || 0) + 1;
        warnTotal += r.warnings;
        process.stdout.write('.');
      } else if (r.status === 'skipped') {
        stats.skipped++;
        process.stdout.write('s');
      } else if (r.status === 'skipped_type') {
        stats.skippedType++;
        process.stdout.write('-');
      } else {
        stats.failed++;
        process.stdout.write('!');
      }
    } catch (err) {
      stats.failed++;
      process.stdout.write('!');
      console.error(`\n[ERR] ${f}: ${err.message}`);
    }
    if ((stats.ok + stats.skipped) % 50 === 0 && stats.ok + stats.skipped > 0) {
      process.stdout.write(` ${stats.ok + stats.skipped}/${ssotFiles.length}\n`);
    }
  });

  // 병렬 실행
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < tasks.length) { await tasks[idx++](); }
  });
  await Promise.all(workers);

  console.log(`\n\n═══ ${modeLabel} 생성 완료 ═══`);
  console.log(`생성: ${stats.ok} | 스킵(기존): ${stats.skipped} | 스킵(유형): ${stats.skippedType} | 실패: ${stats.failed}`);
  console.log(`경고 총: ${warnTotal}건`);
  console.log(`\n포스트 유형 분포:`);
  for (const [t, n] of Object.entries(typeDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`);
  }
  console.log(`\n앵글 분포:`);
  for (const [a, n] of Object.entries(angleDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${a}: ${n}`);
  }
  console.log(`\n저장: ${PUBLISH_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
