# SSOT → 네이버 블로그 콘텐츠 자동화 스킬 레퍼런스

> **용도**: 이 문서는 투베이스(2BASS) 브레이크 튜닝샵에서 구축한 "오프라인 유입용 블로그 콘텐츠 자동화 시스템"의 전체 설계를 기록합니다.
> 다른 업종(헬스PT, 네일샵, 자동차 정비 등)에서 동일한 구조로 시스템을 구축할 때 참조하세요.

---

## 1. 시스템 개요

### 1.1 목적

오프라인 매장의 기존 작업 사례(블로그, SNS, 메모 등)를 **구조화된 데이터(SSOT)**로 변환하고,
이를 기반으로 **네이버 블로그 / 인스타그램 / 당근마켓** 등 멀티 플랫폼 콘텐츠를 자동 생성하여
**검색 유입 → 오프라인 방문 전환**을 극대화하는 파이프라인.

### 1.2 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **팩트 기반** | 원문에 있는 내용만 사용. 없는 내용은 forbidden 리스트로 차단 |
| **SSOT (Single Source of Truth)** | 모든 플랫폼이 동일한 데이터 소스를 공유. 정보 불일치 방지 |
| **날조 방지** | AI 생성 후 forbidden 키워드 침투 + 감정 창작 자동 감지 |
| **플랫폼별 최적화** | 같은 팩트, 다른 길이/톤/CTA |

### 1.3 전체 파이프라인

```
[소스 수집]       [데이터 구조화]        [AI 보강]           [콘텐츠 생성]        [발행]
   PDF            텍스트 추출           소비자 분석          네이버 블로그        HTML 대시보드
   블로그     →   포스트 분리      →   매출 맥락 추출  →   인스타그램      →   발행 뷰
   메모            중복 제거             팩트시트 구축        당근마켓             상태 추적
                   SSOT 구축                                 상품 카탈로그
```

### 1.4 실행 순서

```bash
# Phase 1: 소스 → 텍스트
node scripts/ssot-sync.js                    # PDF 해시/인덱싱
node scripts/content-parse-pdf.js            # PDF → 텍스트 블록 추출
node scripts/content-segment-posts.js        # 개별 포스트 분리
node scripts/content-dedupe-posts.js         # URL 기반 중복 제거

# Phase 2: 텍스트 → SSOT (LLM 사용)
node scripts/content-build-ssot.js           # Claude로 구조화 (차량/작업/난이도)
node scripts/content-enrich-ssot.js          # 규칙 기반 보강 (브랜드/부품 정규화)
node scripts/content-enrich-consumer.js      # Claude로 소비자 수요 분석
node scripts/content-enrich-sales.js         # Claude로 매출 맥락 추출

# Phase 3: 이미지 추출 (병렬 가능)
node scripts/content-extract-images.js       # PDF에서 이미지 추출

# Phase 4: 콘텐츠 생성 (LLM 사용)
node scripts/content-generate-naver-blog.js  # 네이버 블로그 글 생성
node scripts/_fix-ai-tone.js                 # 톤 후처리 (과장 제거)
node scripts/content-generate-meta.js        # 인스타그램 캡션 생성
node scripts/content-generate-daangn.js      # 당근마켓 소식 생성

# Phase 5: 발행 준비
node scripts/naver-blog-publish-html.js      # 대시보드 + HTML 변환
node scripts/content-build-product-catalog.js # 상품 카탈로그 생성
```

---

## 2. LLM 사용 지점 (비용 발생)

| 단계 | 스크립트 | 모델 | 건당 토큰 | 용도 |
|------|---------|------|----------|------|
| SSOT 구조화 | `content-build-ssot.js` | haiku | ~1,500 in / ~500 out | 원문 → 차량/작업/난이도 JSON 추출 |
| 소비자 분석 | `content-enrich-consumer.js` | haiku | ~1,200 in / ~600 out | 타겟 고객 페르소나 + 검색 키워드 생성 |
| 매출 맥락 | `content-enrich-sales.js` | haiku | ~2,000 in / ~800 out | 소개/보증/가격/재방문 등 추출 |
| **블로그 생성** | `content-generate-naver-blog.js` | **sonnet** | ~2,500 in / ~1,500 out | 제목+본문+CTA+해시태그 작성 |
| 인스타 생성 | `content-generate-meta.js` | sonnet | ~2,000 in / ~500 out | 200~400자 캡션 + 해시태그 |
| 당근 생성 | `content-generate-daangn.js` | sonnet | ~2,000 in / ~500 out | 200~400자 동네소식 |

### LLM을 사용하지 않는 단계 (규칙 기반)

