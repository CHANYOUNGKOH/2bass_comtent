/**
 * 주문도우미 엑셀 파싱 스크립트
 */

import XLSX from 'xlsx';
import { writeFileSync } from 'fs';

const filePath = process.argv[2] || 'C:/Users/kohaz/Downloads/20260302_orders_export.xlsx';

console.log(`📂 파일 읽는 중: ${filePath}\n`);

const workbook = XLSX.readFile(filePath);

// 시트 목록
console.log('📋 시트 목록:', workbook.SheetNames);

// 첫 번째 시트 파싱
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// JSON으로 변환
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

// 헤더 (첫 번째 행)
const headers = data[0];
console.log('\n📌 컬럼 목록:');
headers.forEach((h, i) => console.log(`  ${i}: ${h}`));

// 샘플 데이터 (처음 5행)
console.log('\n📊 샘플 데이터 (5행):');
const sampleRows = data.slice(1, 6);
sampleRows.forEach((row, i) => {
  console.log(`\n--- 행 ${i + 1} ---`);
  headers.forEach((h, j) => {
    if (row[j] !== undefined && row[j] !== '') {
      console.log(`  ${h}: ${row[j]}`);
    }
  });
});

// 전체 행 수
console.log(`\n📈 전체 데이터: ${data.length - 1}행`);

// 주문URL, 주문번호 컬럼 찾기
const urlColIdx = headers.findIndex(h => h && h.includes('주문URL'));
const orderNumColIdx = headers.findIndex(h => h && h.includes('주문번호'));
const marketColIdx = headers.findIndex(h => h && (h.includes('마켓') || h.includes('소매처') || h.includes('판매처')));

console.log('\n🔍 주요 컬럼 인덱스:');
console.log(`  주문URL: ${urlColIdx} (${headers[urlColIdx] || 'N/A'})`);
console.log(`  주문번호: ${orderNumColIdx} (${headers[orderNumColIdx] || 'N/A'})`);
console.log(`  마켓: ${marketColIdx} (${headers[marketColIdx] || 'N/A'})`);

// JSON으로 저장 (전체 데이터)
const jsonData = XLSX.utils.sheet_to_json(sheet);
writeFileSync('output/orders-parsed.json', JSON.stringify(jsonData, null, 2));
console.log('\n💾 JSON 저장: output/orders-parsed.json');
