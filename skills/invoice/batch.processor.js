/**
 * 일괄 송장 수집 프로세서
 *
 * 엑셀 파일에서 주문 목록을 읽어 송장 수집
 * - 합배송 처리: 같은 주문번호는 한 번만 조회
 * - 이미 송장 있는 주문 스킵
 * - 결과를 엑셀에 반영
 *
 * 사용법:
 *   node skills/invoice/batch.processor.js --excel "path/to/orders.xlsx"
 *   node skills/invoice/batch.processor.js --excel "path/to/orders.xlsx" --market "네이버페이"
 */

import { config } from 'dotenv';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { NaverPayCollector } from './naverpay.collector.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 엑셀 파일 파싱
 */
function parseExcel(filepath) {
  const workbook = XLSX.readFile(filepath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet);
}

/**
 * 마켓별 주문 그룹화
 */
function groupByMarket(orders) {
  const groups = {};

  for (const order of orders) {
    const market = order['공급처명'] || 'unknown';
    if (!groups[market]) {
      groups[market] = [];
    }
    groups[market].push(order);
  }

  return groups;
}

/**
 * 합배송 및 중복 제거
 * - 같은 주문번호는 하나만 처리
 * - 이미 송장 있는 건 제외
 */
function deduplicateOrders(orders) {
  const seen = new Set();
  const result = [];

  for (const order of orders) {
    const orderNumber = order['주문번호'];
    const hasTracking = order['송장번호'] && order['송장번호'] !== '';

    // 이미 송장이 있으면 스킵
    if (hasTracking) {
      continue;
    }

    // 같은 주문번호는 한 번만
    if (seen.has(orderNumber)) {
      continue;
    }

    seen.add(orderNumber);
    result.push(order);
  }

  return result;
}

/**
 * 네이버페이 주문 필터링
 */
function filterNaverPayOrders(orders) {
  return orders.filter(order => {
    const url = order['주문URL'] || '';
    const market = order['공급처명'] || '';

    return url.includes('orders.pay.naver.com') ||
           url.includes('pay.naver.com') ||
           market.includes('네이버페이');
  });
}

/**
 * 수집 결과를 원본 데이터에 반영
 */
function applyResults(orders, results) {
  const resultMap = new Map();

  for (const result of results) {
    if (result.trackingNumber) {
      resultMap.set(result.orderNumber, result);
    }
  }

  for (const order of orders) {
    const orderNumber = order['주문번호'];
    const result = resultMap.get(orderNumber);

    if (result) {
      order['택배사'] = result.carrier || order['택배사'];
      order['송장번호'] = result.trackingNumber || order['송장번호'];
    }
  }

  return orders;
}

/**
 * 결과를 엑셀로 저장
 */
async function saveToExcel(orders, outputPath) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(orders);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');
  XLSX.writeFile(workbook, outputPath);
  console.log(`💾 결과 저장: ${outputPath}`);
}

/**
 * 배치 처리 메인
 */
async function processBatch(excelPath, options = {}) {
  const { market = null, dryRun = false, limit = 0 } = options;

  console.log('📂 엑셀 로드:', excelPath);
  const allOrders = parseExcel(excelPath);
  console.log(`  총 주문: ${allOrders.length}건`);

  // 마켓 필터링
  let targetOrders;
  if (market) {
    const groups = groupByMarket(allOrders);
    targetOrders = groups[market] || [];
    console.log(`  ${market} 주문: ${targetOrders.length}건`);
  } else {
    // 기본: 네이버페이만
    targetOrders = filterNaverPayOrders(allOrders);
    console.log(`  네이버페이 주문: ${targetOrders.length}건`);
  }

  // 중복/합배송 제거
  const uniqueOrders = deduplicateOrders(targetOrders);
  console.log(`  수집 대상: ${uniqueOrders.length}건 (중복/기존송장 제외)`);

  if (uniqueOrders.length === 0) {
    console.log('✅ 수집할 주문이 없습니다.');
    return;
  }

  // 제한 적용
  const ordersToProcess = limit > 0 ? uniqueOrders.slice(0, limit) : uniqueOrders;
  console.log(`  처리 예정: ${ordersToProcess.length}건`);

  if (dryRun) {
    console.log('\n🔍 Dry-run 모드 - 실제 수집하지 않음');
    console.log('처리 대상 주문:');
    for (const order of ordersToProcess) {
      console.log(`  - ${order['주문번호']}: ${order['주문URL']}`);
    }
    return;
  }

  // 네이버페이 수집 시작
  const collector = new NaverPayCollector({ headless: false });
  const results = [];

  try {
    await collector.start();

    for (let i = 0; i < ordersToProcess.length; i++) {
      const order = ordersToProcess[i];
      console.log(`\n[${i + 1}/${ordersToProcess.length}]`);

      const result = await collector.collectSingle(order['주문URL']);
      results.push(result);

      // 요청 간격
      if (i < ordersToProcess.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

  } finally {
    await collector.stop();
  }

  // 결과 요약
  const collected = results.filter(r => r.status === 'collected').length;
  const notShipped = results.filter(r => r.status === 'not_shipped').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log('\n📊 수집 결과:');
  console.log(`  ✅ 수집 성공: ${collected}건`);
  console.log(`  ⏳ 미발송: ${notShipped}건`);
  console.log(`  ❌ 에러: ${errors}건`);

  // 원본 데이터에 결과 반영
  const updatedOrders = applyResults(allOrders, results);

  // 결과 엑셀 저장
  const outputDir = join(__dirname, '../../output');
  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = join(outputDir, `orders_updated_${timestamp}.xlsx`);
  await saveToExcel(updatedOrders, outputPath);

  // JSON 결과도 저장
  const jsonPath = join(outputDir, `batch_results_${timestamp}.json`);
  await writeFile(jsonPath, JSON.stringify({ results, summary: { collected, notShipped, errors } }, null, 2));
  console.log(`💾 상세 결과: ${jsonPath}`);

  return { results, updatedOrders };
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);

  const excelIndex = args.indexOf('--excel');
  const excelPath = excelIndex !== -1 ? args[excelIndex + 1] : null;

  const marketIndex = args.indexOf('--market');
  const market = marketIndex !== -1 ? args[marketIndex + 1] : null;

  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : 0;

  const dryRun = args.includes('--dry-run');

  if (!excelPath) {
    console.log('일괄 송장 수집 도구');
    console.log('');
    console.log('사용법:');
    console.log('  --excel <파일경로>    : 주문 엑셀 파일 (필수)');
    console.log('  --market <마켓명>     : 특정 마켓만 처리 (선택)');
    console.log('  --limit <숫자>        : 처리 개수 제한 (선택)');
    console.log('  --dry-run             : 실제 수집 없이 대상만 확인');
    console.log('');
    console.log('예시:');
    console.log('  # 네이버페이 주문 수집');
    console.log('  node skills/invoice/batch.processor.js --excel "orders.xlsx"');
    console.log('');
    console.log('  # 처음 5건만 테스트');
    console.log('  node skills/invoice/batch.processor.js --excel "orders.xlsx" --limit 5');
    console.log('');
    console.log('  # 대상만 확인 (dry-run)');
    console.log('  node skills/invoice/batch.processor.js --excel "orders.xlsx" --dry-run');
    return;
  }

  await processBatch(excelPath, { market, limit, dryRun });
}

main().catch(console.error);

export { processBatch, parseExcel, groupByMarket, deduplicateOrders };