| 단계 | 방식 |
|------|------|
| PDF 텍스트 추출 | pdfjs-dist 라이브러리 |
| 포스트 분리 | 정규식 (타임스탬프 + URL 패턴) |
| 중복 제거 | URL 해시 비교 |
| 이미지 추출 | pdfjs-dist + @napi-rs/canvas |
| 포스트 유형 분류 | 규칙 기반 코드 (classifyPostType) |
| 팩트시트/forbidden | 규칙 기반 코드 (buildFactSheet) |
| 톤 후처리 | 정규식 치환 (_fix-ai-tone.js) |
| HTML 변환/대시보드 | 템플릿 코드 |
| 상품 카탈로그 | 집계 코드 |

### 비용 추정 (API 기준)

| 규모 | 네이버만 | 3개 플랫폼 |
|------|---------|-----------|
| 100건 | ~$3 (4,000원) | ~$6 (8,000원) |
| 500건 | ~$15 (2만원) | ~$30 (4만원) |
| 1,912건 | ~$56 (7.5만원) | ~$116 (15만원) |

> Claude CLI 구독 사용 시 별도 API 비용 없음

---

## 3. SSOT 데이터 스키마 (전체)

### 3.1 핵심 구조

```json
{
  "postId": "cnt_01624ba2f1d2_post_01",
  "contentId": "cnt_01624ba2f1d2",
  "originalUrl": "http://blog.naver.com/2basstune/221313250146",
  "publishedAt": "2018/07/06 08:00",
  "sourcePdf": "투베이스_블로그_144-1.pdf",
  "pageRange": { "start": 1, "end": 17 },

  "title": {
    "original": "그랜저TG 브램보4P+EQ900 리어2P 풀셋 인스톨!...",
    "clean": "그랜저 TG 브렘보 4P + EQ900 리어 2P 풀셋 설치"
  },

  "vehicle": {
    "brand": "현대",
    "model": "그랜저 TG",
    "note": "세월이 지나도 깔끔한 상태 유지"
  },

  "work": {
    "type": "풀셋 브레이크 업그레이드",
    "parts": ["브렘보 4P 캘리퍼 (프론트)", "썬디스크 355mm (프론트)"],
    "challenge": "원래 6P 사양이었으나 차주 요청으로 4P로 조정",
    "solution": "고객 요청사항 반영으로 최적 성능-가격 비율 달성",
    "duration": "당일 완료 (설치 + 시운전 + 하체 점검)"
  },

  "keyPoints": [
    "피스톤 갯수보다 종합적 제동성능 고려의 중요성",
    "전문샵 상담으로 중복투자 방지"
  ],

  "difficulty": "상",
  "originalText": "오늘은 그랜저 TG 에...",

  "images": {
    "count": 8,
    "dir": "output/images/cnt_xxx_post_01",
    "files": ["img_001.jpg", "img_002.jpg"]
  },

  "validation": {
    "partsVerified": true,
    "partsFound": ["브렘보", "EQ900"],
    "reviewNeeded": false
  }
}
```

### 3.2 소비자 분석 (consumer) — LLM 생성

```json
{
  "consumer": {
    "directDemand": {
      "who": "현대 그랜저 TG 소유자 중 제동력 부족을 경험한 사람",
      "symptom": "브레이크 응답성이 둔함, '브레이크가 밀린다'는 불만",
      "searchQueries": [
        "그랜저 TG 브레이크 업그레이드",
        "그랜저 브렘보 캘리퍼 설치",
        "파주 브레이크 전문점"
      ]
    },
    "expandedDemand": [
      {
        "segment": "같은 차종, 다른 튜닝 관심층",
        "reason": "브레이크 업그레이드 시 다른 부분도 함께 검토",
        "searchQueries": ["그랜저 TG 튜닝 추천"]
      },
      {
        "segment": "파주/일산 지역 거주 자동차 매니아",
        "reason": "신뢰할 수 있는 로컬 전문샵을 찾는 중",
        "searchQueries": ["파주 브레이크 전문점 추천", "일산 자동차 튜닝샵"]
      }
    ],
    "conversionHook": "'중복투자 방지' 메시지로 전문성 신뢰 확보",
    "priceRange": "견적문의 (예상 400-700만원대)",
    "urgency": "high",
    "seasonality": "봄 드라이빙 시즌 전 점검 수요"
  }
}
```

### 3.3 매출 맥락 (salesContext) — LLM 생성

