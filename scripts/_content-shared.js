/**
 * _content-shared.js
 * 공통 모듈: classifyPostType, buildFactSheet, selectAngle, validateGenerated, callClaude, CTA 상수
 * content-generate-naver-blog.js / content-generate-meta.js / content-generate-daangn.js 공유
 */
import { readFile, writeFile as writeFileAsync, access, unlink } from 'fs/promises';
import { execSync, spawn } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ─── 키워드 검색량 캐시 ───
const KV_CACHE_PATH = path.join(process.cwd(), 'data/work/keyword-volume-cache.json');
const STALE_DAYS = 30;
let _kvCache = undefined; // undefined=미로드, null=파일없음

export async function loadKeywordVolumeCache() {
  if (_kvCache !== undefined) return _kvCache;
  const raw = await loadJson(KV_CACHE_PATH, null);
  if (!raw || !raw.keywords) {
    console.warn('[WARN] 키워드 검색량 캐시 없음 — 하드코딩 fallback 사용');
    _kvCache = null;
    return null;
  }
  const age = (Date.now() - new Date(raw.meta?.updatedAt || 0).getTime()) / 86400000;
  if (age > STALE_DAYS) {
    console.warn(`[WARN] 키워드 캐시 ${Math.floor(age)}일 경과 — bat에서 "검색량 갱신" 실행 권장`);
  } else {
    console.log(`[OK] 키워드 캐시: ${raw.meta.updatedAt.slice(0, 10)} (${Math.floor(age)}일 전, ${Object.keys(raw.keywords).length}개)`);
  }
  _kvCache = raw;
  return raw;
}

// 캐시 → { keyword: totalVolume } 맵 변환 (generate/prioritize 공용)
export function cacheToVolumeMap(cache) {
  if (!cache?.keywords) return null;
  return Object.fromEntries(
    Object.entries(cache.keywords).map(([k, v]) => [k, v.total])
  );
}

// 캐시 → { keyword: { vol, comp } } 맵 변환 (prioritize 전용)
export function cacheToVolumeDetail(cache) {
  if (!cache?.keywords) return null;
  return Object.fromEntries(
    Object.entries(cache.keywords).map(([k, v]) => [k, { vol: v.total, comp: v.comp }])
  );
}

// ─── CTA 고정 정보 ───
export const CTA = {
  place:    'https://naver.me/GOudi7JY',
  talk:     'https://talk.naver.com/ct/w19vvqt?frm=mnmb&frm=nmb_detail#nafullscreen',
  kakao:    'https://pf.kakao.com/_wHxdZX',
  kakaoMap: 'https://map.kakao.com/?itemId=262640202&t_src=kakaotalk&t_ch=message&t_obj=place',
  store:    'https://smartstore.naver.com/2bassbrake',
  phone:    '010-4150-3199',
  shopName: '투베이스 (2BASS)',
  location: '일산',
  address:  '경기 고양시 일산동구 문원길170번길 103-21 가영랜드 뒷쪽 윗건물',
  career:   '16년',
};

