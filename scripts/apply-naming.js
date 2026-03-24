#!/usr/bin/env node
/**
 * apply-naming.js
 * naming-review JSON 결과 → SSOT 1,912건 일괄 반영
 *
 * 사용법:
 *   node scripts/apply-naming.js [naming-json-path]
 *   - naming-json-path 생략 시 자동 매핑 (_brand-mapping-encar.json 기반)
 *   - --dry-run: 실제 수정 없이 미리보기
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
const HTML_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2-html');

const dryRun = process.argv.includes('--dry-run');
const namingFile = process.argv.find(a => a.endsWith('.json') && !a.startsWith('-'));

// ─── 엔카 마스터 로드 ───
const encarMaster = JSON.parse(fs.readFileSync(path.join(HTML_DIR, '_encar-master.json'), 'utf8'));

// 브랜드 매핑 테이블
function buildBrandMap() {
  const map = {};
  for (const section of ['domestic', 'imported']) {
    for (const brand of encarMaster[section].brands) {
      map[brand.code] = brand.code;
      map[brand.display] = brand.code;
      for (const alias of brand.aliases) {
        map[alias] = brand.code;
      }
    }
  }
  for (const p of encarMaster.metaBrands.patterns) {
    map[p] = '기타';
  }
  return map;
}

const BRAND_MAP = buildBrandMap();

// 혼합 브랜드 패턴
const MIXED_PATTERNS = [
  /현대[·\/\-\s,]+기아/i, /기아[·\/\-\s,]+현대/i,
  /Hyundai[·\/\-\s,]+Kia/i, /Kia[·\/\-\s,]+Hyundai/i,
  /Hyundai-Kia/i,
];

function isMixedHyundaiKia(brand) {
  return MIXED_PATTERNS.some(p => p.test(brand));
}

function isGenesisModel(model) {
  if (!model || typeof model !== 'string') return false;
  const m = model.toUpperCase();
  return encarMaster.genesisModels.some(gm => m.includes(gm.toUpperCase()));
}

function isKiaModel(model) {
  if (!model || typeof model !== 'string') return false;
  const m = model.toLowerCase();
  return encarMaster.kiaModels.some(km => m.includes(km.toLowerCase()));
}

// ─── 사용자 지정 naming JSON 로드 (있으면) ───
let userNaming = null;
if (namingFile) {
  try {
    userNaming = JSON.parse(fs.readFileSync(namingFile, 'utf8'));
    console.log(`사용자 naming 파일 로드: ${namingFile}`);
  } catch (e) {
    console.error(`naming 파일 로드 실패: ${e.message}`);
    process.exit(1);
  }
}

// 사용자 지정 브랜드 매핑 (from → to)
const userBrandMap = {};
if (userNaming?.naming?.brands) {
  for (const entry of userNaming.naming.brands) {
    if (entry.action === 'map' && entry.to && entry.from) {
      for (const f of entry.from) {
        userBrandMap[f] = entry.to;
      }
    }
  }
}

// 사용자 지정 모델 매핑
const userModelMap = {};
if (userNaming?.naming?.models) {
  for (const entry of userNaming.naming.models) {
    if (entry.to && entry.from) {
      for (const f of entry.from) {
        userModelMap[f] = entry.to;
      }
    }
  }
}

// 사용자 지정 부품명 매핑
const userPartsMap = {};
if (userNaming?.naming?.parts) {
  for (const entry of userNaming.naming.parts) {
    if (entry.to && entry.from) {
      for (const f of entry.from) {
        userPartsMap[f] = entry.to;
      }
    }
  }
}

// ─── 브랜드 결정 로직 ───
function resolveBrand(brand, model) {
  if (!brand || typeof brand !== 'string') return '기타';

  // 1. 사용자 지정 매핑 우선
  if (userBrandMap[brand]) return userBrandMap[brand];

  // 2. 혼합 브랜드 → 차종 기반 분리
  if (isMixedHyundaiKia(brand)) {
    if (isGenesisModel(model)) return '제네시스';
    if (isKiaModel(model)) return '기아';
    return '현대';
  }

  // 3. 엔카 매핑
  let mapped = BRAND_MAP[brand];
  if (!mapped) {
    const stripped = brand.replace(/\(.*?\)/g, '').trim();
    mapped = BRAND_MAP[stripped];
  }
  if (!mapped) {
    const lower = brand.toLowerCase();
    for (const [k, v] of Object.entries(BRAND_MAP)) {
      if (k.toLowerCase() === lower) { mapped = v; break; }
    }
  }
  if (!mapped) mapped = '기타';

  // 4. "현대"인데 제네시스 모델이면 → 제네시스 분리
  if (mapped === '현대' && isGenesisModel(model)) {
    return '제네시스';
  }

  return mapped;
}

// ─── 모델 결정 ───
function resolveModel(model) {
  if (!model) return model;
  if (userModelMap[model]) return userModelMap[model];
  return model;
}

// ─── 부품명 결정 ───
function resolvePart(part) {
  if (!part || typeof part !== 'string') return part;
  if (userPartsMap[part]) return userPartsMap[part];
  return part;
}

function resolveParts(parts) {
  if (!Array.isArray(parts)) return parts;
  return parts.map(resolvePart);
}

// ─── 메인 실행 ───
function main() {
  console.log(`\n═══ SSOT 브랜드/차종 표준화 ${dryRun ? '(DRY RUN)' : ''} ═══\n`);

  const files = fs.readdirSync(SSOT_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  console.log(`SSOT 파일: ${files.length}개\n`);

  const stats = {
    total: 0,
    brandChanged: 0,
    modelChanged: 0,
    partsChanged: 0,
    genesisSplit: 0,
    mixedSplit: 0,
    errors: 0,
    changes: {},  // "oldBrand → newBrand": count
  };

  for (const f of files) {
    try {
      const filePath = path.join(SSOT_DIR, f);
      const ssot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      stats.total++;

      if (!ssot.vehicle) ssot.vehicle = {};
      const oldBrand = ssot.vehicle.brand || '';
      const oldModel = ssot.vehicle.model || '';

      const newBrand = resolveBrand(oldBrand, oldModel);
      const newModel = resolveModel(oldModel);

      let changed = false;

      if (newBrand !== oldBrand) {
        const key = `${oldBrand} → ${newBrand}`;
        stats.changes[key] = (stats.changes[key] || 0) + 1;
        stats.brandChanged++;

        if (isMixedHyundaiKia(oldBrand)) stats.mixedSplit++;
        if (oldBrand !== '제네시스' && newBrand === '제네시스') stats.genesisSplit++;

        ssot.vehicle.brand = newBrand;
        // 원본 보존
        if (!ssot.vehicle._originalBrand) ssot.vehicle._originalBrand = oldBrand;
        changed = true;
      }

      if (newModel !== oldModel) {
        ssot.vehicle.model = newModel;
        if (!ssot.vehicle._originalModel) ssot.vehicle._originalModel = oldModel;
        stats.modelChanged++;
        changed = true;
      }

      // 부품명 매핑
      if (ssot.work?.parts && Array.isArray(ssot.work.parts)) {
        const oldParts = [...ssot.work.parts];
        const newParts = resolveParts(ssot.work.parts);
        const partsChanged = JSON.stringify(oldParts) !== JSON.stringify(newParts);
        if (partsChanged) {
          ssot.work.parts = newParts;
          if (!ssot.work._originalParts) ssot.work._originalParts = oldParts;
          stats.partsChanged++;
          changed = true;
        }
      }

      if (changed && !dryRun) {
        fs.writeFileSync(filePath, JSON.stringify(ssot, null, 2), 'utf8');
      }
    } catch (e) {
      stats.errors++;
      console.error(`  오류: ${f} — ${e.message}`);
    }
  }

  // 리포트
  console.log(`처리 완료:`);
  console.log(`  전체: ${stats.total}건`);
  console.log(`  브랜드 변경: ${stats.brandChanged}건`);
  console.log(`  - 제네시스 분리: ${stats.genesisSplit}건`);
  console.log(`  - 혼합 브랜드 분리: ${stats.mixedSplit}건`);
  console.log(`  모델 변경: ${stats.modelChanged}건`);
  console.log(`  부품명 변경: ${stats.partsChanged}건`);
  console.log(`  오류: ${stats.errors}건`);

  if (Object.keys(stats.changes).length > 0) {
    console.log(`\n브랜드 변경 내역 (상위 20개):`);
    const sorted = Object.entries(stats.changes).sort((a, b) => b[1] - a[1]);
    for (const [change, count] of sorted.slice(0, 20)) {
      console.log(`  ${change}: ${count}건`);
    }
    if (sorted.length > 20) console.log(`  ... 외 ${sorted.length - 20}개`);
  }

  if (dryRun) {
    console.log(`\n※ DRY RUN 모드 — 실제 파일은 변경되지 않았습니다.`);
    console.log(`  실제 반영: node scripts/apply-naming.js${namingFile ? ' ' + namingFile : ''}`);
  }

  // 결과 요약 JSON 저장
  const summary = {
    appliedAt: new Date().toISOString(),
    dryRun,
    namingSource: namingFile || 'auto (encar-master)',
    stats,
  };
  const summaryPath = path.join(SSOT_DIR, '_naming-applied.json');
  if (!dryRun) {
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\n결과 저장: ${summaryPath}`);
  }
}

main();