```json
{
  "salesContext": {
    "modelCount": 3,
    "relatedPosts": {
      "sameVehicle": ["cnt_xxx_post_03"],
      "sameWorkOrParts": ["cnt_yyy_post_02"]
    },
    "referral": {
      "hasReferral": false,
      "source": null,
      "sourceVehicle": null
    },
    "customerRegion": null,
    "warranty": null,
    "specComparison": {
      "before": null,
      "after": "프론트: 브렘보 4P + 썬디스크 355mm",
      "improvement": "제동력 향상"
    },
    "crossSell": ["메쉬호스 (옵션)", "홍성패드 (옵션)"],
    "returnVisit": { "mentioned": true, "reason": "정기적 패드/부품 교체" },
    "freeServices": ["시운전", "하체 점검", "주의사항 안내"],
    "urgencySignal": "브레이크 페달 반응 저하 — 안전 위험",
    "emotionalTrigger": "순정부품 한계 불만 → 전문 상담으로 신뢰 회복",
    "trustSignal": ["다수 시공 경험", "정밀 실측 맞춤 제작", "시운전 재검증"],
    "priceHint": "예산 범위 내 최적 조합 제시",
    "uniqueSellingPoint": "운전습관 맞춤 설계 + 직접 제작 능력"
  }
}
```

### 3.4 다른 업종 적용 시 스키마 매핑

| 투베이스 (브레이크) | 헬스PT | 네일샵 | 일반화 |
|---------------------|--------|--------|--------|
| `vehicle.brand` | `client.goal` (다이어트/근력) | `client.type` (젤/아트) | `subject.category` |
| `vehicle.model` | `client.level` (초보/중급) | `client.style` (트렌디/클래식) | `subject.detail` |
| `work.type` | `program.type` (PT/GX) | `service.type` (케어/디자인) | `service.type` |
| `work.parts` | `program.equipment` | `service.materials` | `service.components` |
| `work.challenge` | `client.concern` | `client.request` | `challenge` |
| `work.solution` | `trainer.approach` | `artist.technique` | `solution` |
| `work.duration` | `session.duration` | `service.duration` | `duration` |
| `difficulty` | `program.intensity` | `design.complexity` | `complexity` |
| `keyPoints` | `results.highlights` | `design.highlights` | `highlights` |

---

## 4. 콘텐츠 생성 상세 (content-generate-naver-blog.js)

### 4.1 6-Phase 생성 프로세스

```
Phase A: 포스트 유형 분류 (classifyPostType)
    ↓
Phase B: 팩트시트 + forbidden 목록 구축 (buildFactSheet)
    ↓
Phase C: 도입부 앵글 선택 (selectAngle)
    ↓
Phase D: 프롬프트 조립 + Claude 호출
    ↓
Phase E: CTA 블록 조립 (buildContextualCTA)
    ↓
Phase F: 생성 결과 검증 (validateGenerated)
```

### 4.2 Phase A: 포스트 유형 분류 (6가지)

```javascript
function classifyPostType(ssot) {
  // 1. skip: 이벤트/공지 (브레이크 관련 아니면 제외)
  if (skipWords포함 && 부품에 브레이크 없음) return 'skip';

  // 2. customer_story: 소개/추천 경유로 방문
  if (referral있음 && 원문에 소개/추천 언급) return 'customer_story';

  // 3. technical_deep_dive: 난이도 상 + 커스텀/제작
  if (난이도 === '상' && 원문에 커스텀/제작 언급) return 'technical_deep_dive';

  // 4. parts_comparison: 순정 vs 튜닝 비교
  if (specComparison 존재 && 원문에 비교 언급) return 'parts_comparison';

  // 5. maintenance_guide: 낮은 난이도 + 패드교체/연마 등
  if (난이도 하~중 && 패드교체/연마/액교환 언급) return 'maintenance_guide';

  // 6. case_study: 기본값
  return 'case_study';
}
```

**다른 업종 적용 예시 (헬스PT):**

| 유형 | 조건 | 설명 |
|------|------|------|
| `skip` | 이벤트/할인 공지 | 콘텐츠 아닌 것 제외 |
| `transformation` | 비포/애프터 사진 + 체중 변화 | 변화 스토리 |
| `program_guide` | 특정 운동 프로그램 설명 | 교육형 콘텐츠 |
| `client_story` | 고객 후기/인터뷰 | 사회적 증거 |
| `expert_tip` | 전문 지식/팁 | 전문성 어필 |
| `case_study` | 기본 운동/트레이닝 사례 | 일반 사례 |

### 4.3 Phase B: 팩트시트 + Forbidden 구축

**팩트시트**: 원문에서 확인된 사실만 모아서 AI에게 "이것만 써라" 전달

```
━━━ 사용 가능한 팩트 (이것만 사용) ━━━
1. 차량: 현대 그랜저 TG
2. 작업: 풀셋 브레이크 업그레이드
3. 부품: 브렘보 4P 캘리퍼, 썬디스크 355mm
4. 고객 문제: 브레이크가 밀린다
5. 해결방법: 4P 사양으로 최적화
6. 작업시간: 당일 완료
7. 핵심포인트: 중복투자 방지, 맞춤 제작
```