// ─── 지역 SEO 순환 키워드 ───
export const LOCAL_SEO = {
  // 항상 포함 (순환 안 함)
  fixedHashtags: ['#브레이크튜닝', '#투베이스', '#2bass'],

  // 순환 해시태그 세트 (기존 #파주브레이크 #일산브레이크 대체)
  // 포스트마다 1세트씩 선택 → 1912개 ÷ 8세트 = ~239개씩 분배
  hashtagSets: [
    ['#파주브레이크', '#일산브레이크'],
    ['#고양시브레이크', '#일산브레이크'],
    ['#운정브레이크', '#파주브레이크'],
    ['#교하브레이크', '#고양브레이크'],
    ['#금촌브레이크', '#파주브레이크'],
    ['#일산동구브레이크', '#고양브레이크'],
    ['#킨텍스브레이크', '#일산브레이크'],
    ['#파주브레이크', '#고양시브레이크'],
  ],

  // 본문에 자연어로 녹일 지역명 (tier별 가중치)
  regions: [
    // tier1 (가중치 3) — 5분 이내
    { name: '고봉동', w: 3 }, { name: '설문동', w: 3 }, { name: '식사동', w: 3 },
    { name: '중산동', w: 3 }, { name: '풍산동', w: 3 }, { name: '봉일천', w: 3 },
    // tier2 (가중치 2) — 10~20분
    { name: '정발산', w: 2 }, { name: '마두', w: 2 }, { name: '백석', w: 2 },
    { name: '장항동', w: 2 }, { name: '탄현', w: 2 }, { name: '주엽', w: 2 },
    { name: '대화동', w: 2 }, { name: '금촌', w: 2 }, { name: '운정', w: 2 },
    { name: '교하', w: 2 },
    // tier3 (가중치 1) — 20~30분
    { name: '화정', w: 1 }, { name: '삼송', w: 1 }, { name: '행신', w: 1 },
    { name: '은평구', w: 1 }, { name: '김포', w: 1 },
  ],

  // 마을/택지지구명 — 본문 전용 (해시태그에는 안 넣음)
  villages: [
    '위시티', '후곡마을', '강선마을', '백송마을', '문촌마을', '양지마을',
    '해솔마을', '가람마을', '한빛마을', '산내마을', '한울마을',
    '해오름마을', '물향기마을', '킨텍스지구', '하이파크시티',
    '삼송택지지구', '달빛마을', '은빛마을', '숲속마을',
    '책향기마을', '그린시티',
  ],

  // 랜드마크 — 본문에 1회 자연스럽게
  landmarks: [
    '킨텍스', '일산호수공원', '라페스타', '웨스턴돔',
    '스타필드 고양', '자유로', '설문IC', '사리현IC',
  ],
};

// 고볼륨 부품 단독 (네이버 API 실측 검색량)
const HIGH_VOL_TAGS = [
  { match: /디스크|로터/,       tag: '#브레이크디스크' },   // 2,580/월
  { match: /패드/,             tag: '#브레이크패드교체' },  // 1,600/월
  { match: /캘리퍼/,           tag: '#브렘보캘리퍼' },     // 420/월
  { match: /연마/,             tag: '#디스크연마' },
];

// 롱테일 지역+부품 (경쟁 낮음, 전환율 높음)
const LONGTAIL_TAGS = [
  { match: /캘리퍼/,           tag: '캘리퍼' },
  { match: /디스크|로터/,       tag: '디스크' },
  { match: /브렘보|brembo/i,   tag: '브렘보' },
  { match: /패드/,             tag: '패드교체' },
  { match: /연마/,             tag: '디스크연마' },
];

// 지역명 풀 (해시태그 조합용, 주요 2개 지역 순환)
const REGION_PREFIXES = ['파주', '일산', '고양'];

export function selectLocalSEO(postId, ssot) {
  const h = hashCode(postId);

  // 해시태그 세트 (8개 중 1개)
  const rotatingHashtags = LOCAL_SEO.hashtagSets[h % LOCAL_SEO.hashtagSets.length];

  // 본문용 지역명 (가중치 반영 풀에서 1개)
  const weightedPool = LOCAL_SEO.regions.flatMap(r => Array(r.w).fill(r.name));
  const bodyRegion = weightedPool[hashCode(postId + '_r') % weightedPool.length];

  // 마을명 1개
  const village = LOCAL_SEO.villages[hashCode(postId + '_v') % LOCAL_SEO.villages.length];

  // 랜드마크 1개
  const landmark = LOCAL_SEO.landmarks[hashCode(postId + '_l') % LOCAL_SEO.landmarks.length];

  // 고볼륨 해시태그 (ssot.work 기반, 첫 번째 매칭)
  let highVolTag = '';
  let longTailTag = '';
  if (ssot) {
    const parts = (ssot.work?.parts || []).join(' ') + ' ' + (ssot.work?.type || '');
    const partsLow = parts.toLowerCase();

    const hvMatch = HIGH_VOL_TAGS.find(p => p.match.test(partsLow));
    if (hvMatch) highVolTag = hvMatch.tag;

    const ltMatch = LONGTAIL_TAGS.find(p => p.match.test(partsLow));
    if (ltMatch) {
      const regionPrefix = REGION_PREFIXES[hashCode(postId + '_pr') % REGION_PREFIXES.length];
      longTailTag = `#${regionPrefix}${ltMatch.tag}`;
    }
  }

  return {
    fixedHashtags: LOCAL_SEO.fixedHashtags,
    rotatingHashtags,
    highVolTag,
    longTailTag,
    bodyRegion,
    village,
    landmark,
  };
}

