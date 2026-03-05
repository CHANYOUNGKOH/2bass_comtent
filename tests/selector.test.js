/**
 * 셀렉터 로더 테스트
 *
 * 사용법:
 *   npm run test:selectors
 */

import { loadSelectors, getSelector, validateSelectors, loadAllSelectors } from '../core/selector.loader.js';

async function runTests() {
  console.log('🧪 셀렉터 로더 테스트 시작\n');

  let passed = 0;
  let failed = 0;

  // 테스트 함수
  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`  ❌ ${name}: ${error.message}`);
      failed++;
    }
  }

  function assertEqual(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message} 예상: ${expected}, 실제: ${actual}`);
    }
  }

  function assertDefined(value, message = '') {
    if (value === undefined || value === null) {
      throw new Error(`${message} 값이 undefined/null`);
    }
  }

  // 테스트 그룹 1: 셀렉터 로드
  console.log('📁 셀렉터 로드 테스트:');

  test('naver-seller.yaml 로드', () => {
    const selectors = loadSelectors('naver-seller');
    assertDefined(selectors.metadata);
    assertDefined(selectors.urls);
    assertDefined(selectors.selectors);
  });

  test('esm-seller.yaml 로드', () => {
    const selectors = loadSelectors('esm-seller');
    assertDefined(selectors.metadata);
  });

  test('coupang-wing.yaml 로드', () => {
    const selectors = loadSelectors('coupang-wing');
    assertDefined(selectors.metadata);
  });

  test('wholesale/site-a.yaml 로드', () => {
    const selectors = loadSelectors('wholesale/site-a');
    assertDefined(selectors.metadata);
  });

  // 테스트 그룹 2: 셀렉터 경로 접근
  console.log('\n📍 셀렉터 경로 접근 테스트:');

  test('getSelector - 로그인 셀렉터', () => {
    const selectors = loadSelectors('naver-seller');
    const loginBtn = getSelector(selectors, 'selectors.login.login_btn');
    assertDefined(loginBtn);
  });

  test('getSelector - URL 접근', () => {
    const selectors = loadSelectors('naver-seller');
    const loginUrl = getSelector(selectors, 'urls.login');
    assertEqual(typeof loginUrl, 'string');
  });

  test('getSelector - 중첩 경로', () => {
    const selectors = loadSelectors('naver-seller');
    const directTab = getSelector(selectors, 'selectors.order_management.direct_delivery.tab');
    assertDefined(directTab);
  });

  // 테스트 그룹 3: 유효성 검증
  console.log('\n✅ 유효성 검증 테스트:');

  test('validateSelectors - 유효한 셀렉터', () => {
    const selectors = loadSelectors('naver-seller');
    const result = validateSelectors(selectors);
    assertEqual(result.valid, true);
  });

  test('validateSelectors - 빈 객체', () => {
    const result = validateSelectors({});
    assertEqual(result.valid, false);
  });

  // 테스트 그룹 4: 캐시
  console.log('\n💾 캐시 테스트:');

  test('캐시 - 중복 로드 동일 결과', () => {
    const selectors1 = loadSelectors('naver-seller');
    const selectors2 = loadSelectors('naver-seller');
    assertEqual(selectors1, selectors2);
  });

  // 테스트 그룹 5: 전체 로드
  console.log('\n📦 전체 로드 테스트:');

  test('loadAllSelectors', () => {
    const allSelectors = loadAllSelectors();
    assertDefined(allSelectors['naver-seller']);
  });

  // 결과 출력
  console.log('\n' + '='.repeat(40));
  console.log(`📊 테스트 결과: ${passed} 통과, ${failed} 실패`);
  console.log('='.repeat(40));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('❌ 테스트 실행 중 에러:', error);
  process.exit(1);
});
