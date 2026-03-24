/**
 * content-enrich-ssot.js
 * 기존 SSOT 파일에 vehicle/work 정보를 규칙기반으로 보강
 * (LLM 없이 제목+본문에서 패턴 매칭)
 */
import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const ROOT     = process.cwd();
const SSOT_DIR = 'data/ssot-posts';
const FORCE    = process.env.FORCE === 'true';

// ── 브랜드 패턴 ──────────────────────────────────
const BRAND_RULES = [
  { brand: '현대',      model_hints: ['그랜저','소나타','아반떼','투싼','싼타페','팰리세이드','펠리세이드','아이오닉','넥쏘','코나','스타리아','포터','쿠페','베라크루즈','맥스크루즈','아슬란'], re: /현대|그랜저|소나타|아반떼|투싼|싼타페|팰리세이드|펠리세이드|아이오닉|넥쏘|코나|스타리아|포터|베라크루즈|맥스크루즈/i },
  { brand: '기아',      model_hints: ['k3','k5','k7','k8','k9','카니발','스포티지','쏘렌토','모하비','스팅어','ev6','봉고','셀토스','쏘울','카렌스','오피러스'], re: /\bk[3-9]\b|카니발|스포티지|쏘렌토|모하비|스팅어|ev6|봉고|셀토스|쏘울|카렌스|오피러스/i },
  { brand: '제네시스',  model_hints: ['g70','g80','g90','gv70','gv80'], re: /제네시스\s*[gG]|g70|g80|g90|gv[0-9]/i },
  { brand: 'BMW',       model_hints: ['320','330','520','530','640','m3','m5','x5','x6','f10','f30','g30'], re: /\bbmw\b|[fF][0-9]{2}\b|[gG][0-9]{2}\b|\bm[2-8]\b|\bx[1-7]\b/i },
  { brand: '벤츠',      model_hints: ['c클래스','e클래스','s클래스','glc','gle','cls','amg'], re: /벤츠|메르세데스|glc|gle|gls|cls|amg|e클래스|c클래스|s클래스|a클래스|cla/i },
  { brand: '아우디',    model_hints: ['a4','a5','a6','a7','a8','q5','q7','rs','r8','tt'], re: /아우디|\ba[4-8]\b|\bq[3-8]\b|\brs\b|\br8\b|\btt\b/i },
  { brand: '폭스바겐',  model_hints: ['골프','파사트','티구안','아테온'], re: /폭스바겐|골프|파사트|티구안|아테온/i },
  { brand: '쉐보레',    model_hints: ['말리부','콜벳','카마로','트레일블레이저','임팔라'], re: /쉐보레|말리부|콜벳|카마로|트레일블레이저|임팔라/i },
  { brand: '포드',      model_hints: ['머스탱','익스플로러','브롱코'], re: /포드|머스탱|익스플로러|브롱코/i },
  { brand: '닷지',      model_hints: ['챌린저','차저'], re: /닷지|챌린저|차저|크라이슬러|지프/i },
  { brand: '인피니티',  model_hints: ['q50','qx'], re: /인피니티|\bq50\b|\bqx\b/i },
  { brand: '랜드로버',  model_hints: ['레인지로버','디스커버리','디펜더'], re: /랜드로버|레인지로버|디스커버리|디펜더/i },
  { brand: '포르쉐',    model_hints: ['카이엔','카레라','파나메라','타이칸'], re: /포르쉐|카이엔|카레라|파나메라|타이칸/i },
  { brand: '토요타',    model_hints: ['시에나','캠리'], re: /토요타|시에나|캠리/i },
  { brand: '렉서스',    model_hints: ['lc','ls','es','is','rx'], re: /렉서스|\blc\b|\bls\b|\bes\b|\bis\b|\brx\b/i },
  { brand: '혼다',      model_hints: ['오딧세이','어코드','시빅'], re: /혼다|오딧세이|어코드|시빅/i },
  { brand: '쌍용',      model_hints: ['코란도','티볼리','렉스턴','무쏘'], re: /쌍용|코란도|티볼리|렉스턴|무쏘/i },
  { brand: '르노',      model_hints: ['sm3','sm5','sm6','sm7'], re: /르노|삼성|sm[35679]\b/i },
];

// ── 작업 유형 패턴 ───────────────────────────────
const WORK_RULES = [
  { type: '브레이크 업그레이드 킷 설치', re: /킷|kit|셋팅|세팅|인스톨|install|장착/i },
  { type: '트윈캘리퍼 시스템', re: /트윈캘리퍼|듀얼캘리퍼|dual caliper/i },
  { type: '디스크 연마', re: /디스크 연마|디스크연마|연마/i },
  { type: '디스크 교체', re: /디스크 교체|디스크교체|디스크 수명|디스크 변형/i },
  { type: '패드 교환', re: /패드 교환|패드교환|패드교체|pad/i },
  { type: '커스텀 브라켓 제작', re: /브라켓 제작|브라켓제작|커스텀 브라켓|맞춤제작/i },
  { type: '허브 관련', re: /허브링|허브연장|허브 연장|hub/i },
  { type: '캘리퍼 도색', re: /도색|캘리퍼 색상|캘리퍼 칠/i },
  { type: '공지/이벤트', re: /공지|이벤트|이벤트 종료|영업|안내/i },
];

