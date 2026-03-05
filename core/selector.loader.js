/**
 * YAML 셀렉터 로더
 * 외부 YAML 파일에서 셀렉터를 로드하여 사이트 변경 시 코드 수정 없이 셀렉터만 수정
 */

import yaml from 'js-yaml';
import { readFileSync, existsSync, watchFile } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SELECTORS_DIR = join(__dirname, '../selectors');

// 셀렉터 캐시
const selectorCache = new Map();

/**
 * YAML 셀렉터 파일 로드
 * @param {string} market - 마켓 이름 (예: 'naver-seller', 'coupang-wing')
 * @returns {object} 셀렉터 객체
 */
export function loadSelectors(market) {
  // 캐시에 있으면 반환
  if (selectorCache.has(market)) {
    return selectorCache.get(market);
  }

  const filePath = join(SELECTORS_DIR, `${market}.yaml`);

  if (!existsSync(filePath)) {
    throw new Error(`셀렉터 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf8');
  const selectors = yaml.load(content);

  // 캐시에 저장
  selectorCache.set(market, selectors);

  console.log(`📋 셀렉터 로드: ${market} (v${selectors.metadata?.version || '1.0'})`);

  return selectors;
}

/**
 * 특정 셀렉터 경로의 값 가져오기
 * @param {object} selectors - 셀렉터 객체
 * @param {string} path - 도트 표기법 경로 (예: 'login.id_input.selector')
 * @returns {string|object} 셀렉터 값
 */
export function getSelector(selectors, path) {
  const keys = path.split('.');
  let current = selectors;

  for (const key of keys) {
    if (current === undefined || current === null) {
      throw new Error(`셀렉터 경로를 찾을 수 없습니다: ${path}`);
    }
    current = current[key];
  }

  // selector 속성이 있으면 그 값 반환, 없으면 전체 반환
  return current?.selector || current;
}

/**
 * 캐시 무효화 (YAML 파일 수정 시)
 * @param {string} market - 마켓 이름
 */
export function invalidateCache(market) {
  if (market) {
    selectorCache.delete(market);
    console.log(`🔄 셀렉터 캐시 무효화: ${market}`);
  } else {
    selectorCache.clear();
    console.log('🔄 전체 셀렉터 캐시 무효화');
  }
}

/**
 * 셀렉터 파일 변경 감시 (핫 리로드)
 * @param {string} market - 마켓 이름
 * @param {function} callback - 변경 시 콜백
 */
export function watchSelectors(market, callback) {
  const filePath = join(SELECTORS_DIR, `${market}.yaml`);

  watchFile(filePath, { interval: 1000 }, () => {
    invalidateCache(market);
    const newSelectors = loadSelectors(market);
    if (callback) callback(newSelectors);
    console.log(`🔃 셀렉터 핫 리로드: ${market}`);
  });
}

/**
 * 모든 마켓 셀렉터 로드
 * @returns {object} 마켓별 셀렉터 맵
 */
export function loadAllSelectors() {
  const markets = [
    'naver-seller',
    'esm-seller',
    'coupang-wing'
  ];

  const result = {};
  for (const market of markets) {
    try {
      result[market] = loadSelectors(market);
    } catch (e) {
      console.warn(`⚠️ ${market} 셀렉터 로드 실패: ${e.message}`);
    }
  }

  return result;
}

/**
 * 셀렉터 유효성 검증
 * @param {object} selectors - 셀렉터 객체
 * @returns {object} 검증 결과
 */
export function validateSelectors(selectors) {
  const errors = [];
  const warnings = [];

  // 필수 필드 검사
  if (!selectors.metadata) {
    warnings.push('metadata 필드가 없습니다');
  }

  if (!selectors.urls) {
    errors.push('urls 필드가 필수입니다');
  }

  if (!selectors.selectors) {
    errors.push('selectors 필드가 필수입니다');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export default {
  loadSelectors,
  getSelector,
  invalidateCache,
  watchSelectors,
  loadAllSelectors,
  validateSelectors
};
