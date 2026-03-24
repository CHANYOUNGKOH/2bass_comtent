#!/usr/bin/env node
/**
 * build-naming-review.js
 * 엔카 기준 브랜드→차종 표준화 + 선택형 UI HTML 생성
 *
 * 입력: _encar-master.json, _brand-groups.json, _model-groups.json, _part-groups.json
 * 출력: naming-review.html (엔카 기준 국산/수입 탭, 라디오 선택형)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const HTML_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2-html');
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');

const encarMaster = JSON.parse(fs.readFileSync(path.join(HTML_DIR, '_encar-master.json'), 'utf8'));
const brandGroups = JSON.parse(fs.readFileSync(path.join(HTML_DIR, '_brand-groups.json'), 'utf8'));
const modelGroups = JSON.parse(fs.readFileSync(path.join(HTML_DIR, '_model-groups.json'), 'utf8'));
const partGroups  = JSON.parse(fs.readFileSync(path.join(HTML_DIR, '_part-groups.json'), 'utf8'));

// ─── 엔카 마스터에서 브랜드 매핑 테이블 구축 ───
function buildBrandMap() {
  const map = {}; // variantName → { encarCode, group: '국산'|'수입' }
  for (const section of ['domestic', 'imported']) {
    const group = encarMaster[section].label;
    for (const brand of encarMaster[section].brands) {
      // code 자체도 매핑
      map[brand.code] = { encarCode: brand.code, display: brand.display, group };
      map[brand.display] = { encarCode: brand.code, display: brand.display, group };
      for (const alias of brand.aliases) {
        map[alias] = { encarCode: brand.code, display: brand.display, group };
      }
    }
  }
  // 메타 브랜드 → 기타
  for (const p of encarMaster.metaBrands.patterns) {
    map[p] = { encarCode: '기타', display: '기타', group: '기타' };
  }
  return map;
}

const BRAND_MAP = buildBrandMap();

// 혼합 브랜드 패턴 감지
const MIXED_BRAND_PATTERNS = [
  /현대[·\/\-\s,]+기아/i, /기아[·\/\-\s,]+현대/i,
  /Hyundai[·\/\-\s,]+Kia/i, /Kia[·\/\-\s,]+Hyundai/i,
  /현대[·\/\-\s,]+기아[·\/\-\s,]+쉐보레/i, /Hyundai[·\/\-\s,]+Kia[·\/\-\s,]+Chevrolet/i,
  /쉐보레[·\/\-\s,]+GM대우/i, /Chevrolet[·\/\-\s,]+GM/i,
  /폭스바겐[·\/\-\s,]+Audi/i, /Volkswagen[·\/\-\s,]+Audi/i,
  /포르쉐[·\/\-\s,]+폭스바겐/i, /Porsche[·\/\-\s,]+Volkswagen/i,
  /포드[·\/\-\s,]*인피니티/i, /Ford[·\/\-\s,]*Infiniti/i,
  /Range Rover[·\/\-\s,]*Audi/i,
  /Cadillac[·\/\-\s,]*국산/i,
];

function isMixedBrand(name) {
  return MIXED_BRAND_PATTERNS.some(p => p.test(name));
}

// 제네시스 모델 감지
function isGenesisModel(modelStr) {
  if (!modelStr || typeof modelStr !== 'string') return false;
  const m = modelStr.toUpperCase();
  return encarMaster.genesisModels.some(gm => m.includes(gm.toUpperCase()));
}

// 기아 모델 감지
function isKiaModel(modelStr) {
  if (!modelStr || typeof modelStr !== 'string') return false;
  const m = modelStr.toLowerCase();
  return encarMaster.kiaModels.some(km => m.includes(km.toLowerCase()));
}

// ─── SSOT 브랜드→모델 매핑 (차종 기반 분리용) ───
function loadSsotBrandModelMap() {
  const map = {}; // variantBrandName → [{ model, postId }]
  const files = fs.readdirSync(SSOT_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  for (const f of files) {
    try {
      const ssot = JSON.parse(fs.readFileSync(path.join(SSOT_DIR, f), 'utf8'));
      const brand = ssot.vehicle?.brand || '';
      const model = ssot.vehicle?.model || '';
      if (!brand) continue;
      if (!map[brand]) map[brand] = [];
      map[brand].push({ model, postId: ssot.postId });
    } catch { /* skip */ }
  }
  return map;
}