**Forbidden 리스트**: 원문에 근거 없는 내용 명시적 차단

```
━━━ 절대 금지 (날조 방지) ━━━
❌ AS 보증 조건 "1년 무상 A/S" (원문에 근거 없음)
❌ 고객 출발지 "대전" (원문에 근거 없음)
❌ 무료 서비스 "캘리퍼 도장" (원문에 근거 없음)
❌ 고객 반응/감상 창작 (원문에 명시된 것만 가능)
❌ 원문에 없는 스펙 수치나 기술 데이터
```

**검증 규칙 (7가지):**

| # | 필드 | 검증 방법 | 통과 시 | 실패 시 |
|---|------|----------|---------|---------|
| 1 | `referral` (소개/추천) | 원문에 "소개/추천/입소문" 키워드 | 팩트에 추가 | forbidden에 추가 |
| 2 | `warranty` (보증) | 원문에 "보증/AS/워런티" 키워드 | 팩트에 추가 | forbidden에 추가 |
| 3 | `customerRegion` (출발지) | 원문에 지역명 또는 "지방/서울" 등 | 팩트에 추가 | forbidden에 추가 |
| 4 | `specComparison` (스펙비교) | 원문에 "비교/순정/차이" 키워드 | 팩트에 추가 | forbidden에 추가 |
| 5 | `freeServices` (무료서비스) | 원문에 각 서비스명 키워드 | 개별 검증 | 미검증 항목만 forbidden |
| 6 | `crossSell` (추가작업) | 원문에 각 작업명 키워드 | 팩트에 추가 | 조용히 제외 |
| 7 | `priceHint` (가격) | 원문에 "가격/비용/예산" 키워드 | 팩트에 추가 | forbidden에 추가 |

### 4.4 Phase C: 앵글 선택 (8가지 도입부 스타일)

```javascript
const ANGLES = [
  { id: 'symptom',       check: s => s.consumer?.directDemand?.symptom },
  { id: 'vehicle_story', check: s => s.vehicle?.note },
  { id: 'before_after',  check: (s,v) => v.specComparison },
  { id: 'value',         check: (s,v) => v.freeServices || v.priceHint },
  { id: 'expertise',     check: s => ['상','중상'].includes(s.difficulty) },
  { id: 'community',     check: s => /동호회|커뮤니티|카페/.test(s.originalText) },
  { id: 'urgency',       check: s => s.consumer?.urgency === 'high' },
  { id: 'education',     check: s => (s.keyPoints || []).length >= 4 },
];

// 결정론적 선택: postId 해시값 → 적격 앵글 중 하나
selectAngle(ssot) → hashCode(postId) % eligible.length
```

| 앵글 | 도입 방식 | 프롬프트 예시 |
|------|----------|-------------|
| `symptom` | 증상/불편 공감 | "브레이크를 밟을 때마다 끝까지 밀리는 느낌, 불안하시죠?" |
| `vehicle_story` | 차량 특성에서 시작 | "세월이 지나도 매력적인 그랜저 TG, 제동력만 보강하면..." |
| `before_after` | 순정→튜닝 비교 | "순정 280mm에서 355mm로, 체감 변화가 확실합니다" |
| `value` | 가성비/무료서비스 | "시운전+하체점검까지 무료로 제공합니다" |
| `expertise` | 전문성 강조 | "일반 샵에서는 하기 어려운 작업, 왜 전문점이 필요한지" |
| `community` | 동호회/입소문 | "동호회에서 소문 듣고 찾아오셨습니다" |
| `urgency` | 긴급/시즌 | "장마철 전 제동력 점검, 미루지 마세요" |
| `education` | 기술 교육 | "피스톤 수보다 중요한 종합 제동성능, 알고 계셨나요?" |

**다른 업종 앵글 예시 (헬스PT):**

| 앵글 | 도입 방식 |
|------|----------|
| `pain_point` | "앉아 있으면 허리가 아프고, 계단만 올라가도 숨이 차시죠?" |
| `transformation` | "3개월 만에 체지방 8% 감량, 비포/애프터 확인해보세요" |
| `seasonal` | "여름 수영복 시즌 D-90, 지금 시작하면 딱 맞습니다" |
| `expert_tip` | "스쿼트할 때 무릎이 발끝을 넘으면 안 된다? 사실은..." |
| `social_proof` | "회원님 소개로 오신 분이 벌써 10명째입니다" |

### 4.5 Phase D: Claude 프롬프트 전체 구조