// ─── 브랜드/차종 정규화 ───
const BRAND_MAP = {
  '메르세데스-벤츠': '벤츠',
  '메르세데스 벤츠': '벤츠',
  '메르세데스벤츠': '벤츠',
  'AUDI': '아우디',
  'audi': '아우디',
  'Audi': '아우디',
  '르노 삼성': '르노삼성',
  '삼성': '르노삼성',
  '현대·기아': '현대/기아',
  '현대, 기아': '현대/기아',
  '현대기아': '현대/기아',
  '현대자동차': '현대',
  '쉐보레(GM대우)': '쉐보레',
  '쉐보레·GM대우': '쉐보레',
  '지엠(GM)': '쉐보레',
  '대우': '쉐보레',
  '미쯔비시': '미쓰비시',
  '레인지 로버': '랜드로버',
  '레인지로버': '랜드로버',
  'Land Rover': '랜드로버',
  'JEEP (지프)': '지프',
  '스바우': '스바루',
  // 차종명이 브랜드에 잘못 들어간 케이스 (엔카 기준 보정)
  '머스탱': '포드',
  '골프': '폭스바겐',
  '무쏘': '쌍용',
  '란서': '미쓰비시',
};

const MODEL_MAP_NORMALIZE = {
  '올 뉴 말리부': '올뉴말리부',
  '올 뉴 카니발': '올뉴카니발',
  '올 뉴 쏘렌토': '올뉴쏘렌토',
  '올 뉴 투싼': '올뉴투싼',
  '올 뉴 K7': '올뉴K7',
  '더 뉴 아반떼': '더뉴아반떼',
  '더 뉴 투싼': '더뉴투싼',
  '더 뉴 쏘나타': '더뉴쏘나타',
  '더 뉴 셀토스': '더뉴셀토스',
  '더 뉴 K5': '더뉴K5',
};

export function normalizeBrand(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s{2,}/g, ' ');
  return BRAND_MAP[s] || s;
}

export function normalizeModel(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s{2,}/g, ' ');
  return MODEL_MAP_NORMALIZE[s] || s;
}

// ─── 유틸 ───
export async function loadJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); }
  catch { return fallback; }
}

export async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

export function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 모델 별칭 → Anthropic API 모델 ID 매핑
const MODEL_MAP = {
  'sonnet':  'claude-sonnet-4-6-latest',
  'haiku':   'claude-haiku-4-5-latest',
  'opus':    'claude-opus-4-6-latest',
};

function resolveModelId(alias) {
  if (!alias) return MODEL_MAP.sonnet;
  if (alias.startsWith('claude-')) return alias;
  return MODEL_MAP[alias] || MODEL_MAP.sonnet;
}

// 듀얼 모드: ANTHROPIC_API_KEY 있으면 API SDK, 없으면 Claude Code CLI
const USE_API = !!process.env.ANTHROPIC_API_KEY;
let _anthropicClient = null;
if (USE_API) {
  _anthropicClient = new Anthropic();
}

