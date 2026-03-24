/**
 * patch-normalize-vehicle.js
 * SSOT JSON 파일의 vehicle.brand / vehicle.model 일괄 정규화
 *
 * 사용법:
 *   node scripts/patch-normalize-vehicle.js --dry   # 변경 예정 목록만 출력
 *   node scripts/patch-normalize-vehicle.js          # 실제 패치
 */
import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { normalizeBrand, normalizeModel } from './_content-shared.js';

const ROOT = process.cwd();
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
const DRY = process.argv.includes('--dry');

async function main() {
  const files = (await readdir(SSOT_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  console.log(`SSOT 파일 ${files.length}개 스캔 중...${DRY ? ' (dry-run)' : ''}\n`);

  // 1단계: 전체 브랜드/차종 목록 스캔
  const brandCounts = {};
  const modelCounts = {};
  for (const f of files) {
    try {
      const ssot = JSON.parse(await readFile(path.join(SSOT_DIR, f), 'utf8'));
      const b = ssot.vehicle?.brand;
      const m = ssot.vehicle?.model;
      if (b) brandCounts[b] = (brandCounts[b] || 0) + 1;
      if (m) modelCounts[m] = (modelCounts[m] || 0) + 1;
    } catch { /* skip */ }
  }

  console.log('=== 현재 브랜드 목록 ===');
  const sortedBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedBrands) {
    const normalized = normalizeBrand(name);
    const marker = normalized !== name ? ` → ${normalized}` : '';
    console.log(`  ${name} (${count})${marker}`);
  }

  console.log('\n=== 정규화 대상 차종 ===');
  const sortedModels = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedModels) {
    const normalized = normalizeModel(name);
    if (normalized !== name) {
      console.log(`  ${name} (${count}) → ${normalized}`);
    }
  }

  // 2단계: 공백 중복 쌍 자동 감지
  const modelNames = Object.keys(modelCounts);
  const autoDetected = [];
  for (const name of modelNames) {
    const noSpace = name.replace(/\s/g, '');
    if (noSpace !== name) {
      const match = modelNames.find(n => n !== name && n.replace(/\s/g, '') === noSpace);
      if (match) {
        autoDetected.push({ spaced: name, compact: match });
      }
    }
  }
  if (autoDetected.length) {
    console.log('\n=== 자동 감지된 공백 중복 쌍 ===');
    for (const { spaced, compact } of autoDetected) {
      console.log(`  "${spaced}" ↔ "${compact}"`);
    }
  }

  // 3단계: 파일 패치
  console.log('\n=== 패치 시작 ===');
  let changed = 0;
  let unchanged = 0;
  const changes = [];

  for (const f of files) {
    try {
      const fp = path.join(SSOT_DIR, f);
      const raw = await readFile(fp, 'utf8');
      const ssot = JSON.parse(raw);

      let modified = false;
      const oldBrand = ssot.vehicle?.brand || '';
      const oldModel = ssot.vehicle?.model || '';
      const newBrand = normalizeBrand(oldBrand);
      const newModel = normalizeModel(oldModel);

      if (oldBrand && newBrand !== oldBrand) {
        ssot.vehicle.brand = newBrand;
        modified = true;
      }
      if (oldModel && newModel !== oldModel) {
        ssot.vehicle.model = newModel;
        modified = true;
      }

      if (modified) {
        changes.push({
          file: f,
          brand: oldBrand !== newBrand ? `${oldBrand} → ${newBrand}` : null,
          model: oldModel !== newModel ? `${oldModel} → ${newModel}` : null,
        });
        if (!DRY) {
          await writeFile(fp, JSON.stringify(ssot, null, 2));
        }
        changed++;
      } else {
        unchanged++;
      }
    } catch { /* skip */ }
  }

  // 리포트
  console.log(`\n=== 결과 ===`);
  if (changes.length) {
    for (const c of changes) {
      const parts = [];
      if (c.brand) parts.push(`브랜드: ${c.brand}`);
      if (c.model) parts.push(`차종: ${c.model}`);
      console.log(`  ${c.file}: ${parts.join(', ')}`);
    }
  }
  console.log(`\n변경: ${changed}건, 변경없음: ${unchanged}건${DRY ? ' (dry-run — 실제 저장 안 됨)' : ''}`);
}

main().catch(err => { console.error(err); process.exit(1); });