```
당신은 {업종} 전문 "{업체명}"의 블로그 마케터입니다.
{경력} 경력, {위치} 소재.

━━━ 사용 가능한 팩트 (이것만 사용) ━━━
{facts 목록}

━━━ 절대 금지 (날조 방지) ━━━
{forbidden 목록}

━━━ 원본 본문 (참고용, 그대로 쓰지 말 것) ━━━
{originalText.slice(0, 1500)}

━━━ 글 구조 ━━━
포스트 유형: {postType}
구조: {구조 템플릿}

━━━ 도입부 앵글: {angle.label} ━━━
{앵글별 지시문}

━━━ 소비자 검색 키워드 (SEO 참고) ━━━
{consumer.directDemand.searchQueries}

━━━ CTA (하단 고정) ━━━
{ctaBlock}

━━━ 작성 규칙 ━━━
1. 제목: 60자 이내. SEO 최적화.
2. 본문: 800-1500자. 친근하지만 전문적.
3. 절대 금지 목록 내용 포함 금지.
4. 고객 감정/반응은 원문에 명시된 것만.
5. 해시태그: 10-15개.
6. 지나친 광고 지양. 팩트 기반 신뢰감.

JSON 출력:
{
  "title": "...",
  "body": "...",
  "cta": "...",
  "hashtags": [...],
  "seoKeywords": [...]
}
```

**구조 템플릿 (포스트 유형별):**

| 유형 | 구조 |
|------|------|
| `case_study` | 도입(앵글) → 차량/상황 소개 → 작업 과정 상세 → 결과 → 마무리 |
| `parts_comparison` | 도입(앵글) → 순정 vs 교체 분석 → 장착 과정 → 체감 변화 → 적합 차종 안내 |
| `maintenance_guide` | 도입(교육) → 작업 소개 → 과정(쉬운 설명) → 주의사항 → 점검 주기 안내 |
| `customer_story` | 도입(소개 경위) → 고객 니즈 → 솔루션 → 결과 → 재방문/만족 |
| `technical_deep_dive` | 도입(왜 어려운지) → 기술 배경 → 상세 과정 → 성과 → 해당 차종 안내 |

### 4.6 Phase E: CTA (유형별 맞춤)

```javascript
const CTA_LEADINS = {
  case_study:          '비슷한 증상이라면 정확한 진단이 먼저입니다.',
  parts_comparison:    '내 차에 맞는 사양이 궁금하시면 편하게 문의하세요.',
  maintenance_guide:   '교체 시기가 궁금하시면 무료 점검 가능합니다.',
  technical_deep_dive: '일반 샵에서 거절당한 작업도 상담 가능합니다.',
  customer_story:      '주변 분들의 소개로 많이 찾아주십니다.',
};
```

**CTA 블록 구성:**

```
{유형별 리드인 문장}

📍 네이버 예약 → {place URL}
💬 네이버 톡톡 문의 → {talk URL}
🛒 부품 구매 → {store URL}          ← 부품 관련 글에만 표시
```

**다른 업종 CTA 예시 (헬스PT):**

```javascript
const CTA = {
  place:    'https://naver.me/xxxxx',        // 네이버 플레이스
  talk:     'https://talk.naver.com/xxxxx',   // 톡톡
  kakaoChannel: 'http://pf.kakao.com/xxxxx',  // 카카오 채널
  shopName: 'OO 피트니스',
  location: '강남/역삼',
  career:   '10년',
};

const CTA_LEADINS = {
  case_study:    '비슷한 고민이시라면 무료 체험 수업으로 시작해보세요.',
  transformation:'나도 변할 수 있을까? 체험 수업에서 직접 확인해보세요.',
  program_guide: '어떤 프로그램이 맞는지 무료 상담해드립니다.',
  expert_tip:    '정확한 자세가 궁금하시면 전문 트레이너에게 물어보세요.',
  client_story:  '지인 소개 시 할인 혜택이 있습니다.',
};
```

### 4.7 Phase F: 생성 후 검증

```javascript
function validateGenerated(generated, factSheet, ssot) {
  const warnings = [];

  // 1. forbidden 키워드 침투 체크
  for (const fb of factSheet.forbidden) {
    // forbidden 항목에서 "따옴표 안 키워드" 추출
    // 생성된 본문에 해당 키워드가 있으면 경고
    if (body.includes(keyword))
      warnings.push('[FORBIDDEN 침투] "키워드" 가 본문에 포함됨');
  }

  // 2. 감정 창작 감지
  const emotionPatterns = [
    '감동', '눈물', '감격', '행복해', '최고였',
    '인생샵', '대만족', '너무 좋아', '완전 달라',
    '세상 달라', '다른 차가 된'
  ];
  for (const ep of emotionPatterns) {
    if (본문에있고 && 원문에없으면)
      warnings.push('[감정 창작 의심] "표현" — 원문에 없음');
  }

  return warnings; // warnings > 0이면 _warnings/ 폴더에 리포트 저장
}
```

