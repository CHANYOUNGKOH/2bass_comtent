/**
 * 쿠팡 송장 수집 Skill
 *
 * 주문 URL에서 택배사/송장번호 수집
 * - 쿠팡 로켓배송/판매자배송 구분 처리
 *
 * 사용법:
 *   node skills/invoice/coupang.collector.js --url "https://mc.coupang.com/ssr/desktop/order/..."
 *   node skills/invoice/coupang.collector.js --codegen
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class CoupangCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? false;
    this.sessionPath = join(__dirname, '../../sessions/coupang.json');
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: 50
    });

    if (existsSync(this.sessionPath)) {
      console.log('📂 저장된 세션 로드...');
      const sessionData = JSON.parse(await readFile(this.sessionPath, 'utf8'));
      this.context = await this.browser.newContext({ storageState: sessionData });
    } else {
      this.context = await this.browser.newContext();
    }

    this.page = await this.context.newPage();
    return this.page;
  }

  async stop() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async login() {
    const page = this.page;
    const id = process.env.COUPANG_BUYER_ID;
    const pw = process.env.COUPANG_BUYER_PW;

    if (!id || !pw) {
      throw new Error('COUPANG_BUYER_ID, COUPANG_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 쿠팡 로그인...');
    await page.goto('https://login.coupang.com/login/login.pang');
    await page.waitForLoadState('networkidle');

    try {
      const idInput = page.locator('#login-email-input, [name="email"], input[type="email"]').first();
      const pwInput = page.locator('#login-password-input, [name="password"], input[type="password"]').first();
      const loginBtn = page.locator('.login__button, button[type="submit"]').first();

      await idInput.fill(id);
      await pwInput.fill(pw);
      await loginBtn.click();

      await page.waitForLoadState('networkidle');

      if (!page.url().includes('login')) {
        await this.saveSession();
        console.log('✅ 로그인 완료');
      } else {
        console.log('⚠️ 수동 로그인 필요 (60초 대기)');
        await page.waitForURL(url => !url.href.includes('login'), { timeout: 60000 });
        await this.saveSession();
        console.log('✅ 로그인 완료');
      }
    } catch (error) {
      console.log('⚠️ 자동 로그인 실패 - 수동 로그인 필요');
      await page.waitForURL(url => !url.href.includes('login'), { timeout: 60000 });
      await this.saveSession();
      console.log('✅ 로그인 완료');
    }
  }

  async saveSession() {
    const sessionDir = dirname(this.sessionPath);
    await mkdir(sessionDir, { recursive: true });
    const storage = await this.context.storageState();
    await writeFile(this.sessionPath, JSON.stringify(storage, null, 2));
    console.log('💾 세션 저장 완료');
  }

  async collectSingle(orderUrl) {
    const page = this.page;

    // 주문번호 추출
    const orderMatch = orderUrl.match(/order\/(\d+)/);
    const orderNumber = orderMatch ? orderMatch[1] : 'unknown';

    console.log(`\n📦 쿠팡 주문 조회: ${orderNumber}`);

    await page.goto(orderUrl);
    await page.waitForLoadState('networkidle');

    if (page.url().includes('login')) {
      console.log('🔐 로그인 필요...');
      await this.login();
      await page.goto(orderUrl);
      await page.waitForLoadState('networkidle');
    }

    const result = {
      orderUrl,
      orderNumber,
      market: 'coupang',
      carrier: null,
      trackingNumber: null,
      deliveryType: null, // rocket, marketplace
      status: null,
      collectedAt: new Date().toISOString()
    };

    try {
      const pageText = await page.textContent('body');

      // 로켓배송 여부 확인
      if (pageText.includes('로켓배송')) {
        result.deliveryType = 'rocket';
        result.carrier = '쿠팡로켓';
        console.log('  배송유형: 로켓배송');
      } else {
        result.deliveryType = 'marketplace';
        console.log('  배송유형: 판매자배송');
      }

      // 배송조회 버튼 찾기
      const trackingSelectors = [
        page.getByRole('button', { name: /배송조회|배송추적/i }),
        page.getByRole('link', { name: /배송조회|배송추적/i }),
        page.locator('[class*="delivery-tracking"]'),
        page.locator('[class*="tracking"]'),
        page.locator('a[href*="tracking"]')
      ];

      let trackingBtn = null;
      for (const selector of trackingSelectors) {
        if (await selector.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          trackingBtn = selector.first();
          break;
        }
      }

      if (trackingBtn) {
        console.log('📍 배송조회 버튼 발견 - 클릭');
        await trackingBtn.click();
        await page.waitForLoadState('networkidle');

        const trackingText = await page.textContent('body');

        // 택배사 추출 (판매자배송인 경우)
        if (result.deliveryType !== 'rocket') {
          const carriers = [
            'CJ대한통운', '롯데택배', '한진택배', '우체국택배',
            '로젠택배', '경동택배', '대신택배', 'GSpostbox'
          ];

          for (const carrier of carriers) {
            if (trackingText.includes(carrier)) {
              result.carrier = carrier;
              console.log(`  택배사: ${carrier}`);
              break;
            }
          }
        }

        // 송장번호 추출
        const trackingMatches = trackingText.match(/\b(\d{10,14})\b/g);
        if (trackingMatches && trackingMatches.length > 0) {
          // 주문번호와 다른 번호 선택
          result.trackingNumber = trackingMatches.find(n => n !== orderNumber) || trackingMatches[0];
          console.log(`  송장번호: ${result.trackingNumber}`);
        }

        result.status = result.trackingNumber || result.deliveryType === 'rocket' ? 'collected' : 'no_tracking';

      } else {
        // 로켓배송은 별도 송장 없이 배송 상태 확인 가능
        if (result.deliveryType === 'rocket') {
          // 배송 상태 텍스트 확인
          if (pageText.includes('배송완료') || pageText.includes('배송중')) {
            result.status = 'collected';
            result.trackingNumber = `ROCKET_${orderNumber}`;
            console.log(`  로켓배송 추적: ${result.trackingNumber}`);
          } else {
            result.status = 'not_shipped';
            console.log('⚠️ 아직 발송되지 않음');
          }
        } else {
          result.status = 'not_shipped';
          console.log('⚠️ 배송조회 버튼 없음 - 미발송 상태');
        }
      }

      console.log(`  상태: ${result.status}`);

    } catch (error) {
      console.error(`❌ 수집 실패: ${error.message}`);
      result.status = 'error';
      result.error = error.message;
    }

    return result;
  }

  async saveScreenshot(name) {
    const screenshotDir = join(__dirname, '../../output/screenshots');
    await mkdir(screenshotDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = join(screenshotDir, `coupang_${name}_${timestamp}.png`);
    await this.page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 스크린샷: ${filepath}`);
    return filepath;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  const url = urlIndex !== -1 ? args[urlIndex + 1] : null;
  const codegen = args.includes('--codegen');
  const debug = args.includes('--debug');

  if (codegen) {
    const { exec } = await import('child_process');
    exec('npx playwright codegen https://mc.coupang.com/ssr/desktop/order');
    return;
  }

  if (!url) {
    console.log('쿠팡 송장 수집 도구');
    console.log('');
    console.log('사용법:');
    console.log('  --url <주문URL>  : 주문 URL (필수)');
    console.log('  --codegen        : 셀렉터 확인용 codegen 실행');
    console.log('  --debug          : 디버그 모드 (스크린샷 저장)');
    console.log('');
    console.log('예시:');
    console.log('  node skills/invoice/coupang.collector.js --url "https://mc.coupang.com/ssr/desktop/order/12345678"');
    return;
  }

  const collector = new CoupangCollector({ headless: false });

  try {
    await collector.start();
    const result = await collector.collectSingle(url);

    if (debug) {
      await collector.saveScreenshot('debug');
    }

    console.log('\n📊 수집 결과:');
    console.log(JSON.stringify(result, null, 2));

    const outputDir = join(__dirname, '../../output/invoices');
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `coupang_${result.orderNumber}.json`);
    await writeFile(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { CoupangCollector };