const ssotBrandModel = loadSsotBrandModelMap();

// ─── 엔카 기반 브랜드 그룹 재구성 ───
function buildEncarBrandGroups() {
  // 결과: 엔카 코드별로 SSOT 원본 변형들을 그룹핑
  const encarGroups = {}; // encarCode → { group, display, variants: [{name, count}], total, action }

  for (const bg of brandGroups) {
    for (const v of bg.variants) {
      const name = v.name;
      const count = v.count;

      // 혼합 브랜드 처리
      if (isMixedBrand(name)) {
        // 혼합 브랜드는 "차종 기반 분리" 그룹으로
        const key = '__mixed__';
        if (!encarGroups[key]) {
          encarGroups[key] = {
            encarCode: '혼합(자동분리)', group: '분리필요', display: '현대 또는 기아 (차종별 자동분리)',
            variants: [], total: 0, action: 'model_split',
          };
        }
        encarGroups[key].variants.push({ name, count });
        encarGroups[key].total += count;
        continue;
      }

      // 직접 매핑 시도
      let mapping = BRAND_MAP[name];

      // 부분 매핑 시도 (괄호 제거 등)
      if (!mapping) {
        const stripped = name.replace(/\(.*?\)/g, '').trim();
        mapping = BRAND_MAP[stripped];
      }
      if (!mapping) {
        // 소문자 비교
        const lower = name.toLowerCase();
        for (const [k, v2] of Object.entries(BRAND_MAP)) {
          if (k.toLowerCase() === lower) { mapping = v2; break; }
        }
      }

      const encarCode = mapping ? mapping.encarCode : '기타';
      const group = mapping ? mapping.group : '기타';
      const display = mapping ? mapping.display : '기타';

      if (!encarGroups[encarCode]) {
        encarGroups[encarCode] = {
          encarCode, group, display, variants: [], total: 0, action: 'auto',
        };
      }
      encarGroups[encarCode].variants.push({ name, count });
      encarGroups[encarCode].total += count;
    }
  }

  // 정렬: 국산 먼저, 수입 다음, 기타 마지막. 각 그룹 내에서는 건수 내림차순
  const order = { '국산': 0, '수입': 1, '분리필요': 2, '기타': 3 };
  return Object.values(encarGroups).sort((a, b) => {
    const go = (order[a.group] ?? 9) - (order[b.group] ?? 9);
    if (go !== 0) return go;
    return b.total - a.total;
  });
}

const encarBrandData = buildEncarBrandGroups();

// ─── 제네시스 분리 대상 집계 ───
function countGenesisSplit() {
  // "현대" 그룹 내에서 제네시스 모델인 것들
  let count = 0;
  const hyundaiVariants = encarBrandData.find(g => g.encarCode === '현대')?.variants || [];
  for (const v of hyundaiVariants) {
    const entries = ssotBrandModel[v.name] || [];
    for (const e of entries) {
      if (isGenesisModel(e.model)) count++;
    }
  }
  return count;
}

const genesisSplitCount = countGenesisSplit();

// ─── 혼합 브랜드 분리 상세 ───
function getMixedSplitDetail() {
  const mixed = encarBrandData.find(g => g.action === 'model_split');
  if (!mixed) return null;
  let hyundaiCount = 0, kiaCount = 0, unknownCount = 0;
  for (const v of mixed.variants) {
    const entries = ssotBrandModel[v.name] || [];
    for (const e of entries) {
      if (isKiaModel(e.model)) kiaCount++;
      else hyundaiCount++;
    }
  }
  return { hyundaiCount, kiaCount, unknownCount, total: mixed.total };
}

const mixedDetail = getMixedSplitDetail();