// ── 알려진 부품 ──────────────────────────────────
const PART_PATTERNS = [
  { name: '브렘보', re: /브렘보|brembo/i },
  { name: '펠라',   re: /펠라|fela/i },
  { name: '니트로', re: /니트로|nitro/i },
  { name: '네오테크', re: /네오테크|neotech/i },
  { name: 'SDBS',   re: /\bsdbs\b/i },
  { name: 'CTS-V',  re: /cts-v|cts v/i },
  { name: '만도',   re: /만도/i },
  { name: '홍성',   re: /홍성/i },
  { name: 'EQ900',  re: /eq900/i },
  { name: '체어맨', re: /체어맨/i },
  { name: 'AP레이싱', re: /ap racing|ap\s*레이싱/i },
  { name: 'RS1 디스크', re: /rs1|v6패턴/i },
  { name: '트윈캘리퍼', re: /트윈캘리퍼|듀얼캘리퍼/i },
];

const PISTON_RE = /([2468])(p|ps|piston)/gi;

function extractBrand(title, body) {
  // 제목에서 먼저 찾기, 없으면 본문
  for (const src of [title, body]) {
    for (const r of BRAND_RULES) {
      if (r.re.test(src)) {
        const t = src.toLowerCase();
        const model = r.model_hints.find(m => t.includes(m.toLowerCase())) || '';
        return { brand: r.brand, model };
      }
    }
  }
  return { brand: '', model: '' };
}

function extractWorkType(text) {
  for (const r of WORK_RULES) {
    if (r.re.test(text)) return r.type;
  }
  return '브레이크 작업';
}

function extractParts(text) {
  const found = new Set();
  for (const p of PART_PATTERNS) {
    if (p.re.test(text)) found.add(p.name);
  }
  // 피스톤 수 (2P, 4P, 6P 등)
  let m;
  while ((m = PISTON_RE.exec(text)) !== null) {
    found.add(`${m[1]}P 캘리퍼`);
  }
  PISTON_RE.lastIndex = 0;
  return [...found];
}

function extractNote(text) {
  const notes = [];
  if (/전자파킹|epb/i.test(text)) notes.push('전자파킹(EPB) 차량');
  if (/하이브리드|hybrid/i.test(text)) notes.push('하이브리드');
  if (/4wd|awd|4륜/i.test(text)) notes.push('AWD/4WD');
  return notes.join(', ');
}

function dedupeMirror(s) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const half = Math.floor(t.length / 2);
  if (t.length % 2 === 0) {
    const l = t.slice(0, half).trim(), r = t.slice(half).trim();
    if (l === r) return l;
  }
  // 부분 중복 처리: "A B A B" 패턴
  const words = t.split(' ');
  if (words.length % 2 === 0) {
    const half2 = words.length / 2;
    const left = words.slice(0, half2).join(' ');
    const right = words.slice(half2).join(' ');
    if (left === right) return left;
  }
  return t;
}

async function enrichAll() {
  const files = (await readdir(path.join(ROOT, SSOT_DIR))).filter(f => f.endsWith('.json'));
  console.log(`SSOT 파일: ${files.length}개`);

  let updated = 0, skipped = 0;

  for (const f of files) {
    const fp = path.join(ROOT, SSOT_DIR, f);
    const d = JSON.parse(await readFile(fp, 'utf8'));

    if (!FORCE && d.vehicle?.brand) { skipped++; continue; }

    const titleRaw = d.title?.original || '';
    const titleClean = dedupeMirror(titleRaw);
    const body = d.originalText || '';
    const combined = titleClean + ' ' + body;

    const { brand, model } = extractBrand(titleClean, body);
    const note  = extractNote(combined);
    const wtype = extractWorkType(combined);
    const parts = extractParts(combined);

    d.title.clean  = titleClean;
    d.vehicle = { brand, model, note };
    d.work    = {
      type:      wtype,
      parts,
      challenge: '',
      solution:  '',
      duration:  '',
      ...(d.work || {}),  // 기존 값 유지
      type: wtype,
      parts,
    };

    if (!d.keyPoints?.length) {
      d.keyPoints = parts.slice(0, 3);
    }

    if (!d.difficulty) {
      const text = combined.toLowerCase();
      if (/브라켓 제작|브라켓제작|트윈캘리퍼|커스텀/.test(text)) d.difficulty = 'expert';
      else if (/킷|kit|장착|인스톨/.test(text)) d.difficulty = 'hard';
      else if (/패드|pad/.test(text)) d.difficulty = 'easy';
      else d.difficulty = 'medium';
    }

    await writeFile(fp, JSON.stringify(d, null, 2));
    updated++;

    if (updated % 100 === 0) process.stdout.write(`${updated}/${files.length}...\n`);
  }

  console.log(`\n완료: 업데이트 ${updated}건, 스킵 ${skipped}건`);
}

enrichAll().catch(err => { console.error(err); process.exit(1); });
