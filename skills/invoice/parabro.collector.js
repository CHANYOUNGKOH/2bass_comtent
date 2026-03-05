/**
 * 파라브로 송장 수집 Skill
 *
 * 주문목록에서 주문번호/상품명/택배사/송장번호/상태 수집
 * - 자체재고 도매처라 문의하기/문의확인 로직 불필요
 * - 송장번호가 테이블에 바로 표시됨 (클릭 불필요)
 *
 * 사용법:
 *   node skills/invoice/parabro.collector.js --my-orders
 *   node skills/invoice/parabro.collector.js --my-orders --period=1year
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class ParabroCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? true;
    this.sessionPath = join(__dirname, '../../sessions/parabro.json');
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless
    });

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1920, height: 1080 }
    };

    if (existsSync(this.sessionPath)) {
      console.log('📂 저장된 세션 로드...');
      const sessionData = JSON.parse(await readFile(this.sessionPath, 'utf8'));
      this.context = await this.browser.newContext({
        storageState: sessionData,
        ...contextOptions
      });
    } else {
      this.context = await this.browser.newContext(contextOptions);
    }

    this.page = await this.context.newPage();
    return this.page;
  }

  async humanDelay(min = 500, max = 1500) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.page.waitForTimeout(delay);
  }

  async stop() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async saveSession() {
    const sessionDir = dirname(this.sessionPath);
    await mkdir(sessionDir, { recursive: true });

    const storage = await this.context.storageState();
    await writeFile(this.sessionPath, JSON.stringify(storage, null, 2));
    console.log('💾 세션 저장 완료');
  }

  /**
   * 로그인
   */
  async login() {
    const page = this.page;
    const id = process.env.PARABRO_BUYER_ID;
    const pw = process.env.PARABRO_BUYER_PW;

    if (!id || !pw) {
      throw new Error('PARABRO_BUYER_ID, PARABRO_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 파라브로 로그인...');
    await page.goto('https://www.parabro.co.kr/member/login.php');
    await page.waitForTimeout(2000);

    await page.getByRole('textbox', { name: '아이디' }).fill(id);
    await this.humanDelay(300, 500);
    await page.getByRole('textbox', { name: '비밀번호' }).fill(pw);
    await this.humanDelay(300, 500);
    await page.getByRole('button', { name: '로그인' }).click();

    await page.waitForTimeout(3000);
    await this.saveSession();
    console.log('✅ 로그인 완료');
    return true;
  }

  /**
   * 주문목록 페이지 이동
   */
  async goToMyOrders(period = '3month') {
    const page = this.page;

    console.log('🌐 파라브로 주문목록...');
    await page.goto('https://www.parabro.co.kr/mypage/order_list.php');
    await page.waitForTimeout(2000);

    // 로그인 확인
    if (page.url().includes('login')) {
      await this.login();
      await page.goto('https://www.parabro.co.kr/mypage/order_list.php');
      await page.waitForTimeout(2000);
    }

    // 기간 설정 (1년 조회 등)
    if (period === '1year') {
      try {
        const yearBtn = page.getByRole('button', { name: '1년' });
        if (await yearBtn.isVisible({ timeout: 2000 })) {
          await yearBtn.click();
          await page.waitForTimeout(500);
          await page.getByRole('button', { name: '조회' }).click();
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        // 기간 버튼 없으면 무시
      }
    }

    console.log('📋 주문목록 페이지');
    console.log('   URL:', page.url());
  }

  /**
   * 주문 수집
   * 테이블: 날짜/주문번호 | 상품명/옵션 | 상품금액/수량 | 주문상태 | 송장번호 | 확인/리뷰
   */
  async collectOrders() {
    const page = this.page;
    const results = [];

    console.log('\n📦 주문 수집 중...');

    // 테이블 행 가져오기
    const rows = page.locator('table tbody tr, table tr').filter({ hasNot: page.locator('th') });
    const rowCount = await rows.count();
    console.log(`   테이블 행 수: ${rowCount}`);

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = (await row.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      // 빈 행 스킵
      if (!rowText || rowText.length < 10) continue;

      const order = {
        orderNumber: null,
        orderDate: null,
        productName: null,
        status: null,
        carrier: null,
        trackingNumber: null,
        market: 'parabro',
        collectedAt: new Date().toISOString()
      };

      // 셀 단위 추출
      const cells = row.locator('td');
      const cellCount = await cells.count();

      if (cellCount < 5) continue;

      // 날짜/주문번호 (첫번째 셀) - "2026/03/03 2603030226446386 환불신청 교환신청"
      const dateOrderCell = (await cells.nth(0).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      // 날짜 추출 (YYYY/MM/DD 또는 /MM/DD)
      const dateMatch = dateOrderCell.match(/(\d{4}\/\d{2}\/\d{2}|\d{2}\/\d{2}\/\d{2})/);
      if (dateMatch) {
        order.orderDate = dateMatch[1];
      }

      // 주문번호 추출 (16자리 숫자)
      const orderMatch = dateOrderCell.match(/(\d{16})/);
      if (orderMatch) {
        order.orderNumber = orderMatch[1];
      } else {
        continue; // 주문번호 없으면 스킵
      }

      // 상품명/옵션 (두번째 셀)
      order.productName = (await cells.nth(1).textContent().catch(() => '')).replace(/\s+/g, ' ').trim().substring(0, 50);

      // 주문상태 (네번째 셀) - "결제완료 배송추적" 또는 "구매확정 배송추적"
      const statusCell = (await cells.nth(3).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      if (statusCell.includes('구매확정') || statusCell.includes('배송완료')) {
        order.status = 'delivered';
      } else if (statusCell.includes('배송중')) {
        order.status = 'shipping';
      } else if (statusCell.includes('결제완료') || statusCell.includes('입금확인')) {
        order.status = 'paid';
      } else if (statusCell.includes('배송준비')) {
        order.status = 'preparing';
      }

      // 송장번호 (다섯번째 셀) - "CJ대한통운 695857918636"
      const trackingCell = (await cells.nth(4).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      // 택배사/송장번호 패턴
      const carriers = [
        { name: 'CJ대한통운', pattern: /CJ대한통운\s*(\d{10,14})/ },
        { name: '한진택배', pattern: /한진택배?\s*(\d{10,14})/ },
        { name: '롯데택배', pattern: /롯데택배?\s*(\d{10,14})/ },
        { name: '로젠택배', pattern: /로젠택배?\s*(\d{10,14})/ },
        { name: '우체국택배', pattern: /우체국택배?\s*(\d{10,14})/ },
        { name: '경동택배', pattern: /경동택배?\s*(\d{10,14})/ },
        { name: '대신택배', pattern: /대신택배?\s*(\d{10,14})/ }
      ];

      for (const c of carriers) {
        const match = trackingCell.match(c.pattern);
        if (match) {
          order.carrier = c.name;
          order.trackingNumber = match[1];
          break;
        }
      }

      results.push(order);

      // 로그
      const statusIcon = order.status === 'delivered' ? '✅' :
                         order.status === 'shipping' ? '🚚' :
                         order.carrier ? '📦' : '⏳';
      console.log(`   ${statusIcon} ${order.orderNumber}: ${order.carrier || '-'} ${order.trackingNumber || '-'}`);
    }

    return results;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  const myOrders = args.includes('--my-orders');
  const period = args.find(a => a.startsWith('--period='))?.split('=')[1] || '3month';

  if (!myOrders) {
    console.log('파라브로 송장 수집 도구');
    console.log('');
    console.log('세션 저장:');
    console.log('  npx playwright codegen https://www.parabro.co.kr --save-storage=sessions/parabro.json');
    console.log('');
    console.log('사용법:');
    console.log('  --my-orders       : 전체 주문 수집');
    console.log('  --period=1year    : 1년치 조회 (기본: 3개월)');
    console.log('  --visible         : 브라우저 표시');
    console.log('');
    console.log('※ 자체재고 도매처라 문의하기/문의확인 불필요');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new ParabroCollector({ headless: !visible });

  try {
    await collector.start();
    await collector.goToMyOrders(period);
    const results = await collector.collectOrders();

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 수집 결과:');
    console.log(`  전체: ${results.length}건`);
    console.log(`  배송완료: ${results.filter(r => r.status === 'delivered').length}건`);
    console.log(`  배송중: ${results.filter(r => r.status === 'shipping').length}건`);
    console.log(`  결제완료: ${results.filter(r => r.status === 'paid').length}건`);

    const collected = results.filter(r => r.carrier && r.trackingNumber);
    console.log(`  송장수집: ${collected.length}건`);

    // 결과 저장
    const outputDir = join(__dirname, '../../output/invoices');
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = join(outputDir, `parabro_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({
      results,
      summary: {
        total: results.length,
        delivered: results.filter(r => r.status === 'delivered').length,
        shipping: results.filter(r => r.status === 'shipping').length,
        paid: results.filter(r => r.status === 'paid').length,
        collected: collected.length
      }
    }, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { ParabroCollector };
