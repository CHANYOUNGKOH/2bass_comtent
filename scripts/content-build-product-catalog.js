#!/usr/bin/env node
/**
 * content-build-product-catalog.js
 * SSOT 1912개 분석 → 통합 상품 카탈로그 추출 (플랫폼 독립)
 *
 * 브랜드그룹 × 작업유형 N×N 조합으로 상품 자동 생성
 * 당근/스마트스토어 어디든 공통 활용
 *
 * 출력: data/publish/products/catalog.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
const OUT_DIR = path.join(ROOT, 'data', 'publish', 'products');
const OUT_FILE = path.join(OUT_DIR, 'catalog.json');

// ─── 브랜드 그룹 정규화 (엔카 기준: 국산/수입) ───
const BRAND_GROUPS = {
  '국산': ['현대', '기아', '제네시스', '쉐보레', 'KG모빌리티', '르노코리아',
           // 레거시 표기 호환
           'Hyundai', 'Kia', 'Genesis', 'Chevrolet', '쌍용', 'Ssangyong', '르노삼성', 'Renault Samsung',
           'GM대우', '삼성', '대우', 'GM', 'GMC'],
  '수입': ['BMW', '벤츠', '아우디', '포르쉐', '미니', '폭스바겐', '랜드로버', '볼보', '지프', '포드',
           '렉서스', '도요타', '혼다', '캐딜락', '인피니티', '닛산', '마세라티', '재규어', '링컨',
           '닷지', '크라이슬러', '스바루', '미쓰비시', '페라리', '마쯔다', '스마트', '사브', '테슬라',
           // 레거시 영문 표기 호환
           'Mercedes-Benz', 'BENZ', 'AUDI', 'Audi', 'Porsche', 'MINI', 'Mini', 'Volkswagen', 'VW',
           'Land Rover', 'Range Rover', 'Volvo', 'Jeep', 'JEEP', 'Ford', 'Lexus', 'Toyota', '토요타',
           'Honda', 'Cadillac', 'Infiniti', 'Nissan', 'Maserati', 'Jaguar', 'Lincoln', 'Dodge',
           'Chrysler', 'Subaru', 'Mitsubishi', 'Ferrari', 'Mazda', 'Smart', 'SAAB'],
};

function getBrandGroup(brand) {
  if (!brand) return '기타';
  const b = brand.trim();
  for (const [group, brands] of Object.entries(BRAND_GROUPS)) {
    if (brands.some(gb => b.toLowerCase().includes(gb.toLowerCase()) || gb.toLowerCase().includes(b.toLowerCase()))) {
      return group;
    }
  }
  return '기타';
}

// ─── 작업 유형 정규화 ───
function normalizeWorkType(workType) {
  if (!workType) return '기타';
  const t = workType.toLowerCase();

  if (/풀셋|업그레이드|튜닝|캘리퍼.*설치|캘리퍼.*장착|브렘보|빅브레이크/.test(t)) return '브레이크 튜닝/업그레이드';
  if (/패드.*교체|패드.*교환/.test(t)) return '패드 교체';
  if (/디스크.*교체|디스크.*교환/.test(t)) return '디스크 교체';
  if (/연마/.test(t)) return '디스크 연마';
  if (/허브링|허브/.test(t)) return '허브링 커스텀 제작';
  if (/브레이크액|오일.*교환|액.*교환/.test(t)) return '브레이크액 교환';
  if (/도장|캘리퍼.*도장|캘리퍼.*페인팅/.test(t)) return '캘리퍼 도장';
  if (/점검|진단|상담/.test(t)) return '브레이크 점검/진단';
  if (/호스|메쉬호스/.test(t)) return '브레이크 호스 교체';

  return '브레이크 튜닝/업그레이드'; // default
}

function main() {
  console.log('SSOT 분석 → 통합 상품 카탈로그 생성...\n');

  const ssotFiles = fs.readdirSync(SSOT_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  console.log(`SSOT 파일: ${ssotFiles.length}개`);

  // 분석용 집계
  const brandGroupCounts = {};
  const brandGroupBrands = {};
  const workTypeCounts = {};
  const comboMap = {}; // "brandGroup|workType" → { count, postIds[], ... }

  for (const f of ssotFiles) {
    try {
      const ssot = JSON.parse(fs.readFileSync(path.join(SSOT_DIR, f), 'utf8'));
      const brand = ssot.vehicle?.brand || '';
      const model = ssot.vehicle?.model || '';
      const workType = ssot.work?.type || '';
      const duration = ssot.work?.duration || '';
      const postId = ssot.postId;

      const group = getBrandGroup(brand);
      const normWork = normalizeWorkType(workType);

      // 브랜드 그룹 집계
      brandGroupCounts[group] = (brandGroupCounts[group] || 0) + 1;
      if (!brandGroupBrands[group]) brandGroupBrands[group] = new Set();
      if (brand) brandGroupBrands[group].add(brand);

      // 작업 유형 집계
      workTypeCounts[normWork] = (workTypeCounts[normWork] || 0) + 1;

      // 조합 집계
      const key = `${group}|${normWork}`;
      if (!comboMap[key]) {
        comboMap[key] = { brandGroup: group, workType: normWork, count: 0, postIds: [], durations: [] };
      }
      comboMap[key].count++;
      if (comboMap[key].postIds.length < 5) comboMap[key].postIds.push(postId);
      if (duration) comboMap[key].durations.push(duration);
    } catch {
      // skip invalid
    }
  }

  // 브랜드 그룹 정보
  const brandGroups = {};
  for (const [group, count] of Object.entries(brandGroupCounts).sort((a, b) => b[1] - a[1])) {
    brandGroups[group] = {
      brands: [...(brandGroupBrands[group] || [])].sort(),
      count,
    };
  }

  // 작업 유형 정보
  const workTypes = {};
  for (const [wt, count] of Object.entries(workTypeCounts).sort((a, b) => b[1] - a[1])) {
    workTypes[wt] = { count };
  }

  // 상품 생성 (조합 기반, 최소 3건 이상)
  const products = [];
  let prodIdx = 0;

  for (const [key, combo] of Object.entries(comboMap).sort((a, b) => b[1].count - a[1].count)) {
    if (combo.count < 3) continue; // 3건 미만은 상품화 안 함

    const groupLabel = combo.brandGroup === '기타' ? '기타' : `${combo.brandGroup}차`;
    const name = `${groupLabel} ${combo.workType}`;

    // 대표 duration
    const durationCounts = {};
    combo.durations.forEach(d => { durationCounts[d] = (durationCounts[d] || 0) + 1; });
    const topDuration = Object.entries(durationCounts).sort((a, b) => b[1] - a[1])[0];

    const brandList = brandGroups[combo.brandGroup]?.brands || [];
    const desc = `${brandList.slice(0, 3).join('/')} 등 ${combo.brandGroup}차 ${combo.workType}`;

    products.push({
      id: `prod_${combo.brandGroup}_${combo.workType.replace(/[\/\s]/g, '_')}`.toLowerCase().replace(/[^a-z0-9_가-힣]/g, ''),
      name,
      brandGroup: combo.brandGroup,
      workType: combo.workType,
      frequency: combo.count,
      priceNote: '차종별 상이 / 상담 후 안내',
      avgDuration: topDuration ? topDuration[0] : '당일 완료',
      samplePostIds: combo.postIds,
      description: desc,
    });
  }

  // 공임 단독 상품 (작업유형만)
  for (const [wt, count] of Object.entries(workTypeCounts).sort((a, b) => b[1] - a[1])) {
    if (count < 5) continue;
    products.push({
      id: `prod_all_${wt.replace(/[\/\s]/g, '_')}`.toLowerCase().replace(/[^a-z0-9_가-힣]/g, ''),
      name: `${wt} (전 차종)`,
      brandGroup: '전체',
      workType: wt,
      frequency: count,
      priceNote: '차종별 상이 / 상담 후 안내',
      avgDuration: '당일 완료',
      samplePostIds: [],
      description: `전 차종 대상 ${wt} 서비스`,
    });
  }

  // 쿠폰/이벤트 템플릿
  const coupons = [
    {
      name: '매월 선착순 브레이크 무상점검',
      description: '디스크+패드 상태 무상 점검 (매월 선착순)',
      type: 'monthly',
    },
    {
      name: '브레이크액 교환 할인',
      description: '브레이크액 교환 시 점검 무료',
      type: 'monthly',
    },
  ];

  const catalog = {
    generatedAt: new Date().toISOString(),
    totalSsotPosts: ssotFiles.length,
    brandGroups,
    workTypes,
    products,
    coupons,
  };

  // 저장
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(catalog, null, 2), 'utf8');

  // 리포트
  console.log(`\n═══ 상품 카탈로그 생성 완료 ═══`);
  console.log(`\n브랜드 그룹:`);
  for (const [g, info] of Object.entries(brandGroups)) {
    console.log(`  ${g}: ${info.count}건 (${info.brands.slice(0, 5).join(', ')}${info.brands.length > 5 ? ' ...' : ''})`);
  }
  console.log(`\n작업 유형:`);
  for (const [wt, info] of Object.entries(workTypes)) {
    console.log(`  ${wt}: ${info.count}건`);
  }
  console.log(`\n생성된 상품: ${products.length}개`);
  console.log(`쿠폰 템플릿: ${coupons.length}개`);
  console.log(`\n저장: ${OUT_FILE}`);
}

main();