// ─── HTML 생성 ───
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderEncarBrandRows() {
  let currentGroup = '';
  return encarBrandData.map((g, gi) => {
    const multi = g.variants.length > 1;
    const variantList = g.variants.map(v =>
      `<span class="var-tag">${esc(v.name)} <span class="var-count">${v.count}</span></span>`
    ).join(' ');

    // 그룹 헤더
    let groupHeader = '';
    if (g.group !== currentGroup) {
      currentGroup = g.group;
      const labelMap = { '국산': '국산 브랜드', '수입': '수입 브랜드', '분리필요': '혼합 브랜드 (자동분리)', '기타': '메타/기타' };
      groupHeader = `<tr class="group-header"><td colspan="5" style="background:#2d2d2d;color:#03c75a;font-weight:700;padding:10px 12px;font-size:13px;">${labelMap[currentGroup] || currentGroup}</td></tr>`;
    }

    // 라디오 옵션
    let optionsHtml = '';
    if (g.action === 'model_split') {
      // 혼합 브랜드 — 자동분리 설명
      optionsHtml = `<div class="split-info">
        <span class="auto-badge">자동분리</span> 차종명 기반으로 현대/기아 자동 분리
        ${mixedDetail ? `<br><span class="split-detail">→ 현대 ${mixedDetail.hyundaiCount}건 / 기아 ${mixedDetail.kiaCount}건 예상</span>` : ''}
      </div>`;
    } else {
      // 추천 표기 (엔카 코드)
      optionsHtml += `<label class="opt recommended" title="엔카 표준 표기">
        <input type="radio" name="brand_${gi}" value="${esc(g.encarCode)}" checked> ${esc(g.encarCode)}
        <span class="rec-badge">엔카</span>
      </label>`;

      // 기존 변형 중 추천과 다른 것
      const seen = new Set([g.encarCode]);
      for (const v of g.variants) {
        if (seen.has(v.name)) continue;
        seen.add(v.name);
        optionsHtml += `<label class="opt">
          <input type="radio" name="brand_${gi}" value="${esc(v.name)}"> ${esc(v.name)} <span class="var-count">(${v.count}건)</span>
        </label>`;
      }

      // 직접입력
      optionsHtml += `<label class="opt opt-custom">
        <input type="radio" name="brand_${gi}" value="__custom__" onchange="toggleCustom(this)"> 직접 입력:
        <input type="text" class="custom-input" placeholder="소비자 검색용 명칭" disabled data-group="brand_${gi}">
      </label>`;
    }

    const actionLabel = g.action === 'model_split' ? '<span class="action-badge split">차종기반분리</span>'
      : (multi ? '<span class="action-badge merge">자동매핑</span>' : '<span class="action-badge ok">확인</span>');

    const row = `<tr class="group-row${multi ? ' multi' : ''}" data-key="brands" data-idx="${gi}" data-encar="${esc(g.encarCode)}" data-group="${esc(g.group)}" data-action="${g.action}">
      <td style="text-align:center;color:#aaa;font-size:11px;vertical-align:top;padding-top:14px;">${gi + 1}</td>
      <td style="vertical-align:top;padding-top:10px;">
        <div class="current-variants">${variantList}</div>
      </td>
      <td><div class="options-wrap">${optionsHtml}</div></td>
      <td style="text-align:center;vertical-align:top;padding-top:14px;">
        <span class="count-badge">${g.total}</span>
      </td>
      <td style="text-align:center;vertical-align:top;padding-top:14px;">${actionLabel}</td>
    </tr>`;
    return groupHeader + row;
  }).join('\n');
}

function renderGroupRows(groups, key) {
  return groups.map((g, gi) => {
    const multi = g.variants.length > 1;
    let optionsHtml = '';
    optionsHtml += `<label class="opt${g.suggestion === g.variants[0]?.name ? ' recommended' : ''}" title="추천 표기">
      <input type="radio" name="${key}_${gi}" value="${esc(g.suggestion)}" checked> ${esc(g.suggestion)}
      <span class="rec-badge">추천</span>
    </label>`;
    const seen = new Set([g.suggestion]);
    for (const v of g.variants) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      optionsHtml += `<label class="opt">
        <input type="radio" name="${key}_${gi}" value="${esc(v.name)}"> ${esc(v.name)} <span class="var-count">(${v.count}건)</span>
      </label>`;
    }
    optionsHtml += `<label class="opt opt-custom">
      <input type="radio" name="${key}_${gi}" value="__custom__" onchange="toggleCustom(this)"> 직접 입력:
      <input type="text" class="custom-input" placeholder="소비자 검색용 명칭" disabled data-group="${key}_${gi}">
    </label>`;
    const variantList = g.variants.map(v => `<span class="var-tag">${esc(v.name)} <span class="var-count">${v.count}</span></span>`).join(' ');
    return `<tr class="group-row${multi ? ' multi' : ''}" data-key="${key}" data-idx="${gi}">
      <td style="text-align:center;color:#aaa;font-size:11px;vertical-align:top;padding-top:14px;">${gi + 1}</td>
      <td style="vertical-align:top;padding-top:10px;"><div class="current-variants">${variantList}</div></td>
      <td><div class="options-wrap">${optionsHtml}</div></td>
      <td style="text-align:center;vertical-align:top;padding-top:14px;"><span class="count-badge">${g.total}</span></td>
    </tr>`;
  }).join('\n');
}