---

## 5. 톤 후처리 (_fix-ai-tone.js)

AI가 생성한 글의 "AI 느낌"을 제거하는 8단계 후처리.

### 5.1 처리 순서

| # | 처리 | Before | After |
|---|------|--------|-------|
| 1 | `**bold**` 제거 | `**핵심 포인트**` | `핵심 포인트` |
| 2 | 구분선 통일 | `─── 고객 상황 ───` | `■ 고객 상황` |
| 3 | 안녕하세요 도입부 | (유지 — 삭제 로직 제거됨) | 브랜드 인지용 유지 |
| 4 | 과장 형용사 완화 | `완벽한 제동력` | `제동력` |
| 5 | 수사적 질문 완화 | `경험해보셨나요?` | `경험해보신 분들이 꽤 있습니다.` |
| 6 | ~습니다 밀도 조절 | 매 3번째 `~습니다` | `~요`로 변환 (33%) |
| 7 | 자기PR 과다 정리 | `저희 투베이스` 3회 이상 | 3회차부터 `저희`로 |
| 8 | 연속 빈줄 정리 | `\n\n\n\n` | `\n\n` |

### 5.2 과장 형용사 변환 목록

| Before | After |
|--------|-------|
| 완벽한 | (삭제) |
| 완벽하게 | 잘 |
| 탁월한 | 좋은 |
| 뛰어난 성능 | 좋은 성능 |
| 최적의 | 알맞은 |
| 최고의 | 좋은 |
| 확실한/확실하게 | (삭제) |
| 철저한 | 꼼꼼한 |
| 압도적인 | 확실한 |
| 놀라운 | (삭제) |
| 극적으로 | 확실히 |

### 5.3 ~습니다 → ~요 변환 (33% 비율)

```javascript
// 3번째마다 변환 시도 (전체의 ~33%)
const conversions = [
  [/있습니다/, '있어요'],
  [/됩니다/, '돼요'],
  [/없습니다/, '없어요'],
  [/했습니다/, '했어요'],
  [/가능합니다/, '가능해요'],
  [/필요합니다/, '필요해요'],
  [/입니다/, '이에요'],     // fallback
  [/합니다/, '해요'],       // fallback
];
```

**효과**: 100% `~습니다`체 → `~습니다`/`~요`/`~죠` 자연 혼합

---

## 6. 멀티 플랫폼 생성

### 6.1 공유 모듈 (_content-shared.js)

3개 생성 스크립트가 공유하는 함수들:

| 함수 | 용도 | 네이버 | 인스타 | 당근 |
|------|------|--------|--------|------|
| `classifyPostType()` | 포스트 유형 분류 | O | O | O |
| `buildFactSheet()` | 팩트+forbidden 구축 | O | O | O |
| `selectAngle()` | 앵글 선택 | O | O | X |
| `validateGenerated()` | 생성 결과 검증 | O | O | O |
| `callClaude()` | Claude API 호출 | O | O | O |
| `CTA` 상수 | 링크/주소 | O | X | X |

### 6.2 플랫폼별 차이

