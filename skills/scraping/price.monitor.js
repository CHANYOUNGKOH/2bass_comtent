/**
 * 가격 모니터링 Skill
 * 상품 URL을 입력받아 가격 정보를 수집
 *
 * 사용법:
 *   node skills/scraping/price.monitor.js "https://example.com/product/123"
 *   node skills/scraping/price.monitor.js --file urls.txt
 */

import { BaseSkill } from '../utils/base.skill.js';
import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 사이트별 가격 셀렉터 (추가 가능)
const PRICE_SELECTORS = {
  'smartstore.naver.com': {
    price: '._1LY7DqCnwR',
    title: '._22kNQuEXmb',
  },
  'coupang.com': {
    price: '.total-price strong',
    title: '.prod-buy-header__title',
  },
  '11st.co.kr': {
    price: '.price_detail .value',
    title: '.heading_main',
  },
  // 새 사이트 추가시 여기에 추가
  'default': {
    // 일반적인 셀렉터 패턴
    price: '[class*="price"], [class*="Price"], [data-price]',
    title: 'h1, [class*="title"], [class*="Title"]',
  }
};

class PriceMonitorSkill extends BaseSkill {
  constructor() {
    super({ name: 'price-monitor', headless: true });
  }

  // URL에서 도메인 추출
  getDomain(url) {
    try {
      const hostname = new URL(url).hostname;
      // www 제거
      return hostname.replace('www.', '');
    } catch {
      return 'default';
    }
  }

  // 가격 텍스트를 숫자로 변환
  parsePrice(priceText) {
    if (!priceText) return null;
    const cleaned = priceText.replace(/[^\d]/g, '');
    return cleaned ? parseInt(cleaned, 10) : null;
  }

  async getPrice(url) {
    const page = this.page;
    const domain = this.getDomain(url);
    const selectors = PRICE_SELECTORS[domain] || PRICE_SELECTORS.default;

    console.log(`🔍 [${domain}] 가격 조회 중...`);

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // 동적 로딩 대기

    // 가격 추출
    let priceText = null;
    try {
      const priceEl = await page.locator(selectors.price).first();
      priceText = await priceEl.textContent({ timeout: 5000 });
    } catch {
      console.warn('⚠️ 가격 요소를 찾을 수 없음');
    }

    // 제목 추출
    let titleText = null;
    try {
      const titleEl = await page.locator(selectors.title).first();
      titleText = await titleEl.textContent({ timeout: 5000 });
    } catch {
      console.warn('⚠️ 제목 요소를 찾을 수 없음');
    }

    return {
      url,
      domain,
      title: titleText?.trim(),
      priceText: priceText?.trim(),
      price: this.parsePrice(priceText),
      timestamp: new Date().toISOString(),
    };
  }

  async monitorMultiple(urls) {
    const results = [];

    for (const url of urls) {
      try {
        const result = await this.getPrice(url);
        results.push(result);
        console.log(`✅ ${result.title?.substring(0, 30)}... : ${result.priceText}`);
      } catch (error) {
        results.push({
          url,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        console.error(`❌ ${url}: ${error.message}`);
      }
    }

    return results;
  }

  async saveResults(results, filename = 'price_results.json') {
    const filepath = join(__dirname, '../../output', filename);
    const { mkdir } = await import('fs/promises');
    await mkdir(join(__dirname, '../../output'), { recursive: true });
    await writeFile(filepath, JSON.stringify(results, null, 2));
    console.log(`💾 결과 저장: ${filepath}`);
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);

  let urls = [];

  if (args.includes('--file')) {
    const fileIndex = args.indexOf('--file') + 1;
    const content = await readFile(args[fileIndex], 'utf-8');
    urls = content.split('\n').filter(line => line.trim());
  } else if (args.length > 0) {
    urls = args.filter(arg => arg.startsWith('http'));
  } else {
    // 테스트용 기본 URL
    urls = [
      'https://smartstore.naver.com/example/products/123',
    ];
    console.log('ℹ️ URL을 지정하지 않아 테스트 모드로 실행');
  }

  const skill = new PriceMonitorSkill();

  await skill.run(async () => {
    const results = await skill.monitorMultiple(urls);
    await skill.saveResults(results);
    return results;
  });
}

main().catch(console.error);