// 통계
const domesticCount = encarBrandData.filter(g => g.group === '국산').length;
const importedCount = encarBrandData.filter(g => g.group === '수입').length;
const multiCount = encarBrandData.filter(g => g.variants.length > 1).length;
const totalPosts = encarBrandData.reduce((s, g) => s + g.total, 0);

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>투베이스 용어 표기 정리 (엔카 기준)</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font-family: '나눔고딕','NanumGothic','Malgun Gothic',sans-serif; background: #fafafa; }
  .container { max-width: 1200px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .header h1 { font-size: 22px; color: #222; margin: 0; }
  .header a { color: #1a73e8; text-decoration: none; font-size: 13px; }

  .note { font-size: 13px; color: #666; background: #f0fff5; padding: 14px 18px; border-radius: 8px; border-left: 3px solid #03c75a; margin-bottom: 20px; line-height: 1.7; }

  .stats-bar { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  .stat-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 20px; flex: 1; min-width: 140px; }
  .stat-card .num { font-size: 24px; font-weight: 700; color: #03c75a; }
  .stat-card .label { font-size: 12px; color: #888; margin-top: 2px; }
  .stat-card.warn .num { color: #e67700; }

  .tabs { display: flex; gap: 0; border-bottom: 2px solid #e0e0e0; }
  .tab { padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; background: #f0f0f0; border: 1px solid #e0e0e0; border-bottom: none; border-radius: 6px 6px 0 0; margin-right: 2px; color: #888; }
  .tab.active { background: #fff; color: #03c75a; border-bottom: 2px solid #fff; margin-bottom: -2px; }
  .tab .cnt { font-size: 11px; color: #aaa; margin-left: 4px; }
  .tab.active .cnt { color: #03c75a; }

  .panel { display: none; background: #fff; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
  .panel.active { display: block; }

  .toolbar { padding: 12px 16px; background: #fafafa; border-bottom: 1px solid #eee; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .toolbar input { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; width: 220px; }
  .toolbar .count { font-size: 12px; color: #888; margin-left: auto; }
  .toolbar select { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; }

  .table-wrap { max-height: 650px; overflow-y: auto; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #2d2d2d; color: #eee; padding: 8px 12px; font-size: 12px; text-align: left; font-weight: 600; position: sticky; top: 0; z-index: 1; }
  td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  tr.multi td { background: #fffbe6; }
  tr:hover td { background: #f5f9ff; }
  tr.multi:hover td { background: #fff8d6; }
  tr.group-header td { border-bottom: none; }

  .var-tag { display: inline-block; background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin: 2px; color: #555; }
  .var-tag .var-count { color: #aaa; font-size: 10px; }

  .options-wrap { display: flex; flex-direction: column; gap: 4px; }
  .opt { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 4px 8px; border-radius: 4px; cursor: pointer; border: 1px solid transparent; }
  .opt:hover { background: #f5f5f5; }
  .opt input[type="radio"] { accent-color: #03c75a; margin: 0; }
  .opt.recommended { background: #f0fff5; border: 1px solid #c3e6cb; }
  .rec-badge { background: #03c75a; color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
  .opt-custom { color: #888; }
  .custom-input { padding: 3px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; width: 200px; font-family: inherit; }
  .custom-input:focus { border-color: #03c75a; outline: none; }
  .custom-input:disabled { background: #f5f5f5; }

  .count-badge { background: #f0f0f0; color: #888; padding: 2px 10px; border-radius: 10px; font-size: 12px; }
  .action-badge { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 600; }
  .action-badge.merge { background: #fff3cd; color: #856404; }
  .action-badge.split { background: #cce5ff; color: #004085; }
  .action-badge.ok { background: #d4edda; color: #155724; }

  .auto-badge { background: #1a73e8; color: #fff; font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 600; }
  .split-info { font-size: 13px; color: #555; padding: 4px 8px; }
  .split-detail { font-size: 12px; color: #1a73e8; }

  .bottom-bar { padding: 16px; display: flex; gap: 12px; justify-content: center; border-top: 1px solid #eee; background: #fff; border-radius: 0 0 8px 8px; }
  .bottom-bar button { padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn-export { background: #03c75a; color: #fff; }
  .btn-export:hover { background: #02b050; }
  .btn-download { background: #555; color: #fff; }

  .summary { padding: 12px 16px; background: #fafafa; font-size: 13px; color: #666; border-bottom: 1px solid #eee; }
  .summary strong { color: #e67700; }

  .toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 10px 24px; border-radius: 8px; font-size: 14px; z-index: 99; opacity: 0; transition: opacity .3s; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>용어 표기 정리 <small style="font-size:13px;color:#888;">(엔카 기준)</small></h1>
    <a href="_index.html">&larr; 대시보드</a>
  </div>

  <div class="stats-bar">
    <div class="stat-card"><div class="num">${totalPosts}</div><div class="label">전체 SSOT 건수</div></div>
    <div class="stat-card"><div class="num">${domesticCount + importedCount}</div><div class="label">엔카 브랜드 매핑</div></div>
    <div class="stat-card warn"><div class="num">${multiCount}</div><div class="label">통일 필요 (변형 2+)</div></div>
    <div class="stat-card warn"><div class="num">${genesisSplitCount}</div><div class="label">제네시스 분리 대상</div></div>
    <div class="stat-card warn"><div class="num">${mixedDetail?.total || 0}</div><div class="label">혼합 브랜드 분리</div></div>
  </div>

  <div class="note">
    SSOT ${totalPosts}건의 브랜드 표기를 <strong>엔카 기준</strong>으로 표준화합니다.<br>
    <strong>노란 줄 = 표기가 2개 이상 (통일 필요)</strong>, 흰 줄 = 표기 1개 (확인만).<br>
    엔카 추천이 맞으면 그냥 두세요. 원하는 이름이 없으면 "직접 입력"을 선택하세요.<br>
    완료 후 <strong>[결과 JSON 다운로드]</strong> → <code>apply-naming.js</code>로 SSOT 일괄 반영합니다.
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('brands')">브랜드 <span class="cnt">${encarBrandData.length}그룹</span></div>
    <div class="tab" onclick="switchTab('models')">차종 <span class="cnt">${modelGroups.length}그룹</span></div>
    <div class="tab" onclick="switchTab('parts')">부품 <span class="cnt">${partGroups.length}그룹</span></div>
  </div>

  <!-- Brands (엔카 기준) -->
  <div class="panel active" id="panel_brands">
    <div class="summary">
      국산 ${domesticCount}개 + 수입 ${importedCount}개 브랜드.
      <strong>${multiCount}개가 표기 통일 필요</strong> (노란줄).
      제네시스 분리 대상 ${genesisSplitCount}건, 혼합 브랜드 ${mixedDetail?.total || 0}건 자동분리.
    </div>
    <div class="toolbar">
      <input type="text" placeholder="브랜드 검색..." oninput="filterRows('brands', this.value)">
      <select id="filter_brands" onchange="filterRows('brands')">
        <option value="all">전체</option>
        <option value="multi">통일 필요만</option>
        <option value="domestic">국산만</option>
        <option value="imported">수입만</option>
      </select>
      <span class="count" id="count_brands"></span>
    </div>
    <div class="table-wrap">
      <table><thead><tr>
        <th style="width:36px">#</th>
        <th style="width:35%">현재 표기 (SSOT 원본)</th>
        <th>엔카 기준 표기 선택</th>
        <th style="width:55px">건수</th>
        <th style="width:75px">처리</th>
      </tr></thead>
      <tbody id="tbody_brands">${renderEncarBrandRows()}</tbody></table>
    </div>
  </div>

  <!-- Models -->
  <div class="panel" id="panel_models">
    <div class="summary">
      전체 ${modelGroups.length}그룹 중 <strong>${modelGroups.filter(g => g.variants.length > 1).length}개가 표기 통일 필요</strong>
    </div>
    <div class="toolbar">
      <input type="text" placeholder="차종 검색..." oninput="filterRows('models', this.value)">
      <select id="filter_models" onchange="filterRows('models')">
        <option value="all">전체</option>
        <option value="multi">통일 필요만</option>
      </select>
      <span class="count" id="count_models"></span>
    </div>
    <div class="table-wrap">
      <table><thead><tr>
        <th style="width:36px">#</th>
        <th style="width:35%">현재 표기</th>
        <th>사용할 표기 선택</th>
        <th style="width:55px">건수</th>
      </tr></thead>
      <tbody id="tbody_models">${renderGroupRows(modelGroups, 'models')}</tbody></table>
    </div>
  </div>

  <!-- Parts -->
  <div class="panel" id="panel_parts">
    <div class="summary">
      전체 ${partGroups.length}그룹 중 <strong>${partGroups.filter(g => g.variants.length > 1).length}개가 표기 통일 필요</strong>
    </div>
    <div class="toolbar">
      <input type="text" placeholder="부품 검색..." oninput="filterRows('parts', this.value)">
      <select id="filter_parts" onchange="filterRows('parts')">
        <option value="all">전체</option>
        <option value="multi">통일 필요만</option>
      </select>
      <span class="count" id="count_parts"></span>
    </div>
    <div class="table-wrap">
      <table><thead><tr>
        <th style="width:36px">#</th>
        <th style="width:35%">현재 표기</th>
        <th>사용할 표기 선택</th>
        <th style="width:55px">건수</th>
      </tr></thead>
      <tbody id="tbody_parts">${renderGroupRows(partGroups, 'parts')}</tbody></table>
    </div>
  </div>

  <div class="bottom-bar">
    <button class="btn-export" onclick="exportResult()">결과 복사 (담당자 전달용)</button>
    <button class="btn-download" onclick="downloadResult()">JSON 파일 다운로드</button>
  </div>

</div>

<div class="toast" id="toast"></div>

<script>
// 엔카 마스터 데이터 (인라인)
const ENCAR_BRAND_DATA = ${JSON.stringify(encarBrandData)};

function switchTab(key) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    const k = ['brands','models','parts'][i];
    t.classList.toggle('active', k === key);
  });
  document.querySelectorAll('.panel').forEach((p,i) => {
    const k = ['brands','models','parts'][i];
    p.classList.toggle('active', k === key);
  });
}

function toggleCustom(radio) {
  const grp = radio.closest('.options-wrap');
  const customInput = grp.querySelector('.custom-input');
  customInput.disabled = false;
  customInput.focus();
}

document.addEventListener('change', function(e) {
  if (e.target.type === 'radio' && e.target.value !== '__custom__') {
    const grp = e.target.closest('.options-wrap');
    const ci = grp && grp.querySelector('.custom-input');
    if (ci) ci.disabled = true;
  }
});

function filterRows(key, query) {
  const panel = document.getElementById('panel_' + key);
  const select = document.getElementById('filter_' + key);
  const mode = select ? select.value : 'all';
  const q = (query || panel.querySelector('.toolbar input').value || '').toLowerCase().trim();

  const rows = panel.querySelectorAll('tr.group-row');
  let visible = 0;
  rows.forEach(tr => {
    const text = tr.textContent.toLowerCase();
    const isMulti = tr.classList.contains('multi');
    const group = tr.dataset.group || '';
    let show = true;
    if (q && !text.includes(q)) show = false;
    if (mode === 'multi' && !isMulti) show = false;
    if (mode === 'domestic' && group !== '국산') show = false;
    if (mode === 'imported' && group !== '수입') show = false;
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  // group headers visibility
  const headers = panel.querySelectorAll('tr.group-header');
  headers.forEach(h => { h.style.display = (mode === 'all' && !q) ? '' : 'none'; });

  document.getElementById('count_' + key).textContent = visible + '/' + rows.length + '그룹';
}

['brands','models','parts'].forEach(k => filterRows(k));

function collectResult() {
  const result = {
    exportDate: new Date().toISOString(),
    source: 'encar-naming-review',
    naming: { brands: [], models: [], parts: [] },
  };

  // Brands (엔카 기반)
  const brandPanel = document.getElementById('panel_brands');
  const brandRows = brandPanel.querySelectorAll('tr.group-row');
  brandRows.forEach((tr, i) => {
    const action = tr.dataset.action;
    const encar = tr.dataset.encar;
    const varTags = tr.querySelectorAll('.var-tag');
    const froms = [...varTags].map(t => {
      const text = t.textContent;
      const countEl = t.querySelector('.var-count');
      return countEl ? text.replace(countEl.textContent, '').trim() : text.trim();
    });

    if (action === 'model_split') {
      result.naming.brands.push({ action: 'model_split', from: froms, to: null });
      return;
    }

    const radios = tr.querySelectorAll('input[type="radio"]');
    let selected = null;
    radios.forEach(r => { if (r.checked) selected = r.value; });
    if (selected === '__custom__') {
      const ci = tr.querySelector('.custom-input');
      selected = ci ? ci.value.trim() : null;
    }
    if (!selected) return;

    const allSame = froms.length === 1 && froms[0] === selected;
    if (!allSame) {
      result.naming.brands.push({ action: 'map', from: froms, to: selected, encarCode: encar });
    }
  });

  // Models & Parts
  ['models', 'parts'].forEach(key => {
    const panel = document.getElementById('panel_' + key);
    const rows = panel.querySelectorAll('tr.group-row');
    rows.forEach(tr => {
      const radios = tr.querySelectorAll('input[type="radio"]');
      let selected = null;
      radios.forEach(r => { if (r.checked) selected = r.value; });
      if (selected === '__custom__') {
        const ci = tr.querySelector('.custom-input');
        selected = ci ? ci.value.trim() : null;
      }
      if (!selected) return;
      const varTags = tr.querySelectorAll('.var-tag');
      const froms = [...varTags].map(t => {
        const text = t.textContent;
        const countEl = t.querySelector('.var-count');
        return countEl ? text.replace(countEl.textContent, '').trim() : text.trim();
      });
      const allSame = froms.length === 1 && froms[0] === selected;
      if (!allSame) {
        result.naming[key].push({ to: selected, from: froms });
      }
    });
  });

  return result;
}

function exportResult() {
  const result = collectResult();
  const total = Object.values(result.naming).reduce((s, arr) => s + arr.length, 0);
  const text = JSON.stringify(result, null, 2);
  navigator.clipboard.writeText(text)
    .then(() => showToast('결과 복사됨! (' + total + '건 매핑)'))
    .catch(() => downloadResult());
}

function downloadResult() {
  const result = collectResult();
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '2bass-naming-encar-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  showToast('파일 다운로드됨 → apply-naming.js로 반영하세요');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
</script>
</body>
</html>`;

fs.writeFileSync(path.join(HTML_DIR, 'naming-review.html'), html, 'utf8');

// 엔카 매핑 결과를 _brand-mapping-encar.json으로도 저장 (apply-naming에서 사용)
const mappingResult = encarBrandData.map(g => ({
  encarCode: g.encarCode,
  group: g.group,
  display: g.display,
  action: g.action,
  variants: g.variants,
  total: g.total,
}));
fs.writeFileSync(path.join(HTML_DIR, '_brand-mapping-encar.json'), JSON.stringify(mappingResult, null, 2), 'utf8');

const sz = (fs.statSync(path.join(HTML_DIR, 'naming-review.html')).size / 1024).toFixed(0);
console.log(`naming-review.html: ${sz}KB (엔카 기준)`);
console.log(`brands: ${encarBrandData.length}그룹 (국산 ${domesticCount}, 수입 ${importedCount}, 통일필요 ${multiCount})`);
console.log(`  제네시스 분리 대상: ${genesisSplitCount}건`);
console.log(`  혼합 브랜드 분리: ${mixedDetail?.total || 0}건`);
console.log(`models: ${modelGroups.length}그룹 (통일필요: ${modelGroups.filter(g => g.variants.length > 1).length})`);
console.log(`parts: ${partGroups.length}그룹 (통일필요: ${partGroups.filter(g => g.variants.length > 1).length})`);
console.log(`\n_brand-mapping-encar.json 저장됨`);