async function callClaudeAPI(prompt, model) {
  const modelId = resolveModelId(model);
  const maxTokens = Number(process.env.BLOG_MAX_TOKENS || 4096);

  // prompt가 { system, user } 객체이면 분리, 문자열이면 기존 방식
  const isStructured = typeof prompt === 'object' && prompt.user;
  const params = {
    model: modelId,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: isStructured ? prompt.user : prompt }],
  };
  if (isStructured && prompt.system) {
    params.system = prompt.system;
  }

  const response = await _anthropicClient.messages.create(params);

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

async function callClaudeCLI(prompt, model) {
  const m = model || 'sonnet';
  const isStructured = typeof prompt === 'object' && prompt.user;

  // system prompt + user prompt를 stdin으로 합쳐서 전달
  // (Windows cmd의 인수 길이/인코딩 문제 회피)
  let fullInput;
  if (isStructured && prompt.system) {
    fullInput = prompt.system + '\n\n---\n\n' + prompt.user;
  } else {
    fullInput = isStructured ? prompt.user : prompt;
  }

  const args = ['--model', m, '--print'];

  return new Promise((resolve, reject) => {
    const proc = spawn('cmd.exe', ['/c', 'chcp 65001 >nul && claude ' + args.join(' ')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString('utf8'); });
    proc.stderr.on('data', d => { err += d.toString('utf8'); });
    proc.stdin.write(fullInput, 'utf8');
    proc.stdin.end();
    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 300000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

export async function callClaude(prompt, model) {
  const m = model || process.env.BLOG_MODEL || 'sonnet';
  const raw = USE_API
    ? await callClaudeAPI(prompt, m)
    : await callClaudeCLI(prompt, m);

  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON 없음: ' + raw.slice(0, 100));
  try { return JSON.parse(match[0]); }
  catch (e) { throw new Error('JSON 파싱 실패: ' + e.message); }
}

// ═══════════════════════════════════════════════════
// 포스트 분류
// ═══════════════════════════════════════════════════
export function classifyPostType(ssot) {
  const txt    = (ssot.originalText || '').toLowerCase();
  const w      = ssot.work || {};
  const s      = ssot.salesContext || ssot.salesHints || {};
  const diff   = (ssot.difficulty || '').trim();
  const parts  = (w.parts || []).join(' ').toLowerCase();
  const wtype  = (w.type || '').toLowerCase();

  // isNotice 플래그가 있으면 즉시 스킵
  if (ssot.isNotice) return 'skip';

  const skipWords = ['이벤트', '공지', '설맞이', '추석', '크리스마스', '연말', '쿠폰', '할인', '경품'];
  const hasWorkParts = (w.parts || []).length > 0;
  if (skipWords.some(kw => txt.includes(kw)) && !hasWorkParts && !parts.includes('브레이크') && !parts.includes('캘리퍼')) {
    return 'skip';
  }

  if (s.referral?.hasReferral && /소개|추천|입소문/.test(txt)) {
    return 'customer_story';
  }
  if (diff === '상' && /커스텀|제작|가공|특수/.test(txt)) {
    return 'technical_deep_dive';
  }
  if (s.specComparison?.before && s.specComparison?.after && /비교|차이|vs|순정/.test(txt)) {
    return 'parts_comparison';
  }
  const maintenanceKw = ['패드교체', '패드 교체', '연마', '액교환', '오일교환', '점검'];
  if (['하', '중하', '중'].includes(diff) && maintenanceKw.some(kw => txt.includes(kw))) {
    return 'maintenance_guide';
  }
  return 'case_study';
}

// ═══════════════════════════════════════════════════
// 팩트시트 + forbidden 목록
// ═══════════════════════════════════════════════════
export function buildFactSheet(ssot) {
  const txt = ssot.originalText || '';
  const v   = ssot.vehicle || {};
  const w   = ssot.work || {};
  const s   = ssot.salesContext || ssot.salesHints || {};

  const facts = [];
  if (v.brand || v.model) facts.push(`차량: ${v.brand || ''} ${v.model || ''} ${v.note || ''}`.trim());
  if (w.type) facts.push(`작업: ${w.type}`);
  if (w.parts?.length) facts.push(`부품: ${w.parts.join(', ')}`);
  if (w.challenge) facts.push(`고객 문제: ${w.challenge}`);
  if (w.solution) facts.push(`해결방법: ${w.solution}`);
  if (w.duration) facts.push(`작업시간: ${w.duration}`);
  if (ssot.keyPoints?.length) facts.push(`핵심포인트: ${ssot.keyPoints.join(' / ')}`);
  if (s.modelCount) facts.push(`이 차종 시공 횟수: ${s.modelCount}회`);

  const forbidden = [];
  const verified = {};

  if (s.referral?.hasReferral) {
    if (/소개|추천|입소문/.test(txt)) {
      verified.referral = s.referral;
      facts.push(`소개 경로: ${s.referral.source}`);
    } else {
      forbidden.push('소개/레퍼럴/입소문 스토리 (원문에 근거 없음)');
    }
  }

  if (s.warranty) {
    const warKw = ['보증', 'as', 'A/S', 'AS', '워런티'];
    if (warKw.some(kw => txt.toLowerCase().includes(kw.toLowerCase()))) {
      verified.warranty = s.warranty;
      facts.push(`AS 보증: ${s.warranty}`);
    } else {
      forbidden.push(`AS 보증 조건 "${s.warranty}" (원문에 근거 없음)`);
    }
  }

  if (s.customerRegion) {
    if (txt.includes(s.customerRegion) || /지방|서울|경기|대전|부산|광주|대구|인천/.test(txt)) {
      verified.customerRegion = s.customerRegion;
      facts.push(`고객 출발지: ${s.customerRegion}`);
    } else {
      forbidden.push(`고객 출발지 "${s.customerRegion}" (원문에 근거 없음)`);
    }
  }

  if (s.specComparison) {
    if (/비교|순정|차이|사이즈|크기/.test(txt)) {
      verified.specComparison = s.specComparison;
      if (s.specComparison.before) facts.push(`순정 스펙: ${s.specComparison.before}`);
      if (s.specComparison.after)  facts.push(`튜닝 스펙: ${s.specComparison.after}`);
      if (s.specComparison.improvement) facts.push(`체감 개선: ${s.specComparison.improvement}`);
    } else {
      forbidden.push('순정 vs 튜닝 스펙 비교 수치 (원문에 비교 내용 없음)');
    }
  }

  if (s.freeServices?.length) {
    const verifiedServices = s.freeServices.filter(svc => {
      const kw = svc.replace(/\(.*\)/, '').trim().toLowerCase();
      return txt.toLowerCase().includes(kw) || /시운전|점검|안내|도장|서비스/.test(txt);
    });
    if (verifiedServices.length) {
      verified.freeServices = verifiedServices;
      facts.push(`무료 서비스: ${verifiedServices.join(', ')}`);
    }
    const unverified = s.freeServices.filter(svc => !verifiedServices.includes(svc));
    if (unverified.length) {
      forbidden.push(`무료 서비스 "${unverified.join(', ')}" (원문에 근거 없음)`);
    }
  }

  if (s.crossSell?.length) {
    const verifiedCross = s.crossSell.filter(cs => {
      const kw = cs.replace(/\(.*\)/, '').trim().split(' ')[0].toLowerCase();
      return txt.toLowerCase().includes(kw);
    });
    if (verifiedCross.length) {
      verified.crossSell = verifiedCross;
      facts.push(`후속 작업 언급: ${verifiedCross.join(', ')}`);
    }
  }

  if (s.priceHint) {
    if (/가격|비용|예산|합리|가성비/.test(txt)) {
      verified.priceHint = s.priceHint;
      facts.push(`가격 힌트: ${s.priceHint}`);
    } else {
      forbidden.push(`가격/비용 언급 "${s.priceHint}" (원문에 근거 없음)`);
    }
  }

  forbidden.push('고객 반응/감상 창작 (원문에 명시된 것만 가능)');
  forbidden.push('원문에 없는 스펙 수치나 기술 데이터');

  return { facts, forbidden, verified };
}

// ═══════════════════════════════════════════════════
// 앵글 선택
// ═══════════════════════════════════════════════════
const ANGLES = [
  { id: 'symptom',       label: '증상 공감',         check: s => s.consumer?.directDemand?.symptom },
  { id: 'vehicle_story', label: '차량 특성에서 시작', check: s => s.vehicle?.note },
  { id: 'before_after',  label: '순정→튜닝 비교',    check: (s, v) => v.specComparison },
  { id: 'value',         label: '가성비/무료서비스',  check: (s, v) => v.freeServices || v.priceHint },
  { id: 'expertise',     label: '전문성 강조',        check: s => ['상', '중상'].includes(s.difficulty) },
  { id: 'community',     label: '동호회/커뮤니티',    check: s => /동호회|커뮤니티|카페|클럽|모임/.test(s.originalText || '') },
  { id: 'urgency',       label: '긴급성/시즌',        check: s => s.consumer?.urgency === 'high' || s.consumer?.seasonality },
  { id: 'education',     label: '기술 교육',           check: s => (s.keyPoints || []).length >= 4 },
  { id: 'misdiagnosis', label: '증상 오해 교정',      check: s => /떨림|떨리|진동|소음|밀림|밀리|쏠림|편마모|고착/.test(s.originalText || '') },
];

export function selectAngle(ssot, verified) {
  const eligible = ANGLES.filter(a => a.check(ssot, verified));
  if (!eligible.length) return ANGLES[0];
  const idx = hashCode(ssot.postId) % eligible.length;
  return eligible[idx];
}

// ═══════════════════════════════════════════════════
// 생성 후 검증
// ═══════════════════════════════════════════════════
export function validateGenerated(generated, factSheet, ssot) {
  const warnings = [];
  const body = (generated.body || '').toLowerCase();

  for (const fb of factSheet.forbidden) {
    const match = fb.match(/"([^"]+)"/);
    if (match) {
      const kw = match[1].toLowerCase();
      if (body.includes(kw)) {
        warnings.push(`[FORBIDDEN 침투] "${match[1]}" 가 본문에 포함됨 — 원문: ${fb}`);
      }
    }
  }

  const emotionPatterns = [
    '감동', '눈물', '감격', '행복해', '최고였', '인생샵', '대만족',
    '너무 좋아', '완전 달라', '세상 달라', '다른 차가 된',
  ];
  const origLow = (ssot.originalText || '').toLowerCase();
  for (const ep of emotionPatterns) {
    if (body.includes(ep) && !origLow.includes(ep)) {
      warnings.push(`[감정 창작 의심] "${ep}" — 원문에 없는 표현이 본문에 사용됨`);
    }
  }

  return warnings;
}

// ═══════════════════════════════════════════════════
// 검색의도 분류 (정보형 / 거래형)
// ═══════════════════════════════════════════════════
export function classifySearchIntent(ssot) {
  const txt  = (ssot.originalText || '').toLowerCase();
  const w    = ssot.work || {};
  const wtype = (w.type || '').toLowerCase();
  const parts = (w.parts || []).join(' ').toLowerCase();
  const symptom = ssot.consumer?.directDemand?.symptom;
  const rawSymptom = Array.isArray(symptom) ? symptom.join(' ') : (symptom || '');

  // 정보형 시그널: 증상 키워드, 교육적 내용, 유지보수
  const infoSignals = [
    /떨림|떨리|진동|소음|끼익|밀림|밀리|쏠림|편마모|고착/,
    /원인|해결|점검|교체\s*시기|수명|주기|확인/,
    /패드\s*교체|연마|오일\s*교환|액\s*교환|점검/,
  ];
  const infoScore = infoSignals.filter(p => p.test(txt) || p.test(rawSymptom) || p.test(wtype)).length;

  // 거래형 시그널: 구체적 차종+작업, 시공 후기, 브랜드 부품
  const txnSignals = [
    /장착|인스톨|시공|튜닝|업그레이드/,
    /브렘보|brembo|4p|6p|캘리퍼/i,
    /풀셋|풀세팅|커스텀|제작/,
  ];
  const txnScore = txnSignals.filter(p => p.test(txt) || p.test(parts) || p.test(wtype)).length;

  if (infoScore > txnScore) return 'informational';
  if (txnScore > infoScore) return 'transactional';
  // 동점이면 부품 수로 판단: 많으면 거래형
  return (w.parts || []).length >= 3 ? 'transactional' : 'informational';
}

// ═══════════════════════════════════════════════════
// 다중 CTA (소프트/맥락/풀)
// ═══════════════════════════════════════════════════

// 증상/작업별 맞춤 CTA 리드인
const CTA_BY_CONTEXT = {
  symptom: {
    '떨림':   '정확한 진단이 먼저입니다. 떨림 원인은 다양하니 전문 점검을 권합니다.',
    '소음':   '원인 파악 후 정확한 견적을 안내드립니다.',
    '밀림':   '제동 밀림은 안전과 직결됩니다. 무료 점검으로 확인하세요.',
    '쏠림':   '쏠림 증상, 원인이 다양합니다. 정밀 진단 후 안내드립니다.',
    '편마모': '편마모 원인을 정확히 잡아야 재발을 막을 수 있습니다.',
    default:  '비슷한 증상이라면 정확한 진단이 먼저입니다.',
  },
  work: {
    '패드':   '패드 상태가 궁금하시면 무료 점검 가능합니다.',
    '캘리퍼': '내 차에 맞는 캘리퍼 사양, 맞춤 상담해 드립니다.',
    '디스크': '디스크 교체 시기, 연마 가능 여부 점검해 드립니다.',
    '연마':   '연마 가능 여부, 무료로 확인해 드립니다.',
    '튜닝':   '내 차에 맞는 브레이크 세팅, 상담해 드립니다.',
    default:  '궁금하신 점은 편하게 문의하세요.',
  },
};

export function buildMultiCTA(ssot, intent) {
  const txt = (ssot.originalText || '').toLowerCase();
  const wtype = (ssot.work?.type || '').toLowerCase();

  // 증상 매칭
  let symptomKey = 'default';
  for (const k of Object.keys(CTA_BY_CONTEXT.symptom)) {
    if (k !== 'default' && (txt.includes(k) || wtype.includes(k))) { symptomKey = k; break; }
  }

  // 작업 매칭
  let workKey = 'default';
  for (const k of Object.keys(CTA_BY_CONTEXT.work)) {
    if (k !== 'default' && (txt.includes(k) || wtype.includes(k))) { workKey = k; break; }
  }

  const softCTA = CTA_BY_CONTEXT.symptom[symptomKey] + ` (📞 ${CTA.phone})`;
  const midCTA = CTA_BY_CONTEXT.work[workKey] + ` → 톡톡 문의: ${CTA.talk}`;

  // 풀 CTA: 정보형은 테이블, 거래형은 인라인
  let fullCTA;
  if (intent === 'transactional') {
    fullCTA = `궁금하신 점은 전화(${CTA.phone})나 네이버 톡톡(${CTA.talk})으로 편하게 문의해 주세요.\n네이버 예약도 가능합니다 → ${CTA.place}`;
  } else {
    const hasParts = (ssot.work?.parts || []).length > 0;
    fullCTA = `📞 전화 문의 → ${CTA.phone}\n네이버 톡톡 문의 → ${CTA.talk}\n카카오톡 문의 → ${CTA.kakao}\n📅 네이버 예약 → ${CTA.place}`;
    if (hasParts) fullCTA += `\n🛒 부품 구매 → ${CTA.store}`;
  }

  return { softCTA, midCTA, fullCTA };
}