| 항목 | 네이버 블로그 | 인스타그램 | 당근마켓 |
|------|-------------|-----------|---------|
| **본문 길이** | 800~1,500자 | 200~400자 | 200~400자 |
| **톤** | 전문적 + 친근 혼합 | 전문+임팩트 (짧고 강렬) | 전문+친근 (해요체) |
| **구조** | ■ 섹션 헤더 + 단락 | 훅→핵심→CTA | 소개→내용→CTA |
| **CTA** | 네이버 예약 + 톡톡 + 스토어 | 프로필 링크 + DM | 채팅 문의 |
| **해시태그** | 10~15개 | 20~25개 (#메타트렌드) | 없음 |
| **이미지** | 본문 중간 삽입 | 동일 원본 | 동일 원본 |
| **출력** | `data/publish/naver-v2/` | `data/publish/meta/` | `data/publish/daangn/` |

### 6.3 인스타 프롬프트 핵심

```
━━━ 캡션 구조 (200~400자 이내) ━━━
1. [한줄 훅] — 증상/문제 공감
2. [차량 + 작업 핵심] — 1~2문장
3. [결과/포인트] — 1~2문장
4. [CTA] — "📍 프로필 링크에서 예약" / "💬 DM 문의"

━━━ 해시태그 (20~25개) ━━━
필수: #브레이크튜닝 #파주브레이크 #일산브레이크 #투베이스 #2bass
추가: 차종, 작업, 메타 트렌드 (#차스타그램 #카스타그램)
```

### 6.4 당근 프롬프트 핵심

```
━━━ 제목 ━━━
"{차종} {작업} 시공 완료 (파주/일산)" — 20~40자

━━━ 본문 (200~400자) ━━━
전문적이되 약간 친근 (~입니다 + ~요 혼합)
기술 용어 유지, 어려운 건 부연
지역 강조: 파주/일산 필수
해시태그 없음
CTA: 💬 채팅 문의
```

---

## 7. 상품 카탈로그 (content-build-product-catalog.js)

SSOT에서 브랜드그룹 × 작업유형 조합으로 상품 자동 생성.

### 7.1 브랜드 그룹 정규화

```javascript
const BRAND_GROUPS = {
  '국산': ['현대', '기아', '쌍용', '쉐보레', ...],
  '독일': ['BMW', 'AUDI', 'Mercedes-Benz', 'VW', ...],
  '일본': ['Infiniti', 'Honda', 'Toyota', 'Lexus', ...],
  '미국': ['Ford', 'Cadillac', 'Jeep', ...],
  // ...
};
```

### 7.2 작업 유형 정규화

```javascript
function normalizeWorkType(workType) {
  if (/풀셋|업그레이드|튜닝|캘리퍼.*설치/) return '브레이크 튜닝/업그레이드';
  if (/패드.*교체/) return '패드 교체';
  if (/디스크.*교체/) return '디스크 교체';
  if (/연마/) return '디스크 연마';
  if (/허브링/) return '허브링 커스텀 제작';
  if (/브레이크액/) return '브레이크액 교환';
  if (/도장/) return '캘리퍼 도장';
  // ...
}
```

### 7.3 상품 생성 규칙

- 브랜드그룹 × 작업유형 조합 → **3건 이상**이면 상품화
- 작업유형 단독 → **5건 이상**이면 공임 상품
- 쿠폰 템플릿 포함 (월간 무상점검 등)

### 7.4 출력 구조

```json
{
  "generatedAt": "...",
  "totalSsotPosts": 1912,
  "brandGroups": { "국산": { "brands": [...], "count": 636 } },
  "workTypes": { "브레이크 튜닝/업그레이드": { "count": 1540 } },
  "products": [
    {
      "id": "prod_국산_브레이크_튜닝_업그레이드",
      "name": "국산차 브레이크 튜닝/업그레이드",
      "brandGroup": "국산",
      "workType": "브레이크 튜닝/업그레이드",
      "frequency": 495,
      "priceNote": "차종별 상이 / 상담 후 안내",
      "samplePostIds": ["cnt_...", "cnt_..."]
    }
  ],
  "coupons": [
    { "name": "매월 선착순 브레이크 무상점검", "type": "monthly" }
  ]
}
```

---

## 8. 대시보드 (naver-blog-publish-html.js)

### 8.1 기능

| 기능 | 설명 |
|------|------|
| 탭 | 네이버 / 메타(인스타) / 당근 / 영상 |
| 필터 | 브랜드(드롭다운) + 차종(검색형) + 작업(검색형) + 상태 + 이미지 유무 |
| 페이지네이션 | 50건/페이지 |
| 개별 발행 뷰 | 제목복사 / 본문복사(서식포함) / 태그복사 / 발행완료 버튼 |
| 이미지 인라인 | 이미지 있는 글은 base64로 HTML에 내장 |
| 원본 링크 | 컨트롤바에 📎원본 블로그 링크 |
| 탭별 상태 | `data/publish/meta/`, `data/publish/daangn/` 스캔하여 실시간 카운트 |

### 8.2 데이터 구조

```javascript
// 대시보드 1행 = SSOT 1건
{
  id: postId,
  brand: '현대',
  model: '그랜저 TG',
  work: '풀셋 브레이크 업그레이드',
  img: 8,
  warn: 0,
  naver: 'generated',     // none | generated | published | skipped
  meta: 'none',
  daangn: 'none',
  video: null,
}
```

---

## 9. 환경 변수

```bash
# SSOT 구축
SSOT_LIMIT=0              # 0=전체, N=N건만
SSOT_CONCURRENCY=2
SSOT_MODEL=haiku

# 소비자/매출 보강
CONSUMER_CONCURRENCY=10
CONSUMER_MODEL=haiku
SALES_CONCURRENCY=10
SALES_MODEL=haiku

# 콘텐츠 생성
BLOG_LIMIT=0
BLOG_CONCURRENCY=10
BLOG_MODEL=sonnet          # haiku | sonnet | opus

# 이미지 추출
IMG_MIN_W=200
IMG_MIN_H=150
IMG_LIMIT=0
```

---

## 10. 의존성 (package.json)

```json
{
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.78.0",    // Claude API
    "pdfjs-dist": "^5.5.207",          // PDF 텍스트/이미지 추출
    "@napi-rs/canvas": "^0.1.96",      // 이미지 인코딩 (PDF→JPEG)
    "xlsx": "^0.18.5",                 // Excel 내보내기
    "dotenv": "^16.3.1",              // 환경변수
    "playwright": "^1.40.0"            // 브라우저 자동화 (발행용)
  }
}
```

---

## 11. 디렉토리 구조

```
project_root/
├── data/
│   ├── content/
│   │   ├── parsed/              # PDF → 텍스트 블록
│   │   ├── segmented/           # 개별 포스트 분리
│   │   └── dedup/               # 중복 제거
│   ├── ssot-posts/              # SSOT (1,912개)
│   │   ├── cnt_xxx_post_01.json
│   │   └── _aggregate-summary.json
│   ├── publish/
│   │   ├── naver-v2/            # 네이버 블로그 JSON
│   │   ├── naver-v2-html/       # 대시보드 + HTML
│   │   ├── meta/                # 인스타 JSON
│   │   ├── daangn/              # 당근 JSON
│   │   └── products/            # 상품 카탈로그
│   └── work/                    # 작업 큐
├── output/
│   ├── naver-blog-pdfs/         # 소스 PDF
│   └── images/                  # 추출된 이미지
│       └── cnt_xxx_post_01/
│           ├── img_001.jpg
│           └── img_002.jpg
└── scripts/                     # 모든 파이프라인 스크립트
```

---

## 12. 다른 업종 적용 체크리스트

### Phase 1: 상수 교체

- [ ] `_content-shared.js` → CTA 링크/업체명/주소/경력 교체
- [ ] 브랜드/카테고리 그룹 정의 (product-catalog용)
- [ ] 도입부 문구 설정 ("안녕하세요, {업종} 전문 {업체명}입니다.")

### Phase 2: SSOT 스키마 설계

- [ ] `vehicle` → 업종 핵심 엔티티 (고객/프로젝트/대상)
- [ ] `work` → 서비스/프로그램/작업
- [ ] `parts` → 사용 장비/재료/도구
- [ ] `difficulty` → 난이도/복잡도
- [ ] `keyPoints` → 핵심 포인트/강조사항
- [ ] 검증 대상 필드 정의 (forbidden이 될 항목)

### Phase 3: 분류/앵글 재설계

- [ ] `classifyPostType()` → 업종별 포스트 유형 6개 정의
- [ ] `ANGLES` → 업종별 도입부 스타일 정의
- [ ] `CTA_LEADINS` → 유형별 CTA 리드인 문장
- [ ] `STRUCTURE_TEMPLATES` → 유형별 글 구조 정의

### Phase 4: 프롬프트 재작성

- [ ] SSOT 구축 프롬프트 (업종 맥락 반영)
- [ ] 소비자 분석 프롬프트 (타겟 고객 + 검색 키워드)
- [ ] 매출 맥락 프롬프트 (업종별 매출 전환 요소)
- [ ] 블로그 생성 프롬프트 (톤/구조/규칙)
- [ ] 인스타 프롬프트 (캡션 스타일)
- [ ] 당근 프롬프트 (동네 톤)

### Phase 5: 검증 규칙

- [ ] forbidden 검증 규칙 (업종별 민감 주장)
- [ ] 감정 창작 패턴 (업종별 금지 표현)
- [ ] 톤 후처리 규칙 (과장 형용사 목록)

### Phase 6: 테스트

- [ ] 5~10건 샘플 생성 → 톤/정확도 검토
- [ ] 프롬프트 반복 개선
- [ ] 전체 실행 → 대시보드 확인

---

## 13. 핵심 설계 패턴 요약

| 패턴 | 설명 |
|------|------|
| **Fact-Constrained Generation** | 원문 팩트만 허용, 나머지 forbidden으로 차단 |
| **Hash-Based Determinism** | `hashCode(postId) % N` → 동일 입력 = 동일 결과 (재현 가능) |
| **Idempotent Processing** | `if (exists(outPath)) skip` → 중복 실행 안전 |
| **Shared Module Pattern** | 공통 함수를 `_content-shared.js`로 분리, 3개 생성기가 공유 |
| **Progressive Enrichment** | SSOT 기본 → consumer 추가 → sales 추가 (단계별 보강) |
| **Post-Generation Validation** | 생성 후 forbidden 침투 + 감정 창작 자동 감지 |
| **Tone Post-Processing** | AI 생성 → 규칙 기반 톤 조정 (과장 제거, 어미 혼합) |
| **Platform-Specific Prompt** | 같은 SSOT, 다른 프롬프트 → 플랫폼별 최적 콘텐츠 |
